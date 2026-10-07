-- ============================================================================
-- HomeGuru PMS — RLS & invariant smoke test
--
-- HOW TO RUN: paste this whole file into the Supabase SQL editor and run it.
-- Everything happens inside ONE transaction that is ROLLED BACK at the end —
-- no test data survives, so it is safe to run against the live project.
--
-- Prerequisite: migrations 001–133 plus 140–142, 144 and 145 applied. The
-- preflight block below names exactly which object is missing if you are behind.
-- (134–138 are not exercised here; 139's role mapping is, through PASS 34/35.)
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
--   • 140 The same TC kimlik cannot be used twice — including when written with
--     spaces/dashes — while guests with no TC stay unlimited. A plain UNIQUE on
--     tc_kimlik_encrypted would be inert here (pgp_sym_encrypt is randomised),
--     so the keyed fingerprint column is the thing under test.
--   • 141 The same passport cannot be used twice, case- and punctuation-
--     insensitively; a passport with no letters/digits ('---') is deliberately
--     outside the rule and must still be accepted.
--   • 140/141 The edit path is closed too — otherwise the rule is bypassed in
--     one move (create blank, then edit the number in).
--   • 140/141 Pre-existing duplicate rows were left in place on purpose, so a
--     record may KEEP its already-duplicated TC when saved, while moving onto
--     someone else's is still refused. Without that distinction none of the
--     existing duplicate records could be edited at all.
--   • 142 The fingerprint columns cannot be written directly (which would hide
--     a row from the pre-check), while the backfill-shaped write stays legal so
--     140/141 remain re-runnable.
--   • 144 The three Personel roles (Personel, Personel Bornova, Teknik Personel)
--     READ a reservation's cari hesap, each inside its own region / scope, and
--     nothing more: no insert, update or delete, and soft_delete_entity still
--     refuses them cleanly. Resepsiyon / Temizlik / Onay Bekliyor stay at zero
--     rows, and guest-level rows (no reservation) stay Yönetici-only.
--   • 145 The guest list is shared by every role that makes reservations: a
--     Personel Bornova finds an Ana Grup guest, a Personel finds a Bornova
--     guest, and a guest with no reservation at all is found too — so the
--     duplicate-TC refusal (140) names the existing guest instead of ending in
--     "kayıt size görünmüyor". Seeing is not editing: the update, the Sorunlu
--     flag, the TC / passport card and the Ek Misafir list all stay inside the
--     region until the guest has a reservation there. Temizlik and Onay
--     Bekliyor see exactly what they saw before.
--
-- Note: 143 (the DB-level UNIQUE index) is OPTIONAL and may not be applied —
-- it needs the duplicate rows cleaned up first. The tests never assume it; the
-- one test that cannot exist alongside it skips itself.
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
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'guests'
       and column_name = 'tc_kimlik_hash'
  ) then
    raise exception 'FAIL: migration 140 not applied (guests.tc_kimlik_hash missing)';
  end if;
  -- Deliberately NOT asserting a unique index here: 143 (the DB-level lock) is
  -- optional and may not be applied, because the existing duplicate rows were
  -- left in place on purpose. Uniqueness for NEW guests is enforced by the RPC
  -- pre-check, which is what the tests below actually exercise.
  if to_regproc('public.tc_fingerprint') is null then
    raise exception 'FAIL: migration 140 not applied (tc_fingerprint missing)';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'guests'
       and column_name = 'passport_hash'
  ) then
    raise exception 'FAIL: migration 141 not applied (guests.passport_hash missing)';
  end if;
  if to_regproc('public.passport_fingerprint') is null then
    raise exception 'FAIL: migration 141 not applied (passport_fingerprint missing)';
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = 'guests_fingerprint_guard'
  ) then
    raise exception 'FAIL: migration 142 not applied (guests_fingerprint_guard trigger missing)';
  end if;
  -- 144 widens ledger_select to the Personel roles. pg_policies.qual is the
  -- deparsed USING clause, so the role name appears in it only once 144 has run.
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'ledger_entries'
       and policyname = 'ledger_select' and qual like '%YETKILI%'
  ) then
    raise exception 'FAIL: migration 144 not applied (ledger_select does not let the Personel roles read the cari hesap)';
  end if;
  -- 145 opens the guest list to every role that makes reservations and moves
  -- the old visibility rule into guests_update. Before it, guests_select (103)
  -- never named YETKILI and guests_update (028) had no auth_sees_property().
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'guests'
       and policyname = 'guests_select' and qual like '%YETKILI%'
  ) then
    raise exception 'FAIL: migration 145 not applied (guests_select still hides other-region guests from the Personel roles)';
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'guests'
       and policyname = 'guests_update' and qual like '%auth_sees_property%'
  ) then
    raise exception 'FAIL: migration 145 not applied (guests_update does not carry the edit scope)';
  end if;
  raise notice 'PREFLIGHT OK: migrations 126–132 + 140–142 + 144–145 present';
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

  -- 140/141/142 misafir kimlik tekilliği. TC/pasaport değerleri RASTGELE
  -- üretilir: sabit bir değer canlı bir misafirinkiyle çakışırsa test
  -- sahte şekilde patlardı (her şey rollback edilse bile okuma çakışır).
  v_tc_a     text;
  v_tc_b     text;
  v_tc_c     text;
  v_pp_a     text;
  g_a        uuid;   -- TC'li misafir
  g_b        uuid;   -- farklı TC'li misafir
  g_none     uuid;   -- TC'siz misafir
  g_pp       uuid;   -- pasaportlu misafir
  g_dash     uuid;   -- pasaportu '---' (harf/rakam yok) olan misafir
  g_legacy   uuid;   -- eski (140 oncesi) cift kayit simulasyonu

  -- 144 cari hesap okuma. Kullanıcılar ve kayıtlar PASS 34'ün İÇİNDE açılır:
  -- yukarıdaki ortak fixture'a eklenselerdi önceki testlerin sayımları kayardı.
  u_personel uuid := gen_random_uuid();  -- YETKILI          (Personel)
  u_pbornova uuid := gen_random_uuid();  -- PERSONEL_BORNOVA (Personel Bornova)
  u_teknik   uuid := gen_random_uuid();  -- TEKNIK_PERSONEL  (Teknik Personel)
  p_born     uuid;   -- HOTEL, region 'bornova'
  un_born    uuid;
  rc_hotel   uuid;   -- bitmiş konaklama, Ana Grup oteli
  rc_apart   uuid;   -- bitmiş konaklama, Ana Grup dairesi
  rc_born    uuid;   -- bitmiş konaklama, Bornova
  le_hotel   uuid;   -- cari hareket → rc_hotel
  le_apart   uuid;   -- cari hareket → rc_apart
  le_born    uuid;   -- cari hareket → rc_born
  le_guest   uuid;   -- rezervasyonsuz (misafir düzeyi) cari hareket
  v_amount   numeric;
  v_uid      uuid;   -- yazma denemelerinde sıradaki Personel rolü
  v_le       uuid;   -- o rolün GÖREBİLDİĞİ cari hareket
  v_res      uuid;   -- o hareketin rezervasyonu
  v_who      text;

  -- 145 ortak misafir listesi. PASS 34'ün kullanıcılarını ve Bornova mülkünü
  -- kullanır; kendi kayıtları PASS 35'in İÇİNDE açılır. TC'ler 29'daki gibi
  -- rastgeledir (canlı bir misafirle çakışmasın diye).
  u_ybornova uuid := gen_random_uuid();  -- YONETICI_BORNOVA (Yönetici Bornova)
  v_tc_d     text;
  v_tc_e     text;
  v_tc_f     text;
  g_genel    uuid;   -- yalnızca Ana Grup'ta konaklamış misafir
  g_bornova  uuid;   -- yalnızca Bornova'da konaklamış misafir
  g_orphan   uuid;   -- hiç rezervasyonu olmayan misafir
  gc_genel   uuid;   -- g_genel'in ek misafiri
  r_pick     uuid;   -- Personel Bornova'nın g_genel için açtığı rezervasyon
  v_gf       uuid;   -- sıradaki rolün GÖRDÜĞÜ ama düzenleyememesi gereken misafir
  v_go       uuid;   -- aynı rolün kendi bölgesindeki misafir (pozitif kontrol)
  v_msg      text;

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
  -- 29) 140 — aynı TC kimlik ile ikinci misafir açılamaz.
  --     tc_kimlik_encrypted üzerinde UNIQUE index İŞE YARAMAZ (pgp_sym_encrypt
  --     her çağrıda farklı bytea üretir), o yüzden asıl sınır anahtarlı parmak
  --     izi kolonundaki kısmi UNIQUE index'tir. Burada RPC ön kontrolü,
  --     normalizasyon ve TC'siz misafirlerin serbest kalması sınanır.
  -- ═══════════════════════════════════════════════════════════════════════
  v_tc_a := '9' || lpad((floor(random() * 10000000000))::bigint::text, 10, '0');
  v_tc_b := '8' || lpad((floor(random() * 10000000000))::bigint::text, 10, '0');
  v_tc_c := '7' || lpad((floor(random() * 10000000000))::bigint::text, 10, '0');
  v_pp_a := 'SMOKE' || lpad((floor(random() * 100000))::bigint::text, 5, '0');

  perform pg_temp.login(u_admin);

  select g.id into g_a from create_guest('Smoke TC Bir', v_tc_a) g;
  select count(*) into n from guests
   where id = g_a and tc_kimlik_hash is not null and tc_kimlik_encrypted is not null;
  if n <> 1 then
    raise exception 'FAIL 29: misafir açıldı ama TC parmak izi yazılmadı';
  end if;

  ok := false;
  begin
    perform create_guest('Smoke TC Iki', v_tc_a);
    ok := true;
  exception when others then null;
  end;
  if ok then
    raise exception 'FAIL 29: aynı TC ile ikinci misafir oluşturulabildi';
  end if;

  -- Normalizasyon: boşluk/tire ile yazılmış AYNI TC de engellenmeli, yoksa
  -- kural tek bir boşlukla delinir.
  ok := false;
  begin
    perform create_guest('Smoke TC Uc',
      substr(v_tc_a, 1, 3) || ' ' || substr(v_tc_a, 4, 4) || '-' || substr(v_tc_a, 8, 4));
    ok := true;
  exception when others then null;
  end;
  if ok then
    raise exception 'FAIL 29: boşluk/tire ile yazılan aynı TC kabul edildi (normalizasyon yok)';
  end if;

  -- Pozitif kontrol: kural fazla geniş olmamalı.
  select g.id into g_b from create_guest('Smoke TC Dort', v_tc_b) g;
  if g_b is null then
    raise exception 'FAIL 29: farklı TC ile misafir açılamadı';
  end if;

  -- TC'siz misafirler sınırsız olmalı (kısmi index yalnızca NOT NULL'ı kapsar).
  select g.id into g_none from create_guest('Smoke TCsiz Bir') g;
  perform create_guest('Smoke TCsiz Iki');
  select count(*) into n from guests
   where id = g_none and tc_kimlik_hash is null;
  if n <> 1 then
    raise exception 'FAIL 29: TC girilmeyen misafire parmak izi yazılmış';
  end if;
  raise notice 'PASS 29: aynı TC engellendi (boşluk/tire dâhil), TC''siz misafirler serbest';

  -- ═══════════════════════════════════════════════════════════════════════
  -- 30) 141 — aynı pasaport ile ikinci misafir açılamaz; büyük/küçük harf ve
  --     noktalama farkı kuralı delmemeli. Harf/rakam içermeyen bir pasaport
  --     ('---') ise BİLEREK kapsam dışıdır: şifreli metin "yazıldığı gibi"
  --     saklanır, parmak izi ise stripleyerek üretilir, dolayısıyla NULL kalır.
  -- ═══════════════════════════════════════════════════════════════════════
  select g.id into g_pp from create_guest('Smoke PP Bir', null, v_pp_a) g;
  select count(*) into n from guests where id = g_pp and passport_hash is not null;
  if n <> 1 then
    raise exception 'FAIL 30: pasaport yazıldı ama parmak izi üretilmedi';
  end if;

  ok := false;
  begin
    perform create_guest('Smoke PP Iki', null, '  ' || lower(v_pp_a) || ' ');
    ok := true;
  exception when others then null;
  end;
  if ok then
    raise exception 'FAIL 30: aynı pasaport küçük harf + boşlukla kabul edildi';
  end if;

  -- '---' meşru bir "boş" giriştir: reddedilmemeli ve tekilliğe girmemeli.
  select g.id into g_dash from create_guest('Smoke PP Tire', null, '---') g;
  select count(*) into n from guests
   where id = g_dash and passport_encrypted is not null and passport_hash is null;
  if n <> 1 then
    raise exception 'FAIL 30: harf/rakam içermeyen pasaport beklenmeyen şekilde işlendi';
  end if;
  perform create_guest('Smoke PP Tire Iki', null, '---');
  raise notice 'PASS 30: aynı pasaport engellendi; ''---'' tekillik kapsamı dışında kaldı';

  -- ═══════════════════════════════════════════════════════════════════════
  -- 31) 140/141 — düzenleme yolu da kapalı. Yalnızca create korunsaydı kural
  --     tek hamlede delinirdi: boş TC ile aç, sonra düzenleyip yaz.
  -- ═══════════════════════════════════════════════════════════════════════
  ok := false;
  begin
    perform update_guest(g_b, 'Smoke TC Dort', v_tc_a);
    ok := true;
  exception when others then null;
  end;
  if ok then
    raise exception 'FAIL 31: düzenleme yoluyla aynı TC iki misafire yazılabildi';
  end if;

  -- Kendi TC'sini yeniden göndermek engellenmemeli (kendi satırı hariç tutulur).
  perform update_guest(g_b, 'Smoke TC Dort', v_tc_b);

  -- _tc_kimlik NULL = "dokunma": parmak izi silinmemeli.
  perform update_guest(g_b, 'Smoke TC Dort Yeni Ad');
  select count(*) into n from guests where id = g_b and tc_kimlik_hash is not null;
  if n <> 1 then
    raise exception 'FAIL 31: TC''ye dokunmayan bir güncelleme parmak izini sildi';
  end if;
  perform pg_temp.logout();
  raise notice 'PASS 31: düzenleme yoluyla çakışma engellendi, kendi TC''si ve dokunmama korundu';

  -- ═══════════════════════════════════════════════════════════════════════
  -- 32) 142 — parmak izi kolonları doğrudan yazmaya kapalı. guests_update
  --     (028) dört role DOĞRUDAN UPDATE veriyor ve kolon bazlı grant yok; bu
  --     olmadan elle hazırlanmış tek bir PostgREST çağrısı hash'i NULL yapıp
  --     satırı kısmi index'in kapsamından çıkarabilirdi.
  --     Trigger rolden bağımsızdır; burada TABLO SAHİBİ olarak sınanır, yani
  --     en yetkili yol bile kapalıysa istemci evleviyetle kapalıdır.
  -- ═══════════════════════════════════════════════════════════════════════
  ok := false;
  begin
    update guests set tc_kimlik_hash = null where id = g_a;
    ok := true;
  exception when others then null;
  end;
  if ok then
    raise exception 'FAIL 32: tc_kimlik_hash doğrudan silinebildi — kısmi index atlatılabilir';
  end if;

  ok := false;
  begin
    update guests set passport_hash = null where id = g_pp;
    ok := true;
  exception when others then null;
  end;
  if ok then
    raise exception 'FAIL 32: passport_hash doğrudan silinebildi';
  end if;

  -- Guard fazla geniş olmamalı: ilgisiz kolonlar hâlâ güncellenebilmeli.
  update guests set phone = '5551112233' where id = g_a;

  -- Başka misafirin şifreli TC'sini parmak izsiz kopyalamak = index'e görünmeyen
  -- ikinci bir TC. INSERT kuralı bunu keser.
  ok := false;
  begin
    insert into guests (full_name, tc_kimlik_encrypted)
    select 'Smoke Kopya', tc_kimlik_encrypted from guests where id = g_a;
    ok := true;
  exception when others then null;
  end;
  if ok then
    raise exception 'FAIL 32: şifreli TC parmak izi olmadan kopyalanabildi';
  end if;

  -- Backfill şekli (hash NULL iken yazmak) SERBEST kalmalı — 140/141'in
  -- yeniden çalıştırılabilirliği tam olarak buna bağlıdır.
  update guests set tc_kimlik_hash = tc_fingerprint(v_tc_c) where id = g_none;
  select count(*) into n from guests where id = g_none and tc_kimlik_hash is not null;
  if n <> 1 then
    raise exception 'FAIL 32: guard, backfill biçimindeki yazmayı da engelliyor (140/141 tekrar çalıştırılamaz)';
  end if;
  raise notice 'PASS 32: parmak izi kolonları doğrudan yazmaya kapalı, backfill yolu açık';

  -- ═══════════════════════════════════════════════════════════════════════
  -- 33) 140/141 — ESKI cift kayitlar duzenlenebilir KALMALI. Owner karari
  --     geregi mevcut cift TC'ler yerinde birakildi (2026-08-22: 100 grup /
  --     225 kayit). update_guest'in kontrolu sadece "bu TC baskasinda var mi"
  --     deseydi o kayitlarin HICBIRI kaydedilemezdi: duzenleme formu kendi
  --     TC'sini geri gonderir, kontrol de esini bulup hata verirdi. Kural bu
  --     yuzden "TC GERCEKTEN DEGISIYORSA kontrol et" seklinde.
  --
  --     143 (UNIQUE index) uygulanmissa bu durum veritabaninda zaten imkansiz
  --     oldugu icin fixture kurulamaz ve test atlanir.
  -- ═══════════════════════════════════════════════════════════════════════
  if exists (
    select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
     where c.relname = 'guests_tc_kimlik_unique' and i.indisunique
  ) then
    raise notice 'SKIP 33: 143 uygulanmis, eski cift kayit senaryosu artik olusamaz';
  else
    -- g_a ile AYNI TC'yi tasiyan ikinci satir: tablo sahibi olarak dogrudan
    -- yaziliyor, yani 140 oncesi dunyadan kalma bir kaydin taklidi.
    insert into guests (full_name, tc_kimlik_encrypted, tc_kimlik_hash)
    values ('Smoke Eski Cift', encrypt_sensitive(v_tc_a), tc_fingerprint(v_tc_a))
    returning id into g_legacy;

    perform pg_temp.login(u_admin);

    -- Kendi (zaten cift olan) TC'sini koruyarak kaydetmek SERBEST olmali.
    perform update_guest(g_legacy, 'Smoke Eski Cift Yeni Ad', v_tc_a);
    select count(*) into n from guests
     where id = g_legacy and full_name = 'Smoke Eski Cift Yeni Ad';
    if n <> 1 then
      raise exception 'FAIL 33: eski cift kayit duzenlenemedi — mevcut 225 kayit kilitlenmis olurdu';
    end if;

    -- Ama BASKASININ TC sine gecmek yine yasak olmali.
    ok := false;
    begin
      perform update_guest(g_legacy, 'Smoke Eski Cift Yeni Ad', v_tc_b);
      ok := true;
    exception when others then null;
    end;
    if ok then
      raise exception 'FAIL 33: eski cift kayit baskasinin TC sine tasinabildi';
    end if;

    perform pg_temp.logout();
    raise notice 'PASS 33: eski cift kayitlar duzenlenebilir, baskasinin TC sine tasinamaz';
  end if;

  -- ═══════════════════════════════════════════════════════════════════════
  -- 34) 144 — Personel rolleri rezervasyonun cari hesabını OKUR, yalnızca okur.
  --     Öncesinde ledger_select yalnızca Yönetici + Alt Yönetici'ye açıktı ve
  --     Personel, rezervasyon ekranında Cari Hesap bölümünü hiç görmüyordu.
  --     144 okumayı üç Personel rolüne açar (auth_role() üçünü de YETKILI'ye
  --     eşler — 139).
  --
  --     Sınananlar:
  --       (a–c) her rol KENDİ bölgesi / kapsamı içinde okur. Okuma izni bölge
  --             izolasyonunu delmemeli: Personel Bornova'yı, Personel Bornova
  --             Ana Grup'u görmez; Teknik Personel hepsini görür (117).
  --       (d)   açılmaması gerekenler kapalı kalır.
  --       (e)   zaten görenler görmeye devam eder.
  --       (f)   okuma izni yazma / silme izni DEĞİLDİR. soft_delete_entity özel
  --             olarak sınanır: 132'den beri çağıranın yetkisiyle koşar ve bu
  --             roller artık satırı GÖREBİLDİĞİ için "kayıt bulunamadı" yerine
  --             DELETE'in 0 satır dönmesiyle reddeder — o yol çöp satırını da
  --             geri almak zorunda.
  --
  --     Sayımlar testin KENDİ satırlarıyla sınırlıdır (where id = ...): bu dosya
  --     canlı veritabanında koşar, süzülmemiş bir sayım gerçek cari hareketleri
  --     de sayardı.
  -- ═══════════════════════════════════════════════════════════════════════
  perform pg_temp.logout();

  insert into auth.users
    (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
     raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    ('00000000-0000-0000-0000-000000000000', u_personel, 'authenticated', 'authenticated',
     'hg-smoke-personel@test.local', '', now(),
     '{"provider":"email","providers":["email"]}', '{"full_name":"Smoke Personel"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', u_pbornova, 'authenticated', 'authenticated',
     'hg-smoke-pbornova@test.local', '', now(),
     '{"provider":"email","providers":["email"]}', '{"full_name":"Smoke Personel Bornova"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', u_teknik, 'authenticated', 'authenticated',
     'hg-smoke-teknik@test.local', '', now(),
     '{"provider":"email","providers":["email"]}', '{"full_name":"Smoke Teknik"}', now(), now());

  select count(*) into n from staff_profiles
   where user_id in (u_personel, u_pbornova, u_teknik) and role = 'PENDING';
  if n <> 3 then
    raise exception 'FAIL 34 (fixture): 3 PENDING profil bekleniyordu, % bulundu', n;
  end if;

  update staff_profiles set role = 'YETKILI',          access_scope = 'ALL' where user_id = u_personel;
  update staff_profiles set role = 'PERSONEL_BORNOVA', access_scope = 'ALL' where user_id = u_pbornova;
  update staff_profiles set role = 'TEKNIK_PERSONEL',  access_scope = 'ALL' where user_id = u_teknik;

  insert into properties (name, type, region)
  values ('Smoke Bornova Otel', 'HOTEL', 'bornova') returning id into p_born;
  insert into units (property_id, name, room_type, capacity, base_price)
  values (p_born, 'Smoke Bornova Oda', 'DOUBLE', 2, 1000.00) returning id into un_born;

  -- Üç BİTMİŞ konaklama: 'completed' çift rezervasyon kısıtının dışındadır ve
  -- hiçbir aktivasyon trigger'ını (otomatik borçlandırma, KBS) tetiklemez.
  insert into reservations
    (property_id, unit_id, guest_id, stay_start, stay_end, status,
     total_amount, deposit, created_by)
  values
    (p_hotel, un_hotel, g_guest, now() - interval '60 days', now() - interval '58 days',
     'completed', 1000.00, 0, u_reception)
  returning id into rc_hotel;

  insert into reservations
    (property_id, unit_id, guest_id, stay_start, stay_end, status,
     total_amount, deposit, created_by)
  values
    (p_apart, un_apart, g_guest, now() - interval '60 days', now() - interval '58 days',
     'completed', 2000.00, 0, u_reception)
  returning id into rc_apart;

  insert into reservations
    (property_id, unit_id, guest_id, stay_start, stay_end, status,
     total_amount, deposit, created_by)
  values
    (p_born, un_born, g_guest, now() - interval '60 days', now() - interval '58 days',
     'completed', 3000.00, 0, u_reception)
  returning id into rc_born;

  insert into ledger_entries (guest_id, reservation_id, type, amount, currency, note, created_by)
  values (g_guest, rc_hotel, 'DEBT', 1000.00, 'TRY', 'Smoke cari otel', u_admin)
  returning id into le_hotel;
  insert into ledger_entries (guest_id, reservation_id, type, amount, currency, note, created_by)
  values (g_guest, rc_apart, 'DEBT', 2000.00, 'TRY', 'Smoke cari daire', u_admin)
  returning id into le_apart;
  insert into ledger_entries (guest_id, reservation_id, type, amount, currency, note, created_by)
  values (g_guest, rc_born, 'DEBT', 3000.00, 'TRY', 'Smoke cari bornova', u_admin)
  returning id into le_born;
  -- Rezervasyona bağlı OLMAYAN hareket: 144 bunu Personel'e açmamalı.
  insert into ledger_entries (guest_id, reservation_id, type, amount, currency, note, created_by)
  values (g_guest, NULL, 'DEBT', 4000.00, 'TRY', 'Smoke cari misafir', u_admin)
  returning id into le_guest;

  -- (a) Personel — Ana Grup, kapsam ALL.
  perform pg_temp.login(u_personel);
  select count(*) into n from ledger_entries where id in (le_hotel, le_apart);
  if n <> 2 then
    raise exception 'FAIL 34a: Personel kendi bölgesindeki cari hareketleri göremiyor (2 beklenirken %)', n;
  end if;
  select count(*) into n from ledger_entries where id = le_born;
  if n <> 0 then
    raise exception 'FAIL 34a: Personel BORNOVA cari hareketini görüyor — okuma izni bölge izolasyonunu deldi';
  end if;
  select count(*) into n from ledger_entries where id = le_guest;
  if n <> 0 then
    raise exception 'FAIL 34a: Personel rezervasyonsuz (misafir düzeyi) cari hareketi görüyor';
  end if;
  perform pg_temp.logout();

  -- Kapsam da geçerli kalmalı: yalnızca otellere bakan Personel daireyi görmez.
  update staff_profiles set access_scope = 'HOTELS' where user_id = u_personel;
  perform pg_temp.login(u_personel);
  select count(*) into n from ledger_entries where id = le_hotel;
  if n <> 1 then
    raise exception 'FAIL 34a: HOTELS kapsamlı Personel otelin cari hareketini göremiyor';
  end if;
  select count(*) into n from ledger_entries where id = le_apart;
  if n <> 0 then
    raise exception 'FAIL 34a: HOTELS kapsamlı Personel DAİRENİN cari hareketini görüyor — kapsam delindi';
  end if;
  perform pg_temp.logout();
  update staff_profiles set access_scope = 'ALL' where user_id = u_personel;

  -- (b) Personel Bornova — yalnızca Bornova.
  perform pg_temp.login(u_pbornova);
  select count(*) into n from ledger_entries where id = le_born;
  if n <> 1 then
    raise exception 'FAIL 34b: Personel Bornova kendi bölgesinin cari hareketini göremiyor';
  end if;
  select count(*) into n from ledger_entries where id in (le_hotel, le_apart, le_guest);
  if n <> 0 then
    raise exception 'FAIL 34b: Personel Bornova ANA GRUP cari hareketlerini görüyor (% satır) — bölge izolasyonu delindi', n;
  end if;
  perform pg_temp.logout();

  -- (c) Teknik Personel — tüm bölgeler (117), ama misafir düzeyi hareket yine yok.
  perform pg_temp.login(u_teknik);
  select count(*) into n from ledger_entries where id in (le_hotel, le_apart, le_born);
  if n <> 3 then
    raise exception 'FAIL 34c: Teknik Personel üç bölgenin cari hareketlerini göremiyor (3 beklenirken %)', n;
  end if;
  select count(*) into n from ledger_entries where id = le_guest;
  if n <> 0 then
    raise exception 'FAIL 34c: Teknik Personel rezervasyonsuz (misafir düzeyi) cari hareketi görüyor';
  end if;
  perform pg_temp.logout();

  -- (d) Açılmaması gerekenler: Resepsiyon, Temizlik, Onay Bekliyor.
  perform pg_temp.login(u_reception);
  select count(*) into n from ledger_entries where id in (le_hotel, le_apart, le_born, le_guest);
  if n <> 0 then raise exception 'FAIL 34d: Resepsiyon cari hareket görüyor (% satır)', n; end if;
  perform pg_temp.login(u_house);
  select count(*) into n from ledger_entries where id in (le_hotel, le_apart, le_born, le_guest);
  if n <> 0 then raise exception 'FAIL 34d: Temizlik cari hareket görüyor (% satır)', n; end if;
  perform pg_temp.login(u_pending);
  select count(*) into n from ledger_entries where id in (le_hotel, le_apart, le_born, le_guest);
  if n <> 0 then raise exception 'FAIL 34d: Onay Bekliyor cari hareket görüyor (% satır)', n; end if;
  perform pg_temp.logout();

  -- (e) Zaten görenler değişmedi: Alt Yönetici (tüm bölgeler, 102) üç
  --     rezervasyon hareketini, Yönetici dördünü de görür.
  perform pg_temp.login(u_manager);
  select count(*) into n from ledger_entries where id in (le_hotel, le_apart, le_born);
  if n <> 3 then
    raise exception 'FAIL 34e: Alt Yönetici cari hareketleri artık göremiyor (3 beklenirken %)', n;
  end if;
  perform pg_temp.login(u_admin);
  select count(*) into n from ledger_entries where id in (le_hotel, le_apart, le_born, le_guest);
  if n <> 4 then
    raise exception 'FAIL 34e: Yönetici cari hareketleri artık göremiyor (4 beklenirken %)', n;
  end if;

  -- Pozitif kontrol (hâlâ Yönetici olarak): aşağıda Personel'in REDDEDİLMESİNİ
  -- beklediğimiz INSERT'in aynısı yetkili biri için ÇALIŞMALI. Çalışmazsa
  -- Personel'in reddi yetkiden değil bozuk bir satırdan geliyor olabilirdi ve
  -- (f) yanlış sebepten geçerdi.
  begin
    insert into ledger_entries (guest_id, reservation_id, type, amount, currency, note, created_by)
    values (g_guest, rc_hotel, 'DEBT', 1.00, 'TRY', 'Smoke kontrol ekleme', u_admin);
  exception when others then
    raise exception 'FAIL 34 (kontrol): Yönetici aynı cari hareketi ekleyemedi, test satırı hatalı: %', sqlerrm;
  end;
  perform pg_temp.logout();

  -- (f) Üç Personel rolü de, GÖREBİLDİĞİ bir hareket üzerinde, hiçbir şey
  --     yazamaz. login() blokların DIŞINDA: istisna savepoint'e geri sarar ve
  --     blok içinde yapılmış bir login'i de geri alırdı.
  for i in 1..3 loop
    v_uid := (array[u_personel, u_pbornova, u_teknik])[i];
    v_le  := (array[le_hotel,   le_born,    le_hotel])[i];
    v_res := (array[rc_hotel,   rc_born,    rc_hotel])[i];
    v_who := (array['Personel', 'Personel Bornova', 'Teknik Personel'])[i];

    perform pg_temp.login(v_uid);

    -- Önce: bu rol bu satırı gerçekten GÖRÜYOR olmalı. Görmüyorsa aşağıdaki
    -- UPDATE / DELETE "0 satır" sonuçları hiçbir şey kanıtlamazdı.
    select count(*) into n from ledger_entries where id = v_le;
    if n <> 1 then
      raise exception 'FAIL 34f (kontrol): % kendi cari hareketini göremiyor, yazma testleri anlamsız', v_who;
    end if;

    -- INSERT (ekrandaki "+ Ekstra Ücret"in yolu). Yalnızca yetki hatası kabul:
    -- başka bir hata testi durdurur.
    ok := false;
    begin
      insert into ledger_entries (guest_id, reservation_id, type, amount, currency, note, created_by)
      values (g_guest, v_res, 'DEBT', 1.00, 'TRY', 'Smoke yetkisiz ekleme', v_uid);
      ok := true;
    exception when insufficient_privilege then null;
    end;
    if ok then
      raise exception 'FAIL 34f: % cari hareket EKLEYEBİLDİ', v_who;
    end if;

    -- UPDATE: politika yok → RLS 0 satıra indirir (ya da tablo yetkisi reddeder).
    n := 0;
    begin
      update ledger_entries set amount = 1.00 where id = v_le;
      get diagnostics n = row_count;
    exception when insufficient_privilege then n := 0;
    end;
    if n <> 0 then
      raise exception 'FAIL 34f: % cari hareketi DEĞİŞTİREBİLDİ', v_who;
    end if;

    -- DELETE: ledger_delete yalnızca Yönetici (017).
    n := 0;
    begin
      delete from ledger_entries where id = v_le;
      get diagnostics n = row_count;
    exception when insufficient_privilege then n := 0;
    end;
    if n <> 0 then
      raise exception 'FAIL 34f: % cari hareketi SİLEBİLDİ', v_who;
    end if;

    -- soft_delete_entity (ekrandaki silme simgesinin yolu).
    ok := false;
    begin
      perform soft_delete_entity('ledger_entries', v_le);
      ok := true;
    exception when others then null;
    end;
    if ok then
      raise exception 'FAIL 34f: % cari hareketi Çöp Kutusu''na GÖNDEREBİLDİ', v_who;
    end if;

    perform pg_temp.logout();

    -- Tablo sahibi olarak: hiçbir iz kalmamış olmalı.
    select count(*) into n from ledger_entries where note = 'Smoke yetkisiz ekleme';
    if n <> 0 then
      raise exception 'FAIL 34f: % için reddedilen ekleme yine de satır bıraktı', v_who;
    end if;
    select amount into v_amount from ledger_entries where id = v_le;
    if v_amount is null then
      raise exception 'FAIL 34f: % için reddedilen silmeye rağmen cari hareket kayboldu', v_who;
    end if;
    if v_amount <> (array[1000.00, 3000.00, 1000.00])[i] then
      raise exception 'FAIL 34f: % için reddedilen değişikliğe rağmen tutar değişti (%)', v_who, v_amount;
    end if;
    select count(*) into n from trash_entries
     where entity_type = 'ledger_entries' and entity_id = v_le;
    if n <> 0 then
      raise exception 'FAIL 34f: % için reddedilen silme çöp satırı bıraktı (ROW_COUNT geri sarması eksik)', v_who;
    end if;
  end loop;

  raise notice 'PASS 34: Personel rolleri cari hesabı kendi bölgesinde okur; ekleyemez, değiştiremez, silemez';

  -- ═══════════════════════════════════════════════════════════════════════
  -- 35) 145 — misafir listesi, rezervasyon açan HER rol için ortaktır.
  --     Öncesinde guests_select (103) bölgeye bağlı bir role yalnızca kendi
  --     görebildiği bir rezervasyonu olan misafiri gösteriyordu. Sonuç bir
  --     çıkmazdı: Ana Grup'ta kayıtlı bir misafir Bornova'ya geldiğinde
  --     personel onu listede bulamıyor, yeni kayıt açmayı deniyor ve 140'ın TC
  --     kuralı "kayıt size görünmüyor" diyerek onu da reddediyordu. Hiç
  --     rezervasyonu olmayan misafir ise her Personel için aynı çıkmazdı.
  --
  --     Sınananlar:
  --       (a) rezervasyon açan roller üç misafiri de görür — iki yönde ve
  --           rezervasyonsuz misafir dâhil.
  --       (b) açılmaması gerekenler olduğu gibi kalır (Temizlik, Onay Bekliyor).
  --       (c) ekran görüntüsündeki durum: aynı TC yine reddedilir, ama mesaj
  --           artık mevcut misafirin ADINI verir.
  --       (d) görmek düzenlemek DEĞİLDİR. guests_update (028) yalnızca role
  --           bakıyordu ve kapsamını SELECT politikasından alıyordu; liste
  --           açılınca düzenleme de sessizce açılırdı. 145 eski kuralı
  --           guests_update'in içine taşır. Burada dört yazma yolu da sınanır:
  --           doğrudan UPDATE, set_guest_problematic (SECURITY INVOKER),
  --           update_guest ve kartın kendisi (get_guest_decrypted).
  --       (e) ek misafirler bölgede kalır.
  --       (f) "seçilebilir": Personel Bornova o misafir için rezervasyon açar;
  --           açtıktan sonra misafir onun için sıradan bir Bornova misafiridir.
  --
  --     Sayımlar testin KENDİ satırlarıyla sınırlıdır (where id = ...).
  --     PASS 34'ün kullanıcılarına ve Bornova mülküne dayanır.
  -- ═══════════════════════════════════════════════════════════════════════
  perform pg_temp.logout();

  insert into auth.users
    (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
     raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    ('00000000-0000-0000-0000-000000000000', u_ybornova, 'authenticated', 'authenticated',
     'hg-smoke-ybornova@test.local', '', now(),
     '{"provider":"email","providers":["email"]}', '{"full_name":"Smoke Yonetici Bornova"}', now(), now());

  select count(*) into n from staff_profiles
   where user_id = u_ybornova and role = 'PENDING';
  if n <> 1 then
    raise exception 'FAIL 35 (fixture): 1 PENDING profil bekleniyordu, % bulundu', n;
  end if;
  update staff_profiles set role = 'YONETICI_BORNOVA', access_scope = 'ALL' where user_id = u_ybornova;

  v_tc_d := '6' || lpad((floor(random() * 10000000000))::bigint::text, 10, '0');
  v_tc_e := '5' || lpad((floor(random() * 10000000000))::bigint::text, 10, '0');
  v_tc_f := '4' || lpad((floor(random() * 10000000000))::bigint::text, 10, '0');

  perform pg_temp.login(u_admin);
  select g.id into g_genel   from create_guest('Smoke Genel Misafir', v_tc_d) g;
  select g.id into g_bornova from create_guest('Smoke Bornova Misafir', v_tc_e) g;
  select g.id into g_orphan  from create_guest('Smoke Rezervasyonsuz Misafir', v_tc_f) g;
  perform pg_temp.logout();

  if g_genel is null or g_bornova is null or g_orphan is null then
    raise exception 'FAIL 35 (fixture): test misafirleri açılamadı';
  end if;

  -- g_genel yalnızca Ana Grup'ta, g_bornova yalnızca Bornova'da konakladı;
  -- g_orphan'ın rezervasyonu yok. İkisi de BİTMİŞ konaklama (PASS 34 gerekçesi).
  insert into reservations
    (property_id, unit_id, guest_id, stay_start, stay_end, status,
     total_amount, deposit, created_by)
  values
    (p_hotel, un_hotel, g_genel, now() - interval '70 days', now() - interval '68 days',
     'completed', 1000.00, 0, u_reception);

  insert into reservations
    (property_id, unit_id, guest_id, stay_start, stay_end, status,
     total_amount, deposit, created_by)
  values
    (p_born, un_born, g_bornova, now() - interval '70 days', now() - interval '68 days',
     'completed', 1000.00, 0, u_reception);

  insert into guest_companions (guest_id, full_name)
  values (g_genel, 'Smoke Ek Misafir')
  returning id into gc_genel;

  -- (a) Rezervasyon açan dört bölge/kapsam rolü üç misafiri de görür.
  for i in 1..4 loop
    v_uid := (array[u_pbornova, u_personel, u_ybornova, u_teknik])[i];
    v_who := (array['Personel Bornova', 'Personel', 'Yönetici Bornova', 'Teknik Personel'])[i];

    perform pg_temp.login(v_uid);
    select count(*) into n from guests where id in (g_genel, g_bornova, g_orphan);
    perform pg_temp.logout();
    if n <> 3 then
      raise exception 'FAIL 35a: % üç misafirden yalnızca % tanesini görüyor (Ana Grup + Bornova + rezervasyonsuz = 3 bekleniyordu)', v_who, n;
    end if;
  end loop;

  -- (b) Açılmaması gerekenler. Temizlik rezervasyon açmaz: yalnızca görebildiği
  --     bir konaklamanın misafirini görmeye devam eder (g_genel → Smoke Otel).
  perform pg_temp.login(u_house);
  select count(*) into n from guests where id = g_genel;
  if n <> 1 then
    raise exception 'FAIL 35b: Temizlik, görebildiği bir konaklamanın misafirini artık göremiyor';
  end if;
  select count(*) into n from guests where id in (g_bornova, g_orphan);
  if n <> 0 then
    raise exception 'FAIL 35b: Temizlik başka bölgenin / rezervasyonsuz misafiri görüyor (% satır) — liste yalnızca rezervasyon açan rollere açılmalıydı', n;
  end if;
  perform pg_temp.login(u_pending);
  select count(*) into n from guests where id in (g_genel, g_bornova, g_orphan);
  if n <> 0 then raise exception 'FAIL 35b: Onay Bekliyor misafir görüyor (% satır)', n; end if;

  -- Zaten hepsini görenler değişmedi.
  perform pg_temp.login(u_reception);
  select count(*) into n from guests where id in (g_genel, g_bornova, g_orphan);
  if n <> 3 then raise exception 'FAIL 35b: Resepsiyon misafirleri artık göremiyor (3 beklenirken %)', n; end if;
  perform pg_temp.login(u_manager);
  select count(*) into n from guests where id in (g_genel, g_bornova, g_orphan);
  if n <> 3 then raise exception 'FAIL 35b: Alt Yönetici misafirleri artık göremiyor (3 beklenirken %)', n; end if;
  perform pg_temp.login(u_admin);
  select count(*) into n from guests where id in (g_genel, g_bornova, g_orphan);
  if n <> 3 then raise exception 'FAIL 35b: Yönetici misafirleri artık göremiyor (3 beklenirken %)', n; end if;
  perform pg_temp.logout();

  -- (c) Ekran görüntüsündeki durum, iki yönde ve rezervasyonsuz misafir için.
  --     Aynı TC yine reddedilmeli (140 kuralı yerinde), ama mesaj mevcut
  --     misafirin adını vermeli: personel o adı Misafir alanında arayıp seçer.
  for i in 1..3 loop
    v_uid := (array[u_pbornova, u_personel, u_pbornova])[i];
    v_who := (array['Personel Bornova / Ana Grup misafiri',
                    'Personel / Bornova misafiri',
                    'Personel Bornova / rezervasyonsuz misafir'])[i];

    perform pg_temp.login(v_uid);
    ok := false;
    v_msg := null;
    begin
      perform create_guest('Smoke Tekrar Kayit', (array[v_tc_d, v_tc_e, v_tc_f])[i]);
      ok := true;
    exception when others then v_msg := sqlerrm;
    end;
    perform pg_temp.logout();

    if ok then
      raise exception 'FAIL 35c: % — aynı TC ile ikinci misafir AÇILABİLDİ (140 kuralı delindi)', v_who;
    end if;
    if v_msg is null
       or v_msg not like '%' || (array['Smoke Genel Misafir',
                                       'Smoke Bornova Misafir',
                                       'Smoke Rezervasyonsuz Misafir'])[i] || '%'
       or v_msg not like '%mevcut misafiri kullanın%'
       or v_msg like '%görünmüyor%' then
      raise exception 'FAIL 35c: % — mesaj mevcut misafirin adını vermiyor, personel yine çıkmazda: %', v_who, v_msg;
    end if;
  end loop;

  -- (d) Görmek düzenlemek değildir. v_gf: rolün GÖRDÜĞÜ ama kendi bölgesinde
  --     rezervasyonu olmayan misafir; v_go: kendi bölgesindeki misafir.
  --     login() blokların DIŞINDA (PASS 34f notu).
  for i in 1..4 loop
    v_uid := (array[u_pbornova, u_personel, u_ybornova, u_personel])[i];
    v_gf  := (array[g_genel,    g_bornova,  g_genel,    g_orphan])[i];
    v_go  := (array[g_bornova,  g_genel,    g_bornova,  g_genel])[i];
    v_who := (array['Personel Bornova / Ana Grup misafiri',
                    'Personel / Bornova misafiri',
                    'Yönetici Bornova / Ana Grup misafiri',
                    'Personel / rezervasyonsuz misafir'])[i];

    perform pg_temp.login(v_uid);

    -- Önce: bu rol satırı gerçekten GÖRÜYOR olmalı. Görmüyorsa aşağıdaki
    -- "0 satır" sonuçları hiçbir şey kanıtlamazdı.
    select count(*) into n from guests where id = v_gf;
    if n <> 1 then
      raise exception 'FAIL 35d (kontrol): % — misafir görünmüyor, yazma testleri anlamsız', v_who;
    end if;

    -- Doğrudan UPDATE (elle hazırlanmış bir API çağrısının yolu).
    n := 0;
    begin
      update guests set phone = '5550000035' where id = v_gf;
      get diagnostics n = row_count;
    exception when insufficient_privilege then n := 0;
    end;
    if n <> 0 then
      raise exception 'FAIL 35d: % — misafir doğrudan UPDATE ile DEĞİŞTİRİLEBİLDİ', v_who;
    end if;

    -- "Sorunlu Misafir" işareti: SECURITY INVOKER, yani aynı politikaya tabi.
    -- 0 satır günceller ve hata vermez; sonucu aşağıda tablo sahibi doğrular.
    begin
      perform set_guest_problematic(v_gf, true, 'Smoke yetkisiz isaret');
    exception when insufficient_privilege then null;
    end;

    -- Düzenleme formunun yolu.
    ok := false;
    begin
      perform update_guest(v_gf, 'Smoke Yetkisiz Ad');
      ok := true;
    exception when others then null;
    end;
    if ok then
      raise exception 'FAIL 35d: % — misafir update_guest ile DEĞİŞTİRİLEBİLDİ', v_who;
    end if;

    -- Kart (TC / pasaport) Personel için kapalı kalır. Yönetici Bornova hariç:
    -- get_guest_decrypted ona zaten açıktı (139) ve 145 buna dokunmuyor.
    if (array[true, true, false, true])[i] then
      ok := false;
      begin
        perform 1 from get_guest_decrypted(v_gf);
        ok := true;
      exception when insufficient_privilege then null;
      end;
      if ok then
        raise exception 'FAIL 35d: % — misafir kartı (TC / pasaport) AÇILABİLDİ', v_who;
      end if;
    end if;

    -- Pozitif kontrol: aynı rol KENDİ bölgesinin misafirini düzenlemeye devam
    -- eder. Edemiyorsa yukarıdaki retler kuraldan değil, fazla daraltılmış bir
    -- politikadan geliyor demektir.
    n := 0;
    update guests set phone = '5550000036' where id = v_go;
    get diagnostics n = row_count;
    if n <> 1 then
      raise exception 'FAIL 35d (kontrol): % — rol KENDİ bölgesinin misafirini artık düzenleyemiyor (% satır); düzenleme kuralı fazla daraltılmış', v_who, n;
    end if;

    perform pg_temp.logout();

    -- Tablo sahibi olarak: reddedilen yazmalar iz bırakmamış olmalı.
    select count(*) into n from guests
     where id = v_gf
       and phone is distinct from '5550000035'
       and is_problematic = false
       and full_name <> 'Smoke Yetkisiz Ad';
    if n <> 1 then
      raise exception 'FAIL 35d: % — reddedilen düzenleme yine de iz bıraktı', v_who;
    end if;
  end loop;

  -- Alt Yönetici (bölgesiz) herkesi düzenlemeye devam eder: rezervasyonsuz
  -- misafir dâhil. Düzenleme kuralı 103'teki görünürlüğün aynısıdır.
  perform pg_temp.login(u_manager);
  n := 0;
  update guests set phone = '5550000037' where id = g_orphan;
  get diagnostics n = row_count;
  perform pg_temp.logout();
  if n <> 1 then
    raise exception 'FAIL 35d (kontrol): Alt Yönetici rezervasyonsuz misafiri artık düzenleyemiyor (% satır)', n;
  end if;

  -- (e) Ek misafirler bölgede kalır: g_genel'in ek misafirini Personel Bornova
  --     görmez, Ana Grup Personeli görür.
  perform pg_temp.login(u_pbornova);
  select count(*) into n from guest_companions where id = gc_genel;
  if n <> 0 then
    raise exception 'FAIL 35e: Personel Bornova, Ana Grup misafirinin EK MİSAFİRİNİ görüyor';
  end if;
  perform pg_temp.login(u_personel);
  select count(*) into n from guest_companions where id = gc_genel;
  if n <> 1 then
    raise exception 'FAIL 35e (kontrol): Personel kendi bölgesindeki misafirin ek misafirini göremiyor';
  end if;
  perform pg_temp.logout();

  -- (f) "Seçilebilir": Personel Bornova, listeden bulduğu Ana Grup misafiri
  --     için Bornova'da rezervasyon açar. Açtıktan sonra misafir onun için
  --     sıradan bir Bornova misafiridir: düzenler, kartını açar, ek misafirini
  --     görür.
  perform pg_temp.login(u_pbornova);
  begin
    insert into reservations
      (property_id, unit_id, guest_id, stay_start, stay_end, status,
       total_amount, deposit, created_by)
    values
      (p_born, un_born, g_genel, now() + interval '200 days', now() + interval '202 days',
       'upcoming', 2000.00, 0, u_pbornova)
    returning id into r_pick;
  exception when others then
    raise exception 'FAIL 35f: Personel Bornova, seçtiği Ana Grup misafiri için Bornova rezervasyonu AÇAMADI: %', sqlerrm;
  end;
  if r_pick is null then
    raise exception 'FAIL 35f: rezervasyon açıldı ama kimliği dönmedi';
  end if;

  n := 0;
  update guests set phone = '5550000038' where id = g_genel;
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL 35f: rezervasyon açıldıktan sonra misafir hâlâ düzenlenemiyor (% satır)', n;
  end if;

  begin
    perform 1 from get_guest_decrypted(g_genel);
  exception when others then
    raise exception 'FAIL 35f: rezervasyon açıldıktan sonra misafir kartı hâlâ açılmıyor: %', sqlerrm;
  end;

  select count(*) into n from guest_companions where id = gc_genel;
  if n <> 1 then
    raise exception 'FAIL 35f: rezervasyon açıldıktan sonra ek misafir hâlâ görünmüyor';
  end if;
  perform pg_temp.logout();

  raise notice 'PASS 35: misafir listesi rezervasyon açan her role ortak; düzenleme, kart ve ek misafir bölgede kaldı';

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

  -- (b) tc_fingerprint / passport_fingerprint are SECURITY DEFINER and read the
  --     Vault key. If either is callable by app users it becomes an oracle: any
  --     logged-in user could fingerprint an arbitrary TC / passport and match it
  --     against guests, i.e. ask "is this person in the system?" without limit.
  --     Postgres grants EXECUTE on new functions to PUBLIC, and `authenticated`
  --     is a member of PUBLIC — so revoking from anon+authenticated alone does
  --     nothing; the REVOKE must include public (migrations 140/141 do).
  if to_regprocedure('public.tc_fingerprint(text)') is null then
    raise warning 'SECURITY: tc_fingerprint(text) not found — check S2 skipped.';
  elsif has_function_privilege('authenticated', 'public.tc_fingerprint(text)', 'EXECUTE') then
    warn_count := warn_count + 1;
    raise warning 'SECURITY: authenticated can EXECUTE tc_fingerprint — TC existence oracle. REVOKE it FROM public.';
  else
    raise notice 'PASS S2: tc_fingerprint is not callable by app users';
  end if;

  if to_regprocedure('public.passport_fingerprint(text)') is null then
    raise warning 'SECURITY: passport_fingerprint(text) not found — check S3 skipped.';
  elsif has_function_privilege('authenticated', 'public.passport_fingerprint(text)', 'EXECUTE') then
    warn_count := warn_count + 1;
    raise warning 'SECURITY: authenticated can EXECUTE passport_fingerprint — passport existence oracle. REVOKE it FROM public.';
  else
    raise notice 'PASS S3: passport_fingerprint is not callable by app users';
  end if;

  -- ═══════════════════════════════════════════════════════════════════════
  if warn_count = 0 then
    raise notice 'ALL TESTS PASSED (rolled back)';
  else
    raise notice 'ALL FUNCTIONAL TESTS PASSED (rolled back) — % SECURITY WARNING(S) above need a fix', warn_count;
  end if;
end $$;

rollback;
