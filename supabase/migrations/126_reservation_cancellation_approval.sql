-- =============================================================================
-- HomeGuru PMS — migration 126
-- Cancelling a reservation needs Yönetici approval, like deleting one.
-- =============================================================================
-- Until now anyone who could update a reservation (PROPERTY_MANAGER / RECEPTION
-- / YETKILI) could set status='cancelled' straight from the detail page. The
-- operator wants a cancellation to become a REQUEST that a Yönetici resolves in
-- Onaylar — the same shape as the deletion flow (090/097).
--
-- Design (deliberately mirrors reservation_deletion_requests):
--   * reservation_cancellation_requests — one pending row per reservation.
--   * A BEFORE UPDATE TRIGGER is the real boundary, not RLS. reservations_update
--     (033) grants a broad UPDATE to four roles and RLS WITH CHECK only sees the
--     NEW row, so it cannot tell "was just cancelled" from "was already
--     cancelled" — a trigger comparing OLD/NEW can, and it guards every write
--     path (client UPDATE, RPC, future code) rather than just this one screen.
--   * request_reservation_cancellation() — non-reviewer files a pending request.
--   * approve_reservation_cancellation() — reviewer: set status='cancelled'.
--   * deny_reservation_cancellation()    — reviewer: keep the reservation.
--
-- Who may cancel directly = auth_can_review_region() (096): a Yönetici anywhere,
-- an Alt Yönetici within their own region. They are the ones who would approve
-- the request anyway, so routing them through it would just add a click. Anyone
-- else gets the trigger's refusal and must file a request.
--
-- Safe against existing automation: no cron or server function writes
-- 'cancelled' (auto-complete writes 'completed'), so nothing else trips the
-- trigger. Un-cancelling is untouched — the guard only fires on the transition
-- INTO 'cancelled'.
-- =============================================================================

-- 1. Requests table (same columns/policy as reservation_deletion_requests).
CREATE TABLE IF NOT EXISTS reservation_cancellation_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id  uuid NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  property_id     uuid REFERENCES properties(id) ON DELETE SET NULL, -- snapshot for RLS scope
  requested_by    uuid REFERENCES auth.users(id),
  reason          text,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'denied')),
  resolved_by     uuid REFERENCES auth.users(id),
  resolved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS reservation_cancellation_pending_uniq
  ON reservation_cancellation_requests (reservation_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS reservation_cancellation_status_idx
  ON reservation_cancellation_requests (status) WHERE status = 'pending';

ALTER TABLE reservation_cancellation_requests ENABLE ROW LEVEL SECURITY;

-- SELECT only: admins see all (drives the Onaylar tab), the requester sees their
-- own, branch staff see their branch's (so the detail page can show "iptal
-- edilmesi için onay bekleniyor"). Writes go exclusively through the RPCs.
DROP POLICY IF EXISTS rcr_select ON reservation_cancellation_requests;
CREATE POLICY rcr_select ON reservation_cancellation_requests FOR SELECT
  USING (
    auth_role() = 'SUPER_ADMIN'
    OR requested_by = auth.uid()
    OR (property_id IS NOT NULL AND auth_sees_property(property_id))
  );

-- 2. The boundary: only a reviewer may move a reservation INTO 'cancelled'.
CREATE OR REPLACE FUNCTION _reservation_guard_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    IF NOT auth_can_review_region(region_of_property(NEW.property_id)) THEN
      RAISE EXCEPTION
        'Rezervasyonu iptal etmek için yönetici onayı gerekir. Lütfen iptal talebi oluşturun.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reservations_guard_cancel ON reservations;
CREATE TRIGGER reservations_guard_cancel
  BEFORE UPDATE ON reservations
  FOR EACH ROW EXECUTE FUNCTION _reservation_guard_cancel();

-- 3. request_reservation_cancellation — a non-reviewer files a pending request.
CREATE OR REPLACE FUNCTION request_reservation_cancellation(
  _reservation_id uuid,
  _reason         text DEFAULT NULL
) RETURNS reservation_cancellation_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _r   reservations;
  _req reservation_cancellation_requests;
BEGIN
  IF auth_role() NOT IN ('SUPER_ADMIN', 'PROPERTY_MANAGER', 'RECEPTION', 'YETKILI') THEN
    RAISE EXCEPTION 'İptal talebi için yetkiniz yok.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _r FROM reservations WHERE id = _reservation_id;
  IF _r.id IS NULL OR NOT auth_sees_property(_r.property_id) THEN
    RAISE EXCEPTION 'Rezervasyon bulunamadı veya erişiminiz yok.' USING ERRCODE = '42501';
  END IF;

  IF _r.status = 'cancelled' THEN
    RAISE EXCEPTION 'Bu rezervasyon zaten iptal edilmiş.';
  END IF;

  -- Idempotent: reuse the existing pending request (unique index guards too).
  SELECT * INTO _req FROM reservation_cancellation_requests
   WHERE reservation_id = _reservation_id AND status = 'pending'
   LIMIT 1;
  IF _req.id IS NOT NULL THEN
    RETURN _req;
  END IF;

  INSERT INTO reservation_cancellation_requests
    (reservation_id, property_id, requested_by, reason)
  VALUES
    (_reservation_id, _r.property_id, auth.uid(), NULLIF(btrim(COALESCE(_reason, '')), ''))
  RETURNING * INTO _req;

  PERFORM _send_push_async(
    ARRAY['SUPER_ADMIN']::text[],
    'Rezervasyon iptal talebi',
    'Onay bekleyen bir rezervasyon iptal talebi var.',
    '/finance/pending',
    'system',
    'pending_approval',
    jsonb_build_object('kind', 'reservation_cancellation', 'id', _req.id)
  );

  RETURN _req;
END;
$$;
GRANT EXECUTE ON FUNCTION request_reservation_cancellation(uuid, text) TO authenticated;

-- 4. approve_reservation_cancellation — reviewer approves → cancel the stay.
CREATE OR REPLACE FUNCTION approve_reservation_cancellation(_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _req reservation_cancellation_requests;
BEGIN
  SELECT * INTO _req FROM reservation_cancellation_requests
   WHERE id = _request_id AND status = 'pending';
  IF _req.id IS NULL THEN
    RAISE EXCEPTION 'Talep bulunamadı veya zaten sonuçlandırılmış.';
  END IF;

  IF NOT auth_can_review_region(region_of_property(_req.property_id)) THEN
    RAISE EXCEPTION 'Yönetici yetkisi gerekir.' USING ERRCODE = '42501';
  END IF;

  -- Passes the cancel guard above: the caller is a reviewer by the check just
  -- made, and auth.uid() is preserved inside SECURITY DEFINER.
  UPDATE reservations SET status = 'cancelled' WHERE id = _req.reservation_id;

  UPDATE reservation_cancellation_requests
     SET status = 'approved', resolved_by = auth.uid(), resolved_at = now()
   WHERE id = _request_id;
END;
$$;
GRANT EXECUTE ON FUNCTION approve_reservation_cancellation(uuid) TO authenticated;

-- 5. deny_reservation_cancellation — reviewer denies → keep the reservation.
CREATE OR REPLACE FUNCTION deny_reservation_cancellation(_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _req reservation_cancellation_requests;
BEGIN
  SELECT * INTO _req FROM reservation_cancellation_requests
   WHERE id = _request_id AND status = 'pending';
  IF _req.id IS NULL THEN
    RAISE EXCEPTION 'Talep bulunamadı veya zaten sonuçlandırılmış.';
  END IF;

  IF NOT auth_can_review_region(region_of_property(_req.property_id)) THEN
    RAISE EXCEPTION 'Yönetici yetkisi gerekir.' USING ERRCODE = '42501';
  END IF;

  UPDATE reservation_cancellation_requests
     SET status = 'denied', resolved_by = auth.uid(), resolved_at = now()
   WHERE id = _request_id;
END;
$$;
GRANT EXECUTE ON FUNCTION deny_reservation_cancellation(uuid) TO authenticated;
