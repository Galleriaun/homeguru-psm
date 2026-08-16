-- =============================================================================
-- HomeGuru PMS — migration 134
-- "Kasaya işle" obeys the same onay gate as the cron.
-- =============================================================================
-- Migration 125 closed a money bug in generate_recurring_expenses: before it,
-- the generator selected templates by is_recurring / recurring_source_id /
-- recurring_day and NEVER looked at approval_status, so a REJECTED düzenli gider
-- kept charging the kasa every month and the yönetici's rejection did nothing.
-- 125 added `AND approval_status = 'approved'`.
--
-- It did not make the same change to post_recurring_instance_now ("Kasaya
-- işle"), which has no approval check at all. So the identical money bug is
-- still reachable through the manual button: a PENDING or REJECTED template can
-- be posted straight to the kasa by hand, born 'approved', with a kasa OUT.
-- The cron refuses that template every month; the button does it in one click.
--
-- This migration adds the missing guard. Body is copied verbatim from 124 (the
-- latest definition) — the ONLY change is the new check, placed after the
-- template is loaded and after the region check, so an unauthorised caller still
-- gets the permission error first rather than leaking the template's state.
--
-- Deliberately NOT done here: back-filling old templates to 'approved'.
-- Approving a template writes a kasa OUT (approve_expense), so a blanket
-- backfill would invent money movements for months that were never charged.
-- Templates stuck at 'pending' are already listed on the Onaylar screen
-- (listPendingExpenses filters only on approval_status, not is_recurring) and
-- must be approved there, through the audited path.
--
-- Client-side counterpart (same change set): the Giderler screen now selects
-- approval_status and renders a non-approved template as "Onay bekliyor"
-- instead of "Beklenen". Previously the UI projected a stuck template as an
-- expected gider that the cron would never post — which is how a düzenli gider
-- silently stopped generating without anyone noticing.
-- =============================================================================

CREATE OR REPLACE FUNCTION post_recurring_instance_now(_template_id uuid)
RETURNS expenses
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _t            expenses;
  _today        date := (now() AT TIME ZONE 'Europe/Istanbul')::date;
  _last_day     int  := EXTRACT(DAY FROM (date_trunc('month', _today) + interval '1 month' - interval '1 day'))::int;
  _month_start  date := date_trunc('month', _today)::date;
  _day          int;
  _expense_date date;
  _kasa_id      uuid;
  _instance     expenses;
  _existing     expenses;
  _prop         text;
BEGIN
  IF auth_role() NOT IN ('SUPER_ADMIN', 'PROPERTY_MANAGER') THEN
    RAISE EXCEPTION 'Yetkiniz yok.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _t FROM expenses
   WHERE id = _template_id
     AND is_recurring = true
     AND recurring_source_id IS NULL;
  IF _t.id IS NULL THEN
    RAISE EXCEPTION 'Düzenli gider bulunamadı.' USING ERRCODE = '42501';
  END IF;

  IF auth_role() = 'PROPERTY_MANAGER'
     AND NOT (auth_sees_all_regions() OR _t.region IS NOT DISTINCT FROM auth_region()) THEN
    RAISE EXCEPTION 'Bu mülke erişim yetkiniz yok.' USING ERRCODE = '42501';
  END IF;

  -- ↓↓↓ THE ONLY ADDITION vs 124 ↓↓↓
  -- Same gate the cron applies (125). Without it the manual button is a way to
  -- push a rejected or not-yet-reviewed düzenli gider into the kasa.
  IF _t.approval_status <> 'approved' THEN
    RAISE EXCEPTION
      'Bu düzenli gider henüz onaylanmamış (%). Onaylar ekranından onaylayın; sonrası otomatik işlenir.',
      _t.approval_status
      USING ERRCODE = '42501';
  END IF;
  -- ↑↑↑ END ADDITION ↑↑↑

  -- Not started yet — its first gider is the template's own (later) month.
  IF date_trunc('month', _t.expense_date)::date > _month_start THEN
    RAISE EXCEPTION 'Bu düzenli gider % tarihinde başlıyor.', to_char(_t.expense_date, 'DD.MM.YYYY');
  END IF;

  IF date_trunc('month', _t.expense_date)::date = _month_start THEN
    RAISE EXCEPTION 'Bu ayın gideri zaten kayıtlı.';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(_template_id::text || to_char(_month_start, 'YYYYMM'), 0)
  );

  SELECT * INTO _existing FROM expenses
   WHERE recurring_source_id = _template_id
     AND date_trunc('month', expense_date)::date = _month_start
   LIMIT 1;
  IF _existing.id IS NOT NULL THEN
    RETURN _existing;
  END IF;

  _day := LEAST(COALESCE(_t.recurring_day, 1), _last_day);
  _expense_date := make_date(
    EXTRACT(YEAR FROM _today)::int, EXTRACT(MONTH FROM _today)::int, _day
  );

  INSERT INTO expenses (
    property_id, unit_id, category, amount, description, expense_date,
    is_recurring, paid_from_kasa, recurring_source_id, approval_status, created_by
  ) VALUES (
    _t.property_id, _t.unit_id, _t.category, _t.amount, _t.description, _expense_date,
    false, _t.paid_from_kasa, _t.id, 'approved', auth.uid()
  )
  RETURNING * INTO _instance;

  IF _instance.paid_from_kasa THEN
    SELECT id INTO _kasa_id FROM cash_accounts WHERE property_id IS NULL LIMIT 1;
    IF _kasa_id IS NULL THEN
      RAISE EXCEPTION 'Genel kasa bulunamadı.';
    END IF;
    SELECT name INTO _prop FROM properties WHERE id = _t.property_id;
    INSERT INTO cash_transactions (
      cash_account_id, amount, direction, description,
      ref_type, ref_id, approval_status, created_by
    ) VALUES (
      _kasa_id, _instance.amount, 'OUT',
      'Düzenli gider: '
        || COALESCE(COALESCE(_prop, _t.deleted_property_name) || ' · ', '')
        || _instance.category || COALESCE(' — ' || _instance.description, ''),
      'expense', _instance.id, 'approved', auth.uid()
    );
  END IF;

  RETURN _instance;
END;
$$;

GRANT EXECUTE ON FUNCTION post_recurring_instance_now(uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- Diagnostic: which düzenli giderler are currently blocked from generating.
-- Mirrors generate_recurring_expenses' conditions exactly, so the reason column
-- is the real reason and not an approximation. Read-only.
-- -----------------------------------------------------------------------------
-- security_invoker = true is REQUIRED, not cosmetic: a Postgres view otherwise
-- executes with the OWNER's rights, which would bypass the `expenses` RLS
-- policies entirely and let any authenticated user read every gider through the
-- view. With it, the caller's own RLS applies exactly as on the base table.
CREATE OR REPLACE VIEW v_duzenli_gider_durum
WITH (security_invoker = true) AS
SELECT
  e.id,
  e.category,
  e.description,
  e.amount,
  e.expense_date  AS sablon_tarihi,
  e.recurring_day AS tekrar_gunu,
  e.approval_status,
  CASE
    WHEN e.recurring_day IS NULL THEN 'TEKRAR GUNU YOK'
    WHEN e.approval_status <> 'approved'
      THEN 'ONAYLANMAMIS (' || e.approval_status || ') — cron atliyor'
    WHEN date_trunc('month', e.expense_date)::date
         >= date_trunc('month', (now() AT TIME ZONE 'Europe/Istanbul')::date)::date
      THEN 'KENDI AYI — ilk uretim gelecek ay'
    WHEN EXTRACT(DAY FROM (now() AT TIME ZONE 'Europe/Istanbul')::date)::int
         < LEAST(e.recurring_day,
                 EXTRACT(DAY FROM (date_trunc('month', (now() AT TIME ZONE 'Europe/Istanbul')::date)
                   + interval '1 month' - interval '1 day'))::int)
      THEN 'GUNU GELMEDI'
    WHEN EXISTS (
      SELECT 1 FROM expenses i
       WHERE i.recurring_source_id = e.id
         AND date_trunc('month', i.expense_date)::date
             = date_trunc('month', (now() AT TIME ZONE 'Europe/Istanbul')::date)::date
    ) THEN 'BU AY URETILDI'
    ELSE 'URETILMELIYDI — cron calismamis olabilir'
  END AS durum
FROM expenses e
WHERE e.is_recurring = true
  AND e.recurring_source_id IS NULL;

-- Finance roles only; the view exposes the same rows `expenses` RLS already
-- governs, but keep the grant explicit rather than relying on PUBLIC.
REVOKE ALL ON v_duzenli_gider_durum FROM PUBLIC;
GRANT SELECT ON v_duzenli_gider_durum TO authenticated;
