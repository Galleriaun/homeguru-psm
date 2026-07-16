-- =============================================================================
-- HomeGuru PMS — migration 124
-- A düzenli gider always lands on its tekrar günü — and never before its start
-- month.
-- =============================================================================
-- Two related defects in the recurring-gider model:
--
-- (1) The "tekrar günü" (recurring_day) only ever drove the CRON-generated
--     months. The TEMPLATE row itself kept whatever gider tarihi was picked at
--     setup, and the generator deliberately skips the template's own month ("it
--     already represents that month" — 087/106). So a template created 10 Tem
--     with tekrar günü 15 made July's gider land on the 10th and never on the
--     15th: the chosen day did nothing for the very month it was set up in.
--     (Reported: Daireler · No.3 Kira, added 10 Tem 2026 w/ day 15, no 15 Tem.)
--
-- (2) The generator only skipped the template's own month with `=`, so a template
--     whose gider tarihi is in a FUTURE month still matched "due day passed" and
--     back-posted an instance into the CURRENT month. A düzenli meant to start in
--     August immediately charged July. Same hole in post_recurring_instance_now
--     ("Kasaya işle"), which refused only the equal-month case.
--
-- Fixes:
--   * Trigger pins a TEMPLATE's expense_date DAY to recurring_day (clamped to the
--     month length: 31 → 30/28). Month/year stay the user's choice, so the gider
--     tarihi selects the START month while the day is always the tekrar günü.
--     Generated instances (recurring_source_id NOT NULL) and one-off giderler
--     (recurring_day NULL) are excluded; a stopped düzenli (085 clears
--     is_recurring) is excluded too.
--   * Generator skips `>= _month_start` — the template's own month AND any
--     not-yet-started template.
--   * "Kasaya işle" refuses a template that starts later, with its own message.
--   * Backfill re-dates existing templates onto their tekrar günü.
--
-- Enforced by trigger rather than in the form, per the project rule that money
-- invariants live in Postgres — it holds for every write path.
--
-- NOTE: generate_recurring_expenses is rebuilt from its latest version (106);
-- post_recurring_instance_now from ITS latest version (107 — the region check),
-- NOT 106, which still had the legacy auth_property_id() scope.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. A template's date always carries its tekrar günü.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION expense_align_recurring_day()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _last_day int;
BEGIN
  IF NEW.is_recurring
     AND NEW.recurring_source_id IS NULL
     AND NEW.recurring_day IS NOT NULL
     AND NEW.expense_date IS NOT NULL
  THEN
    _last_day := EXTRACT(DAY FROM (
      date_trunc('month', NEW.expense_date) + interval '1 month' - interval '1 day'
    ))::int;

    NEW.expense_date := make_date(
      EXTRACT(YEAR  FROM NEW.expense_date)::int,
      EXTRACT(MONTH FROM NEW.expense_date)::int,
      LEAST(NEW.recurring_day, _last_day)
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Fires before expenses_set_region (095) — BEFORE triggers run in alphabetical
-- order and the two touch different columns (expense_date vs region).
DROP TRIGGER IF EXISTS expenses_align_recurring_day ON expenses;
CREATE TRIGGER expenses_align_recurring_day
  BEFORE INSERT OR UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION expense_align_recurring_day();

-- -----------------------------------------------------------------------------
-- 2. Generator: skip the template's own month AND not-yet-started templates.
--    Identical to 106 except the `=` → `>=` on the month guard.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION generate_recurring_expenses()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _t            expenses;
  _today        date := (now() AT TIME ZONE 'Europe/Istanbul')::date;
  _today_day    int  := EXTRACT(DAY FROM _today)::int;
  _last_day     int  := EXTRACT(DAY FROM (date_trunc('month', _today) + interval '1 month' - interval '1 day'))::int;
  _month_start  date := date_trunc('month', _today)::date;
  _due_day      int;
  _expense_date date;
  _kasa_id      uuid;
  _instance_id  uuid;
  _prop         text;
BEGIN
  SELECT id INTO _kasa_id FROM cash_accounts WHERE property_id IS NULL LIMIT 1;

  FOR _t IN
    SELECT * FROM expenses
    WHERE is_recurring = true
      AND recurring_source_id IS NULL
      AND recurring_day IS NOT NULL
  LOOP
    _due_day := LEAST(_t.recurring_day, _last_day);

    IF _today_day < _due_day THEN
      CONTINUE;
    END IF;

    -- The template's own month already represents that month, and a template
    -- dated in a LATER month has not started yet — never back-post into the
    -- current month.
    IF date_trunc('month', _t.expense_date)::date >= _month_start THEN
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM expenses e
      WHERE e.recurring_source_id = _t.id
        AND date_trunc('month', e.expense_date)::date = _month_start
    ) THEN
      CONTINUE;
    END IF;

    _expense_date := make_date(
      EXTRACT(YEAR FROM _today)::int, EXTRACT(MONTH FROM _today)::int, _due_day
    );

    INSERT INTO expenses (
      property_id, unit_id, category, amount, description, expense_date,
      is_recurring, paid_from_kasa, recurring_source_id, approval_status, created_by
    ) VALUES (
      _t.property_id, _t.unit_id, _t.category, _t.amount, _t.description, _expense_date,
      false, _t.paid_from_kasa, _t.id, 'approved', NULL
    )
    RETURNING id INTO _instance_id;

    IF _t.paid_from_kasa AND _kasa_id IS NOT NULL THEN
      SELECT name INTO _prop FROM properties WHERE id = _t.property_id;
      INSERT INTO cash_transactions (
        cash_account_id, amount, direction, description,
        ref_type, ref_id, approval_status, created_by
      ) VALUES (
        _kasa_id, _t.amount, 'OUT',
        'Düzenli gider: '
          || COALESCE(COALESCE(_prop, _t.deleted_property_name) || ' · ', '')
          || _t.category || COALESCE(' — ' || _t.description, ''),
        'expense', _instance_id, 'approved', NULL
      );
    END IF;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION generate_recurring_expenses() FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. "Kasaya işle": refuse a template that starts in a later month.
--    Identical to 107 (region check preserved) plus the start-month guard.
-- -----------------------------------------------------------------------------
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
-- 4. Backfill existing templates onto their tekrar günü. The re-date stays INSIDE
--    the same month, so no month gains or loses a gider and the kasa total is
--    unchanged — only the day moves (Daireler · No.3 Kira: 10 Tem → 15 Tem 2026).
--    Safe against the other expenses triggers: expenses_notify_pending is AFTER
--    INSERT only, paid_from_kasa_immutable is UPDATE OF paid_from_kasa, and
--    expenses_sync_kasa's WHEN only fires on amount/category/description/
--    property_id changes — none match a date-only update.
-- -----------------------------------------------------------------------------
UPDATE expenses
   SET expense_date = make_date(
         EXTRACT(YEAR  FROM expense_date)::int,
         EXTRACT(MONTH FROM expense_date)::int,
         LEAST(recurring_day, EXTRACT(DAY FROM (
           date_trunc('month', expense_date) + interval '1 month' - interval '1 day'
         ))::int)
       )
 WHERE is_recurring = true
   AND recurring_source_id IS NULL
   AND recurring_day IS NOT NULL
   AND EXTRACT(DAY FROM expense_date)::int IS DISTINCT FROM LEAST(
         recurring_day,
         EXTRACT(DAY FROM (
           date_trunc('month', expense_date) + interval '1 month' - interval '1 day'
         ))::int
       );
