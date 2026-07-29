-- =============================================================================
-- HomeGuru PMS — migration 132
-- soft_delete_entity enforces per-row permissions again (reverts 062's regression)
-- =============================================================================
-- WHAT WENT WRONG. Migration 021 created soft_delete_entity as SECURITY INVOKER
-- precisely so each table's own RLS decides whether the DELETE is allowed — "we
-- don't reinvent permission rules". Migration 062 rewrote the function to add the
-- payment_collection guard and, in restating the whole body, silently changed it
-- to SECURITY DEFINER and dropped the ROW_COUNT = 0 rollback. Migration 122's
-- comments still describe the INVOKER + ROW_COUNT behaviour, so this was an
-- accident, not a decision.
--
-- Consequence: the single funnel every "Sil" goes through has been bypassing RLS
-- ever since, which silently voided four deliberate protections —
--   * 090 narrowed reservations_delete to SUPER_ADMIN so that everyone else must
--     file a deletion REQUEST. Calling the RPC directly walks past that gate.
--   * 015 (kasa hareketi) and 017 (cari hareket) restrict deletion to
--     SUPER_ADMIN. Both bypassable.
--   * 095/102 scope gider deletion to the manager's own region, so a Bornova
--     manager could delete an Ana Grup gider.
--
-- THE FIX, and nothing else:
--   1. SECURITY INVOKER — the caller's RLS governs the DELETE again.
--   2. The ROW_COUNT = 0 check is restored, and it is NOT optional now: once RLS
--      can legitimately block the DELETE, a zero-row delete would otherwise
--      leave the trash row behind and still return success — the item would show
--      in Çöp Kutusu while still living in its real table. Raising instead rolls
--      the whole transaction back, trash row included.
--   3. Everything else is byte-for-byte the deployed 123 body: the same labels,
--      the same payment_collection guard (062), and the same units branch that
--      orphans a birim's rezervasyonlar before deleting it (123).
--
-- Why the existing callers still work:
--   * approve_reservation_deletion (090/097) is itself SECURITY DEFINER, so an
--     INVOKER callee runs as the owner and still bypasses RLS — correct, since a
--     Yönetici approved that deletion.
--   * stop_recurring_expense (085) and delete_advance_cascade (122) are
--     SECURITY INVOKER and expect the caller's RLS to apply — which is exactly
--     what their own comments say.
--   * The units branch needs UPDATE on reservations to orphan them.
--     reservations_update covers SUPER_ADMIN / PROPERTY_MANAGER / RECEPTION /
--     YETKILI, a superset of the roles units_modify lets delete a birim, so any
--     caller who can delete the unit can also orphan its stays.
--
-- _trash_trim is deliberately NOT reinstated here. It caps trash at the newest 15
-- per (type, branch) and has not run since 062, so switching it back on would
-- permanently prune whatever has accumulated past that — a separate decision,
-- not something to bundle into a permissions fix.
-- =============================================================================

CREATE OR REPLACE FUNCTION soft_delete_entity(p_type text, p_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER                 -- ← the fix (was DEFINER since 062)
SET search_path = public
AS $$
DECLARE
  v_payload  jsonb;
  v_branch   uuid;
  v_label    text;
  v_trash_id uuid;
  v_pc_id    uuid;
  v_deleted  int;
BEGIN
  CASE p_type
    WHEN 'housekeeping_issues' THEN
      SELECT to_jsonb(t),
             t.property_id,
             COALESCE(left(t.description, 80), '(boş)')
        INTO v_payload, v_branch, v_label
        FROM housekeeping_issues t
        WHERE t.id = p_id;

    WHEN 'reservations' THEN
      SELECT to_jsonb(t),
             t.property_id,
             COALESCE(g.full_name, 'Misafir') ||
               ' · ' || to_char(t.stay_start, 'YYYY-MM-DD') ||
               '→' || to_char(t.stay_end, 'YYYY-MM-DD')
        INTO v_payload, v_branch, v_label
        FROM reservations t
        LEFT JOIN guests g ON g.id = t.guest_id
        WHERE t.id = p_id;

    WHEN 'cash_transactions' THEN
      SELECT to_jsonb(t),
             a.property_id,
             t.direction || ' ' || t.amount::text || COALESCE(' — ' || t.description, ''),
             t.payment_collection_id
        INTO v_payload, v_branch, v_label, v_pc_id
        FROM cash_transactions t
        JOIN cash_accounts a ON a.id = t.cash_account_id
        WHERE t.id = p_id;
      IF v_pc_id IS NOT NULL THEN
        RAISE EXCEPTION
          'Bu kasa hareketi misafir tahsilatından gelir. Önce tahsilatı (Rezervasyon → ledger) silin; kasa hareketi otomatik temizlenir.';
      END IF;

    WHEN 'ledger_entries' THEN
      SELECT to_jsonb(t),
             (SELECT property_id FROM reservations WHERE id = t.reservation_id),
             t.type || ' ' || t.amount::text || COALESCE(' — ' || t.note, '')
        INTO v_payload, v_branch, v_label
        FROM ledger_entries t
        WHERE t.id = p_id;

    WHEN 'expenses' THEN
      SELECT to_jsonb(t),
             t.property_id,
             t.category || ' — ' || t.amount::text
        INTO v_payload, v_branch, v_label
        FROM expenses t
        WHERE t.id = p_id;

    WHEN 'message_templates' THEN
      SELECT to_jsonb(t),
             NULL::uuid,
             t.name
        INTO v_payload, v_branch, v_label
        FROM message_templates t
        WHERE t.id = p_id;

    WHEN 'staff_advances' THEN
      SELECT to_jsonb(t),
             (SELECT property_id FROM staff_profiles WHERE user_id = t.user_id),
             t.amount::text || COALESCE(' — ' || t.note, '')
        INTO v_payload, v_branch, v_label
        FROM staff_advances t
        WHERE t.id = p_id;

    WHEN 'units' THEN
      SELECT to_jsonb(t),
             t.property_id,
             t.name
        INTO v_payload, v_branch, v_label
        FROM units t
        WHERE t.id = p_id;

    ELSE
      RAISE EXCEPTION 'Trash bin does not support entity type: %', p_type;
  END CASE;

  -- Under INVOKER an invisible row yields a NULL payload, so this doubles as the
  -- "you cannot even see it" gate (021's original intent).
  IF v_payload IS NULL THEN
    RAISE EXCEPTION 'Kayıt bulunamadı veya görme yetkiniz yok.';
  END IF;

  INSERT INTO trash_entries (entity_type, entity_id, entity_label, branch_id, payload, deleted_by)
  VALUES (p_type, p_id, v_label, v_branch, v_payload, auth.uid())
  RETURNING id INTO v_trash_id;

  CASE p_type
    WHEN 'housekeeping_issues' THEN DELETE FROM housekeeping_issues WHERE id = p_id;
    WHEN 'reservations'        THEN DELETE FROM reservations        WHERE id = p_id;
    WHEN 'cash_transactions'   THEN DELETE FROM cash_transactions   WHERE id = p_id;
    WHEN 'ledger_entries'      THEN DELETE FROM ledger_entries      WHERE id = p_id;
    WHEN 'expenses'            THEN DELETE FROM expenses            WHERE id = p_id;
    WHEN 'message_templates'   THEN DELETE FROM message_templates   WHERE id = p_id;
    WHEN 'staff_advances'      THEN DELETE FROM staff_advances      WHERE id = p_id;

    WHEN 'units' THEN
      -- Same live-stay guard as delete_property: orphaning would technically
      -- work, but silently cutting an ongoing konaklama loose from its room
      -- is a mistake — block and let the operator finish it first.
      IF EXISTS (
        SELECT 1 FROM reservations
        WHERE unit_id = p_id AND status = 'active'
      ) THEN
        RAISE EXCEPTION 'Aktif (devam eden) rezervasyonu olan birim silinemez. Önce mevcut konaklamayı tamamlayın.'
          USING ERRCODE = 'check_violation';
      END IF;

      -- Orphan the reservations: keep the row, snapshot the birim's name
      -- (v_label, captured above), break only the unit tie. The mülk tie
      -- stays — the property still exists.
      UPDATE reservations SET
        deleted_unit_name = v_label,
        unit_id           = NULL
      WHERE unit_id = p_id;

      -- Under INVOKER the UPDATE above is RLS-filtered, so a caller who may
      -- delete the birim but not update one of its stays would leave a dangling
      -- reference and hit the raw FK error (23503) the whole 123 fix existed to
      -- remove. Say so in Turkish instead. Not reachable today — every role that
      -- units_modify lets delete is also in reservations_update — but the cost
      -- of being sure is one EXISTS.
      IF EXISTS (SELECT 1 FROM reservations WHERE unit_id = p_id) THEN
        RAISE EXCEPTION 'Bu birime bağlı rezervasyonların bağı koparılamadı — yetkiniz yetersiz.'
          USING ERRCODE = '42501';
      END IF;

      DELETE FROM units WHERE id = p_id;
  END CASE;

  -- ROW_COUNT belongs to the DELETE that just ran in whichever branch (the units
  -- branch ends with its own DELETE too). Zero rows means RLS refused it, so the
  -- trash row must not survive: RAISE aborts the transaction and takes the INSERT
  -- above with it. No explicit cleanup DELETE — trash_entries deletion is itself
  -- RLS-gated to SUPER_ADMIN, so attempting it here would replace this clear
  -- message with a "permission denied for table trash_entries" for everyone else.
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted = 0 THEN
    RAISE EXCEPTION 'Silme yetkisi yok ya da kayıt zaten silinmiş.'
      USING ERRCODE = '42501';
  END IF;

  RETURN v_trash_id;
END;
$$;
