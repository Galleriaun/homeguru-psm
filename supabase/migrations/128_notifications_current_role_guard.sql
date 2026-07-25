-- =============================================================================
-- HomeGuru PMS — migration 128
-- Bildirimler show only what the caller's CURRENT role should receive.
-- =============================================================================
-- notifications_select (050) was `user_id = auth.uid()` — rows belong to whoever
-- they were sent to, forever. After a role change, a demoted ex-manager kept
-- seeing old "Onay bekleyen gider" / "payment" notifications they can no longer
-- act on. This adds a role re-check to the SELECT policy (mirrors PilotGarage's
-- 031): a row is visible only if the caller's role is a recipient of that
-- event_type today.
--
-- Correctness is anchored to the SEND path, not a copy of it: the check reuses
-- the very helpers the notify triggers target with — _region_reservation_roles
-- (115/119) and _region_manager_roles (115) — unioned across both region
-- branches. So the guard cannot drift from who actually gets the push. Matching
-- is on the RAW staff_profiles.role (auth_role() normalizes YONETICI_BORNOVA →
-- PROPERTY_MANAGER etc., but the send path targets raw region roles, and
-- new_issue targets raw TEKNIK_PERSONEL — normalizing would misclassify them).
--
-- Fail-open on an unknown/NULL event_type: a future event type must never
-- silently vanish, and the caller only has the row because the send path
-- targeted them. So the guard only ever HIDES a row whose event_type is known to
-- be role-restricted and the current role is not a recipient — precisely the
-- role-change case.
--
-- SELECT only. The UPDATE (read_at) policy is left as-is: marking a now-hidden
-- row read is invisible and harmless, and "mark all read" staying broad keeps the
-- unread count clean.
-- =============================================================================

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

  -- NULL passed to the region helpers = the Ana Grup (non-bornova) branch; the
  -- union of both branches is every role that can receive that event in any
  -- region. Duplicate roles across branches are harmless for = ANY().
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
      WHEN 'new_issue' THEN
        _role = ANY(
          _region_manager_roles('bornova') || _region_manager_roles(NULL)
          || ARRAY['TEKNIK_PERSONEL']::text[]
        )
      WHEN 'pending_approval'           THEN _role = 'SUPER_ADMIN'
      WHEN 'salary_auto_paid'           THEN _role = 'SUPER_ADMIN'
      WHEN 'pending_google_reservation' THEN _role = 'SUPER_ADMIN'
      -- Unknown / NULL event_type → never hide a legitimately received row.
      ELSE true
    END,
    false  -- known event_type but NULL/unknown role → hide
  );
END;
$$;

GRANT EXECUTE ON FUNCTION auth_receives_event(text) TO authenticated;

DROP POLICY IF EXISTS notifications_select ON notifications;
CREATE POLICY notifications_select ON notifications FOR SELECT
  USING (
    user_id = auth.uid()
    AND auth_receives_event(event_type)
  );
