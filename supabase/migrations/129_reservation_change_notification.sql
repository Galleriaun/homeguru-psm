-- =============================================================================
-- HomeGuru PMS — migration 129
-- Notify Yönetici + Alt Yönetici when a reservation's dates or amount change.
-- =============================================================================
-- When someone edits a reservation's gün (stay_start/stay_end) or rakam
-- (total_amount/deposit), the managers who oversee that reservation's region get
-- a notification saying WHAT changed (old → new), WHERE (guest · birim), and WHO
-- changed it. Recipients = _region_manager_roles(region) — SUPER_ADMIN +
-- PROPERTY_MANAGER (+ YONETICI_BORNOVA for a Bornova reservation) — i.e. exactly
-- Yönetici + Alt Yönetici, the same tier already used for payment_unconfirmed /
-- reservation_auto_completed.
--
-- Only HUMAN edits notify: the trigger returns early when auth.uid() is NULL, so
-- cron/auto-debit/Google-sync changes (which run as service_role and have no
-- actor) neither spam managers nor produce a "who"-less notification. Unit-only
-- moves and status changes (cancel/complete) don't touch the watched columns, so
-- they don't fire — the WHEN clause scopes strictly to gün + rakam.
-- =============================================================================

-- 1. Allow the new event_type in the preferences CHECK (latest list was 059).
ALTER TABLE notification_preferences DROP CONSTRAINT IF EXISTS notification_preferences_event_type_check;
ALTER TABLE notification_preferences
  ADD CONSTRAINT notification_preferences_event_type_check
  CHECK (event_type IN (
    'new_issue',
    'payment_unconfirmed',
    'new_reservation',
    'reservation_auto_completed',
    'salary_auto_paid',
    'upcoming_reservation_2d',
    'pending_approval',
    'pending_google_reservation',
    'reservation_changed'
  ));

-- 2. Extend the current-role visibility guard (128) so reservation_changed is
--    role-checked (manager tier) instead of falling through to fail-open. Same
--    body as 128 plus the one new case, reusing the send-path helpers.
CREATE OR REPLACE FUNCTION auth_receives_event(_event_type text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _role text;
BEGIN
  SELECT role INTO _role
    FROM staff_profiles
   WHERE user_id = auth.uid() AND deleted_at IS NULL;

  RETURN COALESCE(
    CASE _event_type
      WHEN 'new_reservation' THEN
        _role = ANY(_region_reservation_roles('bornova') || _region_reservation_roles(NULL))
      WHEN 'upcoming_reservation_2d' THEN
        _role = ANY(_region_reservation_roles('bornova') || _region_reservation_roles(NULL))
      WHEN 'payment_unconfirmed' THEN
        _role = ANY(_region_manager_roles('bornova') || _region_manager_roles(NULL))
      WHEN 'reservation_auto_completed' THEN
        _role = ANY(_region_manager_roles('bornova') || _region_manager_roles(NULL))
      WHEN 'reservation_changed' THEN
        _role = ANY(_region_manager_roles('bornova') || _region_manager_roles(NULL))
      WHEN 'new_issue' THEN
        _role = ANY(
          _region_manager_roles('bornova') || _region_manager_roles(NULL)
          || ARRAY['TEKNIK_PERSONEL']::text[]
        )
      WHEN 'pending_approval'           THEN _role = 'SUPER_ADMIN'
      WHEN 'salary_auto_paid'           THEN _role = 'SUPER_ADMIN'
      WHEN 'pending_google_reservation' THEN _role = 'SUPER_ADMIN'
      ELSE true
    END,
    false
  );
END;
$$;

-- 3. The change notification. AFTER UPDATE, scoped by WHEN to the watched
--    columns; the body reports only the fields that actually changed.
CREATE OR REPLACE FUNCTION _notify_reservation_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _who     text;
  _guest   text;
  _unit    text;
  _region  text;
  _changes text := '';
BEGIN
  -- Human edits only — no actor, no notification (skips cron / sync / auto-debit).
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT full_name INTO _who   FROM staff_profiles WHERE user_id = auth.uid();
  SELECT full_name INTO _guest FROM guests         WHERE id = NEW.guest_id;
  SELECT name      INTO _unit  FROM units          WHERE id = NEW.unit_id;
  SELECT region    INTO _region FROM properties    WHERE id = NEW.property_id;

  IF OLD.stay_start IS DISTINCT FROM NEW.stay_start
     OR OLD.stay_end IS DISTINCT FROM NEW.stay_end THEN
    _changes := _changes || E'\nTarih: '
      || to_char(OLD.stay_start AT TIME ZONE 'Europe/Istanbul', 'DD.MM.YYYY')
      || '–' || to_char(OLD.stay_end AT TIME ZONE 'Europe/Istanbul', 'DD.MM.YYYY')
      || ' → '
      || to_char(NEW.stay_start AT TIME ZONE 'Europe/Istanbul', 'DD.MM.YYYY')
      || '–' || to_char(NEW.stay_end AT TIME ZONE 'Europe/Istanbul', 'DD.MM.YYYY');
  END IF;

  IF OLD.total_amount IS DISTINCT FROM NEW.total_amount THEN
    _changes := _changes || E'\nTutar: '
      || OLD.total_amount::text || ' ₺ → ' || NEW.total_amount::text || ' ₺';
  END IF;

  IF OLD.deposit IS DISTINCT FROM NEW.deposit THEN
    _changes := _changes || E'\nKapora: '
      || OLD.deposit::text || ' ₺ → ' || NEW.deposit::text || ' ₺';
  END IF;

  PERFORM _send_push_async(
    _region_manager_roles(_region),
    'Rezervasyon değişikliği',
    COALESCE(_guest, 'Misafir') || COALESCE(' · ' || _unit, '')
      || E'\nDeğiştiren: ' || COALESCE(_who, 'Bir kullanıcı')
      || _changes,
    '/reservations/' || NEW.id::text,
    'reservation',
    'reservation_changed',
    jsonb_build_object('id', NEW.id)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reservations_notify_changed ON reservations;
CREATE TRIGGER reservations_notify_changed
  AFTER UPDATE ON reservations
  FOR EACH ROW
  WHEN (
    OLD.stay_start   IS DISTINCT FROM NEW.stay_start
    OR OLD.stay_end  IS DISTINCT FROM NEW.stay_end
    OR OLD.total_amount IS DISTINCT FROM NEW.total_amount
    OR OLD.deposit   IS DISTINCT FROM NEW.deposit
  )
  EXECUTE FUNCTION _notify_reservation_changed();
