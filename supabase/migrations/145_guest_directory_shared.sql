-- =============================================================================
-- HomeGuru PMS — migration 145
-- The guest list is shared by every role that makes reservations.
-- =============================================================================
-- Owner decision (2026-10-07), after a Personel Bornova hit this at the desk:
--
--     "Bu TC kimlik numarası sistemde zaten kayıtlı, ancak kayıt size
--      görünmüyor (başka bir bölgede oluşturulmuş olabilir) …"
--
-- A dead end. The guest exists, so 140 refuses a second record with the same
-- TC — but guests_select (103) showed a region-bound role only the guests who
-- already had a reservation in a mülk that role can see, so the existing
-- record could not be selected either. Three kinds of guest were unreachable:
--   * an Ana Grup guest, for the Bornova roles
--   * a Bornova guest, for an Ana Grup Personel
--   * a guest with NO reservation (form abandoned, reservation deleted), for
--     every Personel role in both regions
-- 140's own header named this as a known consequence and said the lasting fix
-- was to loosen 103. This is that fix.
--
-- The owner chose:
--   1. ALL guests, BOTH ways — everyone who makes reservations finds every
--      guest, including the ones with no reservation.
--   2. FIND, SELECT AND LIST only — nothing else opens. A Personel still cannot
--      open the card (TC / passport) or edit a guest until that guest has a
--      reservation in the Personel's own region.
--
-- -----------------------------------------------------------------------------
-- CHANGE 1 — guests_update: the edit scope is written down (done FIRST)
-- -----------------------------------------------------------------------------
-- guests_update (028) is role-only: it has no region rule of its own. It was
-- safe only by accident — PostgreSQL applies the SELECT policy to an UPDATE
-- that has a WHERE clause, so the edit scope silently followed guests_select.
-- Widening guests_select alone would therefore have let a Personel Bornova
-- EDIT an Ana Grup guest through a direct API call, and flag one "Sorunlu"
-- through set_guest_problematic (043, SECURITY INVOKER — same policy).
--
-- So the rule guests_select had until today (103) is copied into guests_update
-- verbatim, ANDed with 028's role list. The result is exactly today's
-- effective edit scope — nobody gains an edit and nobody loses one.
--
-- It runs before change 2 on purpose: at no point, not even between two
-- statements, is the list wide while the edit rule is still role-only.
--
-- -----------------------------------------------------------------------------
-- CHANGE 2 — guests_select: one list for the roles that make reservations
-- -----------------------------------------------------------------------------
-- The role list is the one reservations_insert (033) uses. auth_role() (139)
-- maps YONETICI_BORNOVA to PROPERTY_MANAGER and PERSONEL_BORNOVA /
-- TEKNIK_PERSONEL to YETKILI, so four names cover every reservation-making
-- role and the Bornova variants cannot drift apart from their base roles.
--
-- The EXISTS path stays for the one role outside that list that reads guests:
-- Temizlik (HOUSEKEEPING) keeps seeing the guests of the stays it can see, and
-- nothing more. PENDING and a missing / deleted profile still get zero rows
-- (auth_sees_property refuses both).
--
-- -----------------------------------------------------------------------------
-- CHANGE 3 — auth_sees_guest(): the mirror the RPCs use
-- -----------------------------------------------------------------------------
-- create_guest / update_guest (141) are SECURITY DEFINER, so RLS is off inside
-- them; they ask auth_sees_guest() whether the caller may be told the name of
-- the guest that already holds a TC / passport. It is kept identical to
-- guests_select. With it, the refusal reads
--     "Bu TC kimlik numarası zaten kayıtlı: <Ad Soyad>. … mevcut misafiri kullanın."
-- and the personel picks that guest in the reservation form's Misafir field.
--
-- -----------------------------------------------------------------------------
-- DELIBERATELY NOT TOUCHED — seeing is not opening, and it is not editing
-- -----------------------------------------------------------------------------
--   * create_guest / update_guest (141): bodies untouched. They only CALL
--     auth_sees_guest, so there is nothing to re-create and no chance of
--     pasting a stale body over a newer one. update_guest keeps its own scope
--     check ("Bu misafire erişim yetkiniz yok").
--   * get_guest_decrypted / get_companions_decrypted (139): a Personel opens
--     the card only for a guest with a reservation it can see. (Yönetici
--     Bornova could already open any card — that predates this file.)
--   * guest_companions_select / _modify (113): Ek Misafir keeps 103's rule.
--     113 calls itself a mirror of guests_select; from here on it is not.
--   * guests_insert (028), guests_delete (003).
--   * Everything about reservations, cari, kasa and tahsilat. Region isolation
--     of money and stays is not affected: this file only names `guests`.
--
-- What does widen, and should be known: these roles can now read the whole
-- plain guest row for every guest through the API — name, phone, e-mail,
-- address, nationality, the Sorunlu note. TC and passport are stored encrypted
-- and stay behind get_guest_decrypted.
--
-- ⚠ ORDER: none with the frontend. The live app already reads the list through
-- this policy, so the change is in effect the moment this file has run — no
-- deploy. It does not depend on 144 either; only the smoke test needs both.
--
-- Safe to re-run. An UNDO block is at the bottom of the file.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Preconditions — checked before anything is changed
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  _src text;
  _n   int;
  _odd text;
BEGIN
  IF to_regprocedure('public.auth_sees_guest(uuid)') IS NULL THEN
    RAISE EXCEPTION '145: auth_sees_guest(uuid) is missing — run 140_guest_tc_unique.sql first.';
  END IF;
  IF to_regprocedure('public.auth_region()') IS NULL
     OR to_regprocedure('public.auth_sees_property(uuid)') IS NULL THEN
    RAISE EXCEPTION '145: auth_region() / auth_sees_property(uuid) are missing — the region migrations are not applied.';
  END IF;

  -- The role list below relies on 139's mapping. Without it a Personel Bornova
  -- or a Teknik Personel would silently NOT get the list the owner asked for.
  SELECT prosrc INTO _src FROM pg_proc WHERE oid = to_regprocedure('public.auth_role()');
  IF _src IS NULL
     OR _src NOT LIKE '%WHEN role = ''YONETICI_BORNOVA'' THEN ''PROPERTY_MANAGER''%'
     OR _src NOT LIKE '%WHEN role = ''PERSONEL_BORNOVA'' THEN ''YETKILI''%'
     OR _src NOT LIKE '%WHEN role = ''TEKNIK_PERSONEL'' THEN ''YETKILI''%' THEN
    RAISE EXCEPTION '145: auth_role() does not map the Bornova / Teknik roles the way migration 139 defines — apply 139 first.';
  END IF;

  -- The reasoning in this file assumes guests carries exactly four policies,
  -- one per command, all permissive. Any other policy (a FOR ALL one, a
  -- restrictive one, a second UPDATE one) could let an edit past the rule
  -- written below — so stop and report instead of guessing.
  SELECT count(*) INTO _n
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'guests'
     AND permissive = 'PERMISSIVE'
     AND (policyname, cmd) IN (('guests_select', 'SELECT'), ('guests_insert', 'INSERT'),
                               ('guests_update', 'UPDATE'), ('guests_delete', 'DELETE'));

  SELECT string_agg(policyname || ' [' || cmd || ', ' || permissive || ']', ', ' ORDER BY policyname)
    INTO _odd
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'guests'
     AND NOT (permissive = 'PERMISSIVE'
              AND (policyname, cmd) IN (('guests_select', 'SELECT'), ('guests_insert', 'INSERT'),
                                        ('guests_update', 'UPDATE'), ('guests_delete', 'DELETE')));

  IF _n <> 4 OR _odd IS NOT NULL THEN
    RAISE EXCEPTION
      '145: the policies on guests are not the four this migration expects (% of 4 found; unexpected: %). Nothing was changed.',
      _n, COALESCE(_odd, 'none');
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- 1. guests_update — 028's role list AND the rule guests_select had in 103
-- -----------------------------------------------------------------------------
-- USING and WITH CHECK are the same expression: it depends only on the row's
-- id and on who is asking, so a row that may be edited is a row that may be
-- written back.
DROP POLICY IF EXISTS guests_update ON guests;
CREATE POLICY guests_update ON guests FOR UPDATE
  USING (
    auth_role() IN ('SUPER_ADMIN', 'PROPERTY_MANAGER', 'RECEPTION', 'YETKILI')
    AND (
      auth_role() = 'SUPER_ADMIN'
      OR (auth_role() IN ('PROPERTY_MANAGER', 'RECEPTION') AND auth_region() IS NULL)
      OR EXISTS (
        SELECT 1 FROM reservations r
        WHERE r.guest_id = guests.id
          AND auth_sees_property(r.property_id)
      )
    )
  )
  WITH CHECK (
    auth_role() IN ('SUPER_ADMIN', 'PROPERTY_MANAGER', 'RECEPTION', 'YETKILI')
    AND (
      auth_role() = 'SUPER_ADMIN'
      OR (auth_role() IN ('PROPERTY_MANAGER', 'RECEPTION') AND auth_region() IS NULL)
      OR EXISTS (
        SELECT 1 FROM reservations r
        WHERE r.guest_id = guests.id
          AND auth_sees_property(r.property_id)
      )
    )
  );

-- -----------------------------------------------------------------------------
-- 2. guests_select — every role that makes reservations sees every guest
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS guests_select ON guests;
CREATE POLICY guests_select ON guests FOR SELECT
  USING (
    auth_role() IN ('SUPER_ADMIN', 'PROPERTY_MANAGER', 'RECEPTION', 'YETKILI')
    OR EXISTS (
      SELECT 1 FROM reservations r
      WHERE r.guest_id = guests.id
        AND auth_sees_property(r.property_id)
    )
  );

-- -----------------------------------------------------------------------------
-- 3. auth_sees_guest — kept identical to guests_select (140 §6)
-- -----------------------------------------------------------------------------
-- ⚠ This is the MIRROR of guests_select above. If that policy changes, this
--   must change with it: the RPCs that call it are SECURITY DEFINER, so RLS
--   cannot answer the question for them.
CREATE OR REPLACE FUNCTION auth_sees_guest(p_guest_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    auth_role() IN ('SUPER_ADMIN', 'PROPERTY_MANAGER', 'RECEPTION', 'YETKILI')
    OR EXISTS (
      SELECT 1 FROM reservations r
      WHERE r.guest_id = p_guest_id
        AND auth_sees_property(r.property_id)
    );
$$;

-- CREATE OR REPLACE keeps the grants 140 left, but say it again: this function
-- answers "does a guest with this id exist for me" and is for the RPCs only.
-- (`FROM public` is the part that matters — authenticated is a member of it.)
REVOKE ALL ON FUNCTION auth_sees_guest(uuid) FROM public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- VERIFICATION — what changed, and what must NOT have
-- -----------------------------------------------------------------------------
-- pg_policies.qual / with_check are the deparsed policy expressions, so a name
-- appears in them only if the policy really uses it.
DO $$
DECLARE
  _sel     text;
  _upd     text;
  _chk     text;
  _src     text;
  n_total  bigint;
  n_orphan bigint;
BEGIN
  -- (a) guests_select: the four reservation-making roles, no region condition,
  --     and the reservation path Temizlik depends on is still there.
  SELECT qual INTO _sel
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'guests' AND policyname = 'guests_select';
  IF _sel IS NULL THEN
    RAISE EXCEPTION '145: guests_select policy is missing after the rewrite.';
  END IF;
  IF _sel NOT LIKE '%SUPER_ADMIN%' OR _sel NOT LIKE '%PROPERTY_MANAGER%'
     OR _sel NOT LIKE '%RECEPTION%' OR _sel NOT LIKE '%YETKILI%' THEN
    RAISE EXCEPTION '145: guests_select does not name all four reservation-making roles.';
  END IF;
  IF _sel LIKE '%auth_region%' THEN
    RAISE EXCEPTION '145: guests_select still carries a region condition — the Bornova roles would still not see Ana Grup guests.';
  END IF;
  IF _sel NOT LIKE '%auth_sees_property%' THEN
    RAISE EXCEPTION '145: guests_select lost the reservation path — Temizlik would lose the guests of the stays it sees.';
  END IF;
  IF _sel LIKE '%HOUSEKEEPING%' OR _sel LIKE '%PENDING%' THEN
    RAISE EXCEPTION '145: guests_select names a role that does not make reservations.';
  END IF;

  -- (b) guests_update: the old visibility rule is inside it now, on both the
  --     row being edited (USING) and the row written back (WITH CHECK).
  SELECT qual, with_check INTO _upd, _chk
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'guests' AND policyname = 'guests_update';
  IF _upd IS NULL OR _chk IS NULL THEN
    RAISE EXCEPTION '145: guests_update is missing its USING or WITH CHECK expression.';
  END IF;
  IF _upd NOT LIKE '%auth_region%' OR _upd NOT LIKE '%auth_sees_property%' OR _upd NOT LIKE '%YETKILI%' THEN
    RAISE EXCEPTION '145: guests_update (USING) does not carry the edit scope — a visible guest would be editable from any region.';
  END IF;
  IF _upd IS DISTINCT FROM _chk THEN
    RAISE EXCEPTION '145: guests_update USING and WITH CHECK differ.';
  END IF;

  -- (c) RLS is actually on; otherwise every policy here is decoration.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.guests'::regclass) THEN
    RAISE EXCEPTION '145: row level security is not enabled on guests.';
  END IF;

  -- (d) The mirror matches the policy, and is still closed to app users.
  SELECT prosrc INTO _src FROM pg_proc WHERE oid = to_regprocedure('public.auth_sees_guest(uuid)');
  IF _src IS NULL OR _src NOT LIKE '%YETKILI%' OR _src LIKE '%auth_region%' THEN
    RAISE EXCEPTION '145: auth_sees_guest() does not match guests_select — the duplicate-TC message would still say "görünmüyor".';
  END IF;
  IF has_function_privilege('authenticated', 'public.auth_sees_guest(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.auth_sees_guest(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '145: auth_sees_guest() is callable by app users — REVOKE ... FROM public did not take.';
  END IF;

  -- (e) How many records this reaches. The second number is the guests no
  --     Personel could find or re-create until now. The first is also the size
  --     of the list the reservation form loads in one request.
  SELECT count(*),
         count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM reservations r WHERE r.guest_id = g.id))
    INTO n_total, n_orphan
    FROM guests g;

  RAISE NOTICE
    '145 OK — the guest list is shared by every role that makes reservations. Editing, the TC / passport card and Ek Misafir are unchanged. Guests: % in total, % without any reservation. In effect now, no frontend deploy needed. Next: run supabase/tests/rls_smoke_test.sql (PASS 35).',
    n_total, n_orphan;
END;
$$;

-- =============================================================================
-- UNDO — only if the owner asks to go back. Restores 103 and 140 word for word.
-- =============================================================================
-- Remove the leading "-- " from the lines below and run them together.
-- guests_update is NOT restored on purpose: the rule written into it above is
-- the same as 103's, so with the old guests_select back it changes nothing.
-- (After an undo the smoke test stops at "migration 145 not applied".)
--
-- DROP POLICY IF EXISTS guests_select ON guests;
-- CREATE POLICY guests_select ON guests FOR SELECT
--   USING (
--     auth_role() = 'SUPER_ADMIN'
--     OR (auth_role() IN ('PROPERTY_MANAGER', 'RECEPTION') AND auth_region() IS NULL)
--     OR EXISTS (
--       SELECT 1 FROM reservations r
--       WHERE r.guest_id = guests.id
--         AND auth_sees_property(r.property_id)
--     )
--   );
--
-- CREATE OR REPLACE FUNCTION auth_sees_guest(p_guest_id uuid)
-- RETURNS boolean
-- LANGUAGE sql
-- STABLE
-- SECURITY DEFINER
-- SET search_path = public
-- AS $$
--   SELECT
--     auth_role() = 'SUPER_ADMIN'
--     OR (auth_role() IN ('PROPERTY_MANAGER', 'RECEPTION') AND auth_region() IS NULL)
--     OR EXISTS (
--       SELECT 1 FROM reservations r
--       WHERE r.guest_id = p_guest_id
--         AND auth_sees_property(r.property_id)
--     );
-- $$;
-- REVOKE ALL ON FUNCTION auth_sees_guest(uuid) FROM public, anon, authenticated;
