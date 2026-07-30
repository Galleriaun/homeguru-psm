-- ============================================================================
-- HomeGuru PMS — RLS & invariant smoke test
--
-- HOW TO RUN: paste this whole file into the Supabase SQL editor and run it.
-- Everything happens inside ONE transaction that is ROLLED BACK at the end —
-- no test data survives, so it is safe to run against the live project.
--
-- Prerequisite: migrations 001–133 applied. The preflight block below names
-- exactly which object is missing if you are behind.
--
-- On success the last message is:   ALL TESTS PASSED (rolled back)
-- On the first failed check it stops with:  FAIL: <what broke>
-- Hardening gaps that are NOT yet fixed surface as loud WARNINGs at the end
-- (they do not abort the run) — see "SECURITY ASSERTIONS" below.
--
-- Covers
--   • PENDING / NULL-role staff get zero rows everywhere
--   • access_scope isolation (a HOTELS-scoped user cannot see an APARTMENT)
--   • Double-booking is impossible (EXCLUDE gist); cancelling frees the slot
--   • 126 Cancellation approval: the BEFORE UPDATE trigger is the real
--     boundary; non-reviewers must file a request; only a reviewer resolves it;
--     the requests table has no client write path
--   • 128/129 Bildirim visibility re-checks the CURRENT role per event_type,
--     is own-rows only, and fails open on an unknown event_type
--   • 129 reservation_changed is a legal notification_preferences event_type
--   • 127 prune_old_notifications is not callable by app users and prunes >15d
--   • 123 Deleting a birim orphans its rezervasyonlar (keeps them) and is
--     refused while a stay is active
--   • 131 An avans exceeding the maaş is recovered partially; the remainder
--     carries to the next cycle as borç and is deducted there. Paying the full
--     maaş deliberately recovers nothing.
--   • 132 soft_delete_entity enforces per-row RLS again (062 regression): a role
--     without reservations_delete is refused and leaves no orphan trash row,
--     while SUPER_ADMIN still deletes into Çöp Kutusu.
--   • 133 A daire accepts a second birim (002's single-unit trigger is gone).
--
-- Deliberately NOT covered (needs the deployed app / dashboard):
--   Storage policies, PWA, cron actually firing, Edge Function auth, KBS.
--
-- Note on side effects: the cancellation-request RPC calls _send_push_async,
-- which enqueues a pg_net request. That INSERT is transactional and rolls back
-- with everything else, so no push is ever delivered by this test.
-- ============================================================================

begin;

-- ── Impersonation helpers (temp schema — vanish on rollback) ────────────────

create function pg_temp.login(p_uid uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create function pg_temp.logout() returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end;
$$;

-- ── Preflight: fail early and clearly if a migration is missing ─────────────

do $$
begin
  if to_regclass('public.reservation_cancellation_requests') is null then
    raise exception 'FAIL: migration 126 not applied (reservation_cancellation_requests missing)';
  end if;
  if to_regproc('public.auth_receives_event') is null then
    raise exception 'FAIL: migration 128 not applied (auth_receives_event missing)';
  end if;
  if to_regproc('public.prune_old_notifications') is null then
    raise exception 'FAIL: migration 127 not applied (prune_old_notifications missing)';
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = 'reservations_notify_changed'
  ) then
    raise exception 'FAIL: migration 129 not applied (reservations_notify_changed trigger missing)';
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = 'reservations_guard_cancel'
  ) then
    raise exception 'FAIL: migration 126 not applied (reservations_guard_cancel trigger missing)';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'staff_advances'
       and column_name = 'settled_amount'
  ) then
    raise exception 'FAIL: migration 131 not applied (staff_advances.settled_amount missing)';
  end if;
  if exists (select 1 from pg_trigger where tgname = 'units_apartment_single') then
    raise exception 'FAIL: migration 133 not applied (units_apartment_single still refuses a second birim on a daire)';
  end if;
  -- prosecdef = true means SECURITY DEFINER, i.e. still on 062's regression.
  if exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'soft_delete_entity' and p.prosecdef
  ) then
    raise exception 'FAIL: migration 132 not applied (soft_delete_entity is still SECURITY DEFINER — RLS is bypassed)';
  end if;
  raise notice 'PREFLIGHT OK: migrations 126–132 present';
end $$;

do $$
declare
  u_pending  uuid := gen_random_uuid();
  u_admin    uuid := gen_random_uuid();  -- SUPER_ADMIN (reviewer)
  u_manager  uuid := gen_random_uuid();  -- PROPERTY_MANAGER, HQ (NOT a reviewer)
  u_reception uuid := gen_random_uuid(); -- RECEPTION (files requests)
  u_house    uuid := gen_random_uuid();  -- HOUSEKEEPING (cannot even request)
  u_hotels   uuid := gen_random_uuid();  -- RECEPTION scoped to HOTELS only

  p_hotel    uuid;   -- HOTEL,     region NULL (Ana Grup)
  p_apart    uuid;   -- APARTMENT, region NULL
  un_hotel   uuid;
  un_apart   uuid;
  un_orphan  uuid;   -- birim used by the 123 delete-orphan checks
  g_guest    uuid;

  r_cancel   uuid;   -- reservation the cancellation flow acts on
  r_deny     uuid;   -- reservation used for the deny path
  r_direct   uuid;   -- reservation the admin cancels outright
  r_apart    uuid;   -- APARTMENT reservation (scope isolation)
  r_orphan   uuid;   -- past stay on un_orphan (survives the birim delete)

  v_req      uuid;
  v_req2     uuid;
  v_status   text;
  v_unitname text;
  v_unitid   uuid;
  n          bigint;
  ok         boolean;

  v_adv        uuid;          -- 131 avans borcu carry-over
  v_settled    numeric;
  v_settled_at timestamptz;

  warn_count int := 0;
begin
  -- ═══════════════════════════════════════════════════════════════════════
  -- Fixtures — created as the table owner, which bypasses RLS by design.
  -- ═══════════════════════════════════════════════════════════════════════

  insert into auth.users
    (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
     raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    ('00000000-0000-0000-0000-000000000000', u_pending, 'authenticated', 'authenticated',
     'hg-smoke-pending@test.local', '', now(),
     '{"provider":"email","providers":["email"]}', '{"full_name":"Smoke Pending"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', u_admin, 'authenticated', 'authenticated',
     'hg-smoke-admin@test.local', '', now(),
     '{"provider":"email","providers":["email"]}', '{"full_name":"Smoke Admin"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', u_manager, 'authenticated', 'authenticated',
     'hg-smoke-manager@test.local', '', now(),
     '{"provider":"email","providers":["email"]}', '{"full_name":"Smoke Manager"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', u_reception, 'authenticated', 'authenticated',
     'hg-smoke-reception@test.local', '', now(),
     '{"provider":"email","providers":["email"]}', '{"full_name":"Smoke Reception"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', u_house, 'authenticated', 'authenticated',
     'hg-smoke-house@test.local', '', now(),
     '{"provider":"email","providers":["email"]}', '{"full_name":"Smoke Housekeeping"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', u_hotels, 'authenticated', 'authenticated',
     'hg-smoke-hotels@test.local', '', now(),
     '{"provider":"email","providers":["email"]}', '{"full_name":"Smoke HotelsOnly"}', now(), now());

  -- handle_new_user (032) should have made each of them PENDING with no property.
  select count(*) into n from staff_profiles
   where user_id in (u_pending, u_admin, u_manager, u_reception, u_house, u_hotels)
     and role = 'PENDING';
  if n <> 6 then
    raise exception 'FAIL 01: signup trigger should create 6 PENDING profiles, got %', n;
  end if;
  raise notice 'PASS 01: signup trigger -> PENDING staff_profile';

  update staff_profiles set role = 'SUPER_ADMIN',      access_scope = 'ALL'    where user_id = u_admin;
  update staff_profiles set role = 'PROPERTY_MANAGER', access_scope = 'ALL'    where user_id = u_manager;
  update staff_profiles set role = 'RECEPTION',        access_scope = 'ALL'    where user_id = u_reception;
  update staff_profiles set role = 'HOUSEKEEPING',     access_scope = 'ALL'    where user_id = u_house;
  update staff_profiles set role = 'RECEPTION',        access_scope = 'HOTELS' where user_id = u_hotels;
  -- u_pending stays PENDING on purpose.

  insert into properties (name, type, region)
  values ('Smoke Otel', 'HOTEL', NULL) returning id into p_hotel;
  insert into properties (name, type, region)
  values ('Smoke Daire', 'APARTMENT', NULL) returning id into p_apart;

  -- room_type values come from migration 006, which replaced 001's original
  -- ROOM/SUITE set: '1+0','1+1','2+1','SINGLE','DOUBLE','TRIPLE','QUAD'.
  insert into units (property_id, name, room_type, capacity, base_price)
  values (p_hotel, 'Smoke Oda 1', 'DOUBLE', 2, 1000.00) returning id into un_hotel;
  insert into units (property_id, name, room_type, capacity, base_price)
  values (p_apart, 'Smoke Daire 1', '1+1', 4, 2000.00) returning id into un_apart;
  insert into units (property_id, name, room_type, capacity, base_price)
  values (p_hotel, 'Smoke Oda 2', 'DOUBLE', 2, 1000.00) returning id into un_orphan;

  insert into guests (full_name, phone) values ('Smoke Misafir', '5550000000')
  returning id into g_guest;

  insert into reservations
    (property_id, unit_id, guest_id, stay_start, stay_end, status,
     total_amount, deposit, created_by)
  values
    (p_hotel, un_hotel, g_guest, now() + interval '10 days', now() + interval '12 days',
     'upcoming', 5000.00, 0, u_reception)
  returning id into r_cancel;

  insert into reservations
    (property_id, unit_id, guest_id, stay_start, stay_end, status,
     total_amount, deposit, created_by)
  values
    (p_hotel, un_hotel, g_guest, now() + interval '20 days', now() + interval '22 days',
     'upcoming', 4000.00, 0, u_reception)
  returning id into r_deny;

  insert into reservations
    (property_id, unit_id, guest_id, stay_start, stay_end, status,
     total_amount, deposit, created_by)
  values
    (p_hotel, un_hotel, g_guest, now() + interval '30 days', now() + interval '32 days',
     'upcoming', 3000.00, 0, u_reception)
  returning id into r_direct;

  insert into reservations
    (property_id, unit_id, guest_id, stay_start, stay_end, status,
     total_amount, deposit, created_by)
  values
    (p_apart, un_apart, g_guest, now() + interval '10 days', now() + interval '12 days',
     'upcoming', 9000.00, 0, u_reception)
  returning id into r_apart;

  -- A finished stay on un_orphan: the 123 delete-orphan path must preserve it.
  insert into reservations
    (property_id, unit_id, guest_id, stay_start, stay_end, status,
     total_amount, deposit, created_by)
  values
    (p_hotel, un_orphan, g_guest, now() - interval '10 days', now() - interval '8 days',
     'completed', 1500.00, 0, u_reception)
  returning id into r_orphan;

  -- ═══════════════════════════════════════════════════════════════════════
  -- 02) PENDING / role-less staff see nothing
  -- ═══════════════════════════════════════════════════════════════════════
  perform pg_temp.login(u_pending);

  select count(*) into n from properties;   if n <> 0 then raise exception 'FAIL 02: pending sees properties (%)', n; end if;
  select count(*) into n from units;        if n <> 0 then raise exception 'FAIL 02: pending sees units (%)', n; end if;
  select count(*) into n from reservations; if n <> 0 then raise exception 'FAIL 02: pending sees reservations (%)', n; end if;
  select count(*) into n from guests;       if n <> 0 then raise exception 'FAIL 02: pending sees guests (%)', n; end if;

  begin
    insert into reservations
      (property_id, unit_id, guest_id, stay_start, stay_end, status,
       total_amount, deposit, created_by)
    values (p_hotel, un_hotel, g_guest, now() + interval '90 days',
            now() + interval '91 days', 'upcoming', 1.00, 0, u_pending);
    raise exception 'FAIL 02: pending user could INSERT a reservation';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS 02: PENDING/role-less staff get zero rows and cannot write';

  -- ═══════════════════════════════════════════════════════════════════════
  -- 03) access_scope isolation — HOTELS-scoped staff cannot see an APARTMENT
  -- ═══════════════════════════════════════════════════════════════════════
  perform pg_temp.login(u_hotels);

  select count(*) into n from reservations where id = r_apart;
  if n <> 0 then raise exception 'FAIL 03: HOTELS-scoped user sees an APARTMENT reservation'; end if;
  select count(*) into n from reservations where id = r_cancel;
  if n <> 1 then raise exception 'FAIL 03: HOTELS-scoped user cannot see the HOTEL reservation'; end if;
  raise notice 'PASS 03: access_scope isolation holds both ways';

  -- ═══════════════════════════════════════════════════════════════════════
  -- 04) Double-booking is impossible; a cancelled stay frees the slot
  -- ═══════════════════════════════════════════════════════════════════════
  perform pg_temp.logout();

  begin
    insert into reservations
      (property_id, unit_id, guest_id, stay_start, stay_end, status,
       total_amount, deposit, created_by)
    values (p_hotel, un_hotel, g_guest,
            now() + interval '11 days', now() + interval '13 days',   -- overlaps r_cancel
            'upcoming', 100.00, 0, u_admin);
    raise exception 'FAIL 04: overlapping reservation was accepted';
  exception when exclusion_violation then null;
  end;
  raise notice 'PASS 04: EXCLUDE gist blocks a double booking';

  -- ═══════════════════════════════════════════════════════════════════════
  -- 05) 126 — a non-reviewer cannot move a reservation INTO 'cancelled'
  -- ═══════════════════════════════════════════════════════════════════════
  perform pg_temp.login(u_reception);
  begin
    update reservations set status = 'cancelled' where id = r_cancel;
    raise exception 'FAIL 05: RECEPTION cancelled a reservation directly';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS 05: RECEPTION cannot cancel directly (trigger refuses)';

  -- An HQ PROPERTY_MANAGER is NOT a reviewer either (auth_can_review_region
  -- requires SUPER_ADMIN, or a manager WITH a region).
  perform pg_temp.login(u_manager);
  begin
    update reservations set status = 'cancelled' where id = r_cancel;
    raise exception 'FAIL 06: HQ PROPERTY_MANAGER cancelled a reservation directly';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS 06: HQ PROPERTY_MANAGER cannot cancel directly';

  -- Non-cancel updates must still work — the guard is scoped to the transition.
  update reservations set total_amount = 5100.00 where id = r_cancel;
  raise notice 'PASS 07: a non-cancel UPDATE still passes the guard';

  -- ═══════════════════════════════════════════════════════════════════════
  -- 08) 126 — filing a request: allowed roles, idempotency, refusals
  -- ═══════════════════════════════════════════════════════════════════════
  perform pg_temp.login(u_house);
  begin
    perform request_reservation_cancellation(r_cancel, 'housekeeping deneme');
    raise exception 'FAIL 08: HOUSEKEEPING could file a cancellation request';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS 08: HOUSEKEEPING cannot file a cancellation request';

  perform pg_temp.login(u_reception);
  select req.id into v_req from request_reservation_cancellation(r_cancel, 'misafir vazgeçti') req;
  if v_req is null then raise exception 'FAIL 09: RECEPTION could not file a request'; end if;

  select req.id into v_req2 from request_reservation_cancellation(r_cancel, 'tekrar') req;
  if v_req2 <> v_req then
    raise exception 'FAIL 09: second request created a duplicate (% vs %)', v_req2, v_req;
  end if;

  select status into v_status from reservations where id = r_cancel;
  if v_status = 'cancelled' then
    raise exception 'FAIL 09: filing a request cancelled the reservation immediately';
  end if;
  raise notice 'PASS 09: request is filed, idempotent, and leaves the stay untouched';

  -- ═══════════════════════════════════════════════════════════════════════
  -- 10) 126 — the requests table has no client write path
  -- ═══════════════════════════════════════════════════════════════════════
  begin
    insert into reservation_cancellation_requests (reservation_id, property_id, requested_by)
    values (r_deny, p_hotel, u_reception);
    raise exception 'FAIL 10: client could INSERT into reservation_cancellation_requests';
  exception when insufficient_privilege then null;
  end;

  -- No UPDATE/DELETE policy exists, so these either touch 0 rows (grant present,
  -- RLS filters everything out) or are refused outright — both are a pass.
  begin
    update reservation_cancellation_requests set status = 'approved' where id = v_req;
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAIL 10: client could UPDATE a cancellation request'; end if;
  exception when insufficient_privilege then null;
  end;

  begin
    delete from reservation_cancellation_requests where id = v_req;
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAIL 10: client could DELETE a cancellation request'; end if;
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS 10: requests are RPC-only (no client insert/update/delete)';

  -- ═══════════════════════════════════════════════════════════════════════
  -- 11) 126 — only a reviewer resolves a request
  -- ═══════════════════════════════════════════════════════════════════════
  begin
    perform approve_reservation_cancellation(v_req);
    raise exception 'FAIL 11: RECEPTION approved a cancellation request';
  exception when insufficient_privilege then null;
  end;

  perform pg_temp.login(u_manager);
  begin
    perform approve_reservation_cancellation(v_req);
    raise exception 'FAIL 11: HQ PROPERTY_MANAGER approved a cancellation request';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS 11: non-reviewers cannot approve a request';

  -- ═══════════════════════════════════════════════════════════════════════
  -- 12) 126 — SUPER_ADMIN approves: the stay is cancelled, the request closed
  -- ═══════════════════════════════════════════════════════════════════════
  perform pg_temp.login(u_admin);
  perform approve_reservation_cancellation(v_req);

  select status into v_status from reservations where id = r_cancel;
  if v_status <> 'cancelled' then
    raise exception 'FAIL 12: approve did not cancel the reservation (status=%)', v_status;
  end if;
  select status into v_status from reservation_cancellation_requests where id = v_req;
  if v_status <> 'approved' then
    raise exception 'FAIL 12: request not marked approved (status=%)', v_status;
  end if;

  -- A resolved request cannot be resolved twice. The RPC signals with a plain
  -- RAISE (P0001 = raise_exception), which is the same SQLSTATE a bare
  -- `raise exception 'FAIL...'` uses — so the assertion is a flag checked
  -- OUTSIDE the block, or the handler would swallow its own failure.
  ok := false;
  begin
    perform approve_reservation_cancellation(v_req);
    ok := true;
  exception when raise_exception then null;
  end;
  if ok then raise exception 'FAIL 12: an already-resolved request was approved again'; end if;
  raise notice 'PASS 12: reviewer approval cancels the stay exactly once';

  -- The cancelled slot is now free — 066 excludes cancelled from the constraint.
  perform pg_temp.logout();
  insert into reservations
    (property_id, unit_id, guest_id, stay_start, stay_end, status,
     total_amount, deposit, created_by)
  values (p_hotel, un_hotel, g_guest,
          now() + interval '10 days', now() + interval '12 days',
          'upcoming', 123.00, 0, u_admin);
  raise notice 'PASS 13: a cancelled stay frees its date range';

  -- ═══════════════════════════════════════════════════════════════════════
  -- 14) 126 — deny keeps the reservation; already-cancelled cannot be requested
  -- ═══════════════════════════════════════════════════════════════════════
  perform pg_temp.login(u_reception);
  select req.id into v_req2 from request_reservation_cancellation(r_deny, 'deneme') req;

  perform pg_temp.login(u_admin);
  perform deny_reservation_cancellation(v_req2);

  select status into v_status from reservations where id = r_deny;
  if v_status = 'cancelled' then raise exception 'FAIL 14: deny cancelled the reservation'; end if;
  select status into v_status from reservation_cancellation_requests where id = v_req2;
  if v_status <> 'denied' then raise exception 'FAIL 14: request not marked denied (%)', v_status; end if;
  raise notice 'PASS 14: deny closes the request and keeps the stay';

  -- SUPER_ADMIN is a reviewer, so a direct cancel is allowed.
  update reservations set status = 'cancelled' where id = r_direct;
  select status into v_status from reservations where id = r_direct;
  if v_status <> 'cancelled' then raise exception 'FAIL 15: SUPER_ADMIN direct cancel failed'; end if;

  -- login OUTSIDE the block: a plpgsql EXCEPTION handler rolls back to its
  -- implicit savepoint, which would also undo the transaction-local set_config
  -- that pg_temp.login() writes.
  perform pg_temp.login(u_reception);
  ok := false;
  begin
    perform request_reservation_cancellation(r_direct, 'zaten iptal');
    ok := true;
  exception when raise_exception then null;
  end;
  if ok then raise exception 'FAIL 15: a request was filed for an already-cancelled stay'; end if;
  raise notice 'PASS 15: reviewer cancels directly; already-cancelled refuses a request';

  -- Un-cancelling is deliberately NOT guarded (the trigger only fires INTO
  -- 'cancelled'), so a non-reviewer may reopen a stay.
  perform pg_temp.login(u_reception);
  update reservations set status = 'upcoming' where id = r_direct;
  select status into v_status from reservations where id = r_direct;
  if v_status <> 'upcoming' then raise exception 'FAIL 16: un-cancel was blocked'; end if;
  raise notice 'PASS 16: un-cancelling stays open to non-reviewers (by design)';

  -- ═══════════════════════════════════════════════════════════════════════
  -- 17) 128/129 — auth_receives_event reflects the CURRENT role
  -- ═══════════════════════════════════════════════════════════════════════
  perform pg_temp.login(u_admin);
  if not auth_receives_event('pending_approval') then
    raise exception 'FAIL 17: SUPER_ADMIN should receive pending_approval';
  end if;

  perform pg_temp.login(u_reception);
  if auth_receives_event('pending_approval') then
    raise exception 'FAIL 17: RECEPTION should NOT receive pending_approval';
  end if;
  if auth_receives_event('reservation_changed') then
    raise exception 'FAIL 17: RECEPTION should NOT receive reservation_changed (manager tier)';
  end if;
  if not auth_receives_event('new_reservation') then
    raise exception 'FAIL 17: RECEPTION should receive new_reservation';
  end if;
  if not auth_receives_event('bilinmeyen_olay') then
    raise exception 'FAIL 17: an unknown event_type must fail OPEN';
  end if;

  perform pg_temp.login(u_manager);
  if not auth_receives_event('reservation_changed') then
    raise exception 'FAIL 17: PROPERTY_MANAGER should receive reservation_changed';
  end if;
  raise notice 'PASS 17: auth_receives_event matches the send path per role';

  -- ═══════════════════════════════════════════════════════════════════════
  -- 18) 128 — Bildirimler: own rows only, role-filtered, unknown type visible
  -- ═══════════════════════════════════════════════════════════════════════
  perform pg_temp.logout();
  insert into notifications (user_id, title, body, kind, event_type) values
    (u_reception, 'Eski onay bildirimi', 'rol degisti', 'system', 'pending_approval'),
    (u_reception, 'Yeni rezervasyon',    'gorunmeli',  'reservation', 'new_reservation'),
    (u_reception, 'Gelecekteki tip',     'fail-open',  'system', 'gelecek_tipi'),
    (u_admin,     'Admin bildirimi',     'baskasinin', 'system', 'pending_approval');

  perform pg_temp.login(u_reception);
  select count(*) into n from notifications where title = 'Eski onay bildirimi';
  if n <> 0 then raise exception 'FAIL 18: a demoted role still sees pending_approval rows'; end if;

  select count(*) into n from notifications where title = 'Yeni rezervasyon';
  if n <> 1 then raise exception 'FAIL 18: RECEPTION cannot see its new_reservation row'; end if;

  select count(*) into n from notifications where title = 'Gelecekteki tip';
  if n <> 1 then raise exception 'FAIL 18: unknown event_type must stay visible (fail open)'; end if;

  select count(*) into n from notifications where title = 'Admin bildirimi';
  if n <> 0 then raise exception 'FAIL 18: a user can read another user''s notification'; end if;
  raise notice 'PASS 18: notifications are own-rows, role-filtered, fail-open';

  -- ═══════════════════════════════════════════════════════════════════════
  -- 19) 129 — reservation_changed is a legal preference event_type
  -- ═══════════════════════════════════════════════════════════════════════
  perform pg_temp.logout();
  begin
    insert into notification_preferences (user_id, event_type, enabled)
    values (u_manager, 'reservation_changed', false);
  exception when check_violation then
    raise exception 'FAIL 19: notification_preferences rejects reservation_changed (129 CHECK not applied)';
  end;
  raise notice 'PASS 19: reservation_changed accepted by the preferences CHECK';

  -- ═══════════════════════════════════════════════════════════════════════
  -- 20) 127 — prune keeps 15 days and is not callable by app users
  -- ═══════════════════════════════════════════════════════════════════════
  insert into notifications (user_id, title, kind, event_type, created_at)
  values (u_admin, 'Cok eski bildirim', 'system', 'pending_approval', now() - interval '40 days');

  perform prune_old_notifications();

  select count(*) into n from notifications
   where user_id = u_admin and title = 'Cok eski bildirim';
  if n <> 0 then raise exception 'FAIL 20: prune did not delete a 40-day-old notification'; end if;

  select count(*) into n from notifications
   where user_id = u_admin and title = 'Admin bildirimi';
  if n <> 1 then raise exception 'FAIL 20: prune deleted a recent notification'; end if;

  if has_function_privilege('authenticated', 'public.prune_old_notifications()', 'EXECUTE') then
    raise exception 'FAIL 20: authenticated can execute prune_old_notifications';
  end if;
  raise notice 'PASS 20: prune removes >15d rows only, and app users cannot call it';

  -- ═══════════════════════════════════════════════════════════════════════
  -- 21) 123 — deleting a birim orphans its rezervasyonlar instead of failing
  -- ═══════════════════════════════════════════════════════════════════════
  perform pg_temp.login(u_admin);
  perform soft_delete_entity('units', un_orphan);

  perform pg_temp.logout();
  select count(*) into n from units where id = un_orphan;
  if n <> 0 then raise exception 'FAIL 21: the birim was not deleted'; end if;

  select unit_id, deleted_unit_name into v_unitid, v_unitname
    from reservations where id = r_orphan;
  if v_unitid is not null then
    raise exception 'FAIL 21: the orphaned reservation still points at the deleted birim';
  end if;
  if v_unitname is distinct from 'Smoke Oda 2' then
    raise exception 'FAIL 21: birim name was not snapshotted (got %)', coalesce(v_unitname, '<null>');
  end if;
  raise notice 'PASS 21: birim delete orphans its rezervasyonlar and keeps them';

  -- An ACTIVE stay blocks the delete outright.
  update reservations set status = 'active' where id = r_deny;
  select unit_id into v_unitid from reservations where id = r_deny;
  perform pg_temp.login(u_admin);   -- outside the block (savepoint rollback)
  begin
    perform soft_delete_entity('units', v_unitid);
    raise exception 'FAIL 22: a birim with an ACTIVE stay was deleted';
  exception when check_violation then null;
  end;
  perform pg_temp.logout();
  select count(*) into n from units where id = v_unitid;
  if n <> 1 then raise exception 'FAIL 22: the birim disappeared despite the refusal'; end if;
  raise notice 'PASS 22: a birim with an active stay refuses deletion';

  -- ═══════════════════════════════════════════════════════════════════════
  -- 23) 131 — an avans bigger than the maaş is recovered PARTIALLY and the
  --     remainder carries to the next cycle as borç (instead of being written
  --     off, which is what 082 did). Needs the singleton general kasa.
  -- ═══════════════════════════════════════════════════════════════════════
  perform pg_temp.logout();
  if not exists (select 1 from cash_accounts where property_id is null) then
    raise notice 'SKIP 23: genel kasa tanımlı değil — migration 131 testi atlandı';
  else
    update staff_profiles set salary = 40000, salary_day = 15 where user_id = u_house;

    -- 50.000 avans against a 40.000 maaş → 10.000 must survive as borç.
    insert into staff_advances (user_id, amount, note, created_by)
    values (u_house, 50000, 'Smoke avans', u_admin)
    returning id into v_adv;

    -- Cycle 1: nothing to pay out; the salary recovers one maaş worth.
    perform pg_temp.login(u_admin);
    perform pay_staff_salary(u_house, 0, date_trunc('month', now())::date, 'smoke 1');
    perform pg_temp.logout();

    select settled_amount, settled_at into v_settled, v_settled_at
      from staff_advances where id = v_adv;
    if v_settled <> 40000 then
      raise exception 'FAIL 23: maaş kadarı (40000) tahsil edilmeliydi, oldu: %', v_settled;
    end if;
    if v_settled_at is not null then
      raise exception 'FAIL 23: kısmî tahsilat settled_at damgalamamalı (borç sürüyor)';
    end if;
    raise notice 'PASS 23: avansın yalnızca maaş kadarı tahsil edildi, 10.000 borç kaldı';

    -- Cycle 2: the carried 10.000 comes off the maaş → 30.000 paid, borç closed.
    perform pg_temp.login(u_admin);
    perform pay_staff_salary(
      u_house, 30000, (date_trunc('month', now()) + interval '1 month')::date, 'smoke 2');
    perform pg_temp.logout();

    select settled_amount, settled_at into v_settled, v_settled_at
      from staff_advances where id = v_adv;
    if v_settled <> 50000 then
      raise exception 'FAIL 24: taşınan borç kapanmalıydı (50000), oldu: %', v_settled;
    end if;
    if v_settled_at is null then
      raise exception 'FAIL 24: tamamen tahsil edilince settled_at damgalanmalı';
    end if;
    raise notice 'PASS 24: taşınan borç sonraki maaştan düşüldü ve avans kapandı';

    -- Paying the FULL maaş is an explicit "bu ay kesme" — recovers nothing.
    insert into staff_advances (user_id, amount, note, created_by)
    values (u_house, 5000, 'Smoke avans 2', u_admin)
    returning id into v_adv;
    perform pg_temp.login(u_admin);
    perform pay_staff_salary(
      u_house, 40000, (date_trunc('month', now()) + interval '2 months')::date, 'smoke 3');
    perform pg_temp.logout();
    select settled_amount into v_settled from staff_advances where id = v_adv;
    if v_settled <> 0 then
      raise exception 'FAIL 25: tam maaş ödenince avans tahsil edilmemeliydi, oldu: %', v_settled;
    end if;
    raise notice 'PASS 25: tam maaş ödemesi avansı tahsil etmez, borç aynen taşınır';
  end if;

  -- ═══════════════════════════════════════════════════════════════════════
  -- 26) 132 — soft_delete_entity enforces per-row RLS again. Between 062 and
  --     132 it ran SECURITY DEFINER, so ANY role could trash a reservation /
  --     kasa row / gider by calling the RPC, walking past 090's deletion-
  --     approval gate. Both directions are checked: the refusal must leave no
  --     trace, and a legitimate delete must still work.
  -- ═══════════════════════════════════════════════════════════════════════
  perform pg_temp.login(u_house);          -- HOUSEKEEPING: no reservations_delete
  ok := false;
  begin
    perform soft_delete_entity('reservations', r_apart);
    ok := true;
  exception when others then null;
  end;
  perform pg_temp.logout();

  if ok then
    raise exception 'FAIL 26: HOUSEKEEPING soft-deleted a reservation — RLS is being bypassed';
  end if;

  -- The refusal must not leave a half-applied state: the stay survives AND no
  -- orphan trash row is left claiming it was deleted (the ROW_COUNT=0 rollback).
  select count(*) into n from reservations where id = r_apart;
  if n <> 1 then
    raise exception 'FAIL 26: the reservation vanished despite the refusal';
  end if;
  select count(*) into n from trash_entries
   where entity_type = 'reservations' and entity_id = r_apart;
  if n <> 0 then
    raise exception 'FAIL 26: a refused delete left a trash row behind (ROW_COUNT rollback missing)';
  end if;
  raise notice 'PASS 26: a role without reservations_delete is refused, cleanly';

  -- Positive control: the fix must not break legitimate deletes.
  perform pg_temp.login(u_admin);
  perform soft_delete_entity('reservations', r_apart);
  perform pg_temp.logout();

  select count(*) into n from reservations where id = r_apart;
  if n <> 0 then raise exception 'FAIL 27: SUPER_ADMIN could not delete the reservation'; end if;
  select count(*) into n from trash_entries
   where entity_type = 'reservations' and entity_id = r_apart;
  if n <> 1 then raise exception 'FAIL 27: the deleted reservation did not reach Çöp Kutusu'; end if;
  raise notice 'PASS 27: SUPER_ADMIN still deletes, and it lands in Çöp Kutusu';

  -- ═══════════════════════════════════════════════════════════════════════
  -- 28) 133 — a daire may hold more than one birim. Migration 002's
  --     units_apartment_single trigger refused the second INSERT outright.
  -- ═══════════════════════════════════════════════════════════════════════
  insert into units (property_id, name, room_type, capacity, base_price)
  values (p_apart, 'Smoke Daire 2', '1+1', 2, 1800.00);

  select count(*) into n from units where property_id = p_apart;
  if n <> 2 then
    raise exception 'FAIL 28: daireye ikinci birim eklenemedi (birim sayısı %)', n;
  end if;
  raise notice 'PASS 28: bir daire birden fazla birim tutabilir';

  -- ═══════════════════════════════════════════════════════════════════════
  -- SECURITY ASSERTIONS — hardening gaps. These WARN instead of aborting so
  -- the functional suite above always reports in full. Fix them and they go
  -- quiet.
  -- ═══════════════════════════════════════════════════════════════════════

  -- (a) _send_push_async holds the Vault push secret and is SECURITY DEFINER.
  --     Postgres grants EXECUTE on new functions to PUBLIC by default, so if it
  --     is left open every logged-in user can POST /rest/v1/rpc/_send_push_async
  --     and have the DB attach the x-push-secret for them — which walks straight
  --     around migration 130's Edge Function check.
  --     Fix: REVOKE EXECUTE ON FUNCTION _send_push_async(text[],text,text,text,text,text,jsonb)
  --            FROM public, anon, authenticated;
  if to_regprocedure('public._send_push_async(text[],text,text,text,text,text,jsonb)') is null then
    raise warning 'SECURITY: _send_push_async not found with the expected 7-arg signature — check S1 skipped.';
  elsif has_function_privilege(
       'authenticated',
       'public._send_push_async(text[],text,text,text,text,text,jsonb)',
       'EXECUTE') then
    warn_count := warn_count + 1;
    raise warning 'SECURITY: authenticated can EXECUTE _send_push_async — migration 130''s shared secret is bypassable from the client. REVOKE it.';
  else
    raise notice 'PASS S1: _send_push_async is not callable by app users';
  end if;

  -- ═══════════════════════════════════════════════════════════════════════
  if warn_count = 0 then
    raise notice 'ALL TESTS PASSED (rolled back)';
  else
    raise notice 'ALL FUNCTIONAL TESTS PASSED (rolled back) — % SECURITY WARNING(S) above need a fix', warn_count;
  end if;
end $$;

rollback;
