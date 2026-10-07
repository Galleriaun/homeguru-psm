-- =============================================================================
-- HomeGuru PMS — migration 144
-- The Personel roles can READ a reservation's cari hesap.
-- =============================================================================
-- Owner decision (2026-10-06): on the reservation screen, Personel, Personel
-- Bornova and Teknik Personel see the Cari Hesap section — totals, balance and
-- movements — but none of its controls (CSV İndir, + Ekstra Ücret, Hesabı
-- Kilitle, the per-row delete). Until now the section was hidden from them and
-- RLS returned them zero cari rows.
--
-- -----------------------------------------------------------------------------
-- THE ONLY CHANGE: ledger_select
-- -----------------------------------------------------------------------------
-- The body is copied from 033, which is its latest definition — no migration
-- between 033 and this one redefines it. One edit:
--
--     auth_role() = 'PROPERTY_MANAGER'
--   becomes
--     auth_role() IN ('PROPERTY_MANAGER', 'YETKILI')
--
-- auth_role() (139) maps PERSONEL_BORNOVA and TEKNIK_PERSONEL to 'YETKILI', so
-- that one name covers all three Personel roles and they cannot drift apart.
--
-- -----------------------------------------------------------------------------
-- WHAT STILL LIMITS THEM — unchanged, inherited through the same EXISTS
-- -----------------------------------------------------------------------------
--   * auth_sees_property() (117) — region and access_scope. A Personel reads
--     the cari only of reservations in properties it already sees: an Ana Grup
--     Personel never reads Bornova, a Personel Bornova never reads Ana Grup, a
--     HOTELS-scoped Personel never reads a daire. Teknik Personel reads every
--     region, exactly as it already sees every reservation.
--   * Guest-level rows (reservation_id IS NULL) stay Yönetici-only: the EXISTS
--     needs a reservation to hang on.
--
-- -----------------------------------------------------------------------------
-- DELIBERATELY NOT TOUCHED — reading is not writing
-- -----------------------------------------------------------------------------
--   * ledger_insert (033): SUPER_ADMIN / PROPERTY_MANAGER only.
--   * ledger_delete (017): SUPER_ADMIN only.
--   * ledger_entries has no UPDATE policy at all — nobody edits a row.
--   * soft_delete_entity (132) is SECURITY INVOKER, so it still refuses these
--     roles. One path does change: they can now SEE the row, so the refusal
--     comes from the ROW_COUNT = 0 check after the DELETE instead of the earlier
--     "kayıt bulunamadı" check. Both raise and both roll the trash row back;
--     smoke test PASS 34 pins exactly this.
--   * _auto_debit_on_activate and set_cari_blocked are SECURITY DEFINER and read
--     the table as the owner — they do not notice this change.
--
-- Not new at the data level: these roles already read payment_collections for
-- the same properties (139). What this adds is the ÜCRET (DEBT) rows and the
-- PAYMENT rows as the cari records them.
--
-- ⚠ ORDER: run this BEFORE the frontend that shows the section goes live. Without
-- it RLS hands a Personel zero rows and the screen would read ₺0,00 / "Hesap
-- kapalı" on every reservation — wrong money information, not an error.
-- Running it first changes nothing visible on its own.
--
-- Safe to re-run.
-- =============================================================================

DROP POLICY IF EXISTS ledger_select ON ledger_entries;
CREATE POLICY ledger_select ON ledger_entries FOR SELECT
  USING (
    auth_role() = 'SUPER_ADMIN'
    OR (
      auth_role() IN ('PROPERTY_MANAGER', 'YETKILI')
      AND EXISTS (
        SELECT 1 FROM reservations r
        WHERE r.id = ledger_entries.reservation_id
          AND auth_sees_property(r.property_id)
      )
    )
  );

-- -----------------------------------------------------------------------------
-- VERIFICATION — both what changed and what must NOT have
-- -----------------------------------------------------------------------------
-- pg_policies.qual / with_check are the deparsed policy expressions, so a role
-- name appears in them only if the policy really names it.
DO $$
DECLARE
  _qual text;
  _src  text;
BEGIN
  SELECT qual INTO _qual
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'ledger_entries'
     AND policyname = 'ledger_select';

  IF _qual IS NULL THEN
    RAISE EXCEPTION '144: ledger_select policy is missing after the rewrite.';
  END IF;

  -- (a) The change itself.
  IF _qual NOT LIKE '%YETKILI%' THEN
    RAISE EXCEPTION '144: ledger_select does not name YETKILI — the Personel roles still cannot read the cari.';
  END IF;

  -- (b) Nobody who could read before lost it, and the region / scope gate that
  --     keeps a Personel inside its own properties is still in the policy.
  IF _qual NOT LIKE '%SUPER_ADMIN%' OR _qual NOT LIKE '%PROPERTY_MANAGER%' THEN
    RAISE EXCEPTION '144: ledger_select lost Yönetici or Alt Yönetici.';
  END IF;
  IF _qual NOT LIKE '%auth_sees_property%' THEN
    RAISE EXCEPTION '144: ledger_select lost auth_sees_property() — region / scope isolation would be gone.';
  END IF;

  -- (c) RLS is actually on; otherwise every policy here is decoration.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ledger_entries'::regclass) THEN
    RAISE EXCEPTION '144: row level security is not enabled on ledger_entries.';
  END IF;

  -- (d) Reading is not writing: no INSERT / UPDATE / DELETE / ALL policy on the
  --     table may name the Personel role.
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'ledger_entries'
       AND cmd <> 'SELECT'
       AND (COALESCE(qual, '') LIKE '%YETKILI%' OR COALESCE(with_check, '') LIKE '%YETKILI%')
  ) THEN
    RAISE EXCEPTION '144: a write policy on ledger_entries names YETKILI — the Personel roles must stay read-only.';
  END IF;

  -- (e) The mapping this relies on (139). Without it Teknik Personel still acts
  --     as HOUSEKEEPING and would silently NOT get the read the owner asked for.
  SELECT prosrc INTO _src FROM pg_proc WHERE proname = 'auth_role';
  IF _src IS NULL OR _src NOT LIKE '%WHEN role = ''TEKNIK_PERSONEL'' THEN ''YETKILI''%' THEN
    RAISE EXCEPTION '144: auth_role() does not map TEKNIK_PERSONEL to YETKILI — apply migration 139 first.';
  END IF;
  IF _src NOT LIKE '%WHEN role = ''PERSONEL_BORNOVA'' THEN ''YETKILI''%' THEN
    RAISE EXCEPTION '144: auth_role() does not map PERSONEL_BORNOVA to YETKILI.';
  END IF;

  RAISE NOTICE
    '144 OK — Personel, Personel Bornova and Teknik Personel can read the cari hesap of reservations they already see. Insert / delete policies untouched. Now run supabase/tests/rls_smoke_test.sql (PASS 34), and only then deploy the frontend.';
END;
$$;
