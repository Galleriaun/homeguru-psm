-- =============================================================================
-- HomeGuru PMS — migration 131
-- Maaşı aşan avans, kalanı sonraki döneme "Önceki avans borcu" olarak taşır.
-- =============================================================================
-- BUG BEING FIXED (silent money loss). Migration 082 pays
--     net = GREATEST(0, maaş − ödenmemiş avans)
-- and then marks EVERY outstanding advance settled, unconditionally. While the
-- advances stay under the salary that nets out exactly. When they exceed it the
-- net is clamped to 0 but the whole advance is still recorded as recovered, so
-- the excess is written off with nothing on screen to show it:
--
--     maaş 40.000, avans 50.000
--       dönem 1: net = max(0, 40.000 − 50.000) = 0 ödenir,
--                50.000'in TAMAMI "tahsil edildi" işaretlenir
--       dönem 2: ödenmemiş avans 0 → tam 40.000 ödenir
--     personel iki dönemde 90.000 alır, hak ettiği 80.000 → 10.000 kayıp.
--
-- pay_staff_salary has the same flaw: it settles every outstanding advance no
-- matter what amount was actually paid.
--
-- FIX. Advances are now recovered PARTIALLY. `settled_amount` records how much
-- of each avans a salary has already taken back; outstanding is
-- (amount − settled_amount). A salary recovers only what it can afford, oldest
-- advance first, and whatever is left stays outstanding — it shows on Personel
-- detay as "Önceki avans borcu" and is deducted from the following salary.
--
--     dönem 1: 0 ödenir, avansın 40.000'i tahsil edilir, 10.000 borç kalır
--     dönem 2: 40.000 − 10.000 = 30.000 ödenir, borç kapanır
--     toplam 50.000 + 0 + 30.000 = 80.000  ✔
--
-- INVARIANT, per cycle:  ödenen nakit + tahsil edilen avans = maaş.
--   ⇒ recovered = LEAST(outstanding, maaş − ödenen)
--   Cron:   ödenen = GREATEST(0, maaş − outstanding) ⇒ recovered = LEAST(outstanding, maaş).
--           The cash amount is IDENTICAL to 082's; only the settlement changes.
--   Manual: the operator's amount wins. Paying the full maaş therefore recovers
--           nothing and carries the whole debt — a deliberate "bu ay kesme"
--           choice rather than a silent write-off.
--
-- `settled_at` is KEPT and now means FULLY recovered (set only once
-- settled_amount reaches amount), so migration 083's semantics and the Avans
-- Geçmişi UI keep working. Every read of "outstanding" moved from
-- `settled_at IS NULL` to `amount > settled_amount`.
--
-- Also: pay_staff_salary now accepts _amount = 0. When the debt covers the whole
-- salary the cycle must still be recordable (and the debt still recovered) with
-- no cash moving — exactly what the cron already does. Negative stays refused.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Partial-recovery column. Backfill runs BEFORE the CHECK so it can't fail:
--    an advance previously marked settled was recovered in full under the old
--    all-or-nothing model, so settled_amount = amount is the faithful value.
-- ---------------------------------------------------------------------------
ALTER TABLE staff_advances
  ADD COLUMN IF NOT EXISTS settled_amount numeric(10, 2) NOT NULL DEFAULT 0;

UPDATE staff_advances
   SET settled_amount = amount
 WHERE settled_at IS NOT NULL
   AND settled_amount <> amount;

ALTER TABLE staff_advances DROP CONSTRAINT IF EXISTS staff_advances_settled_amount_chk;
ALTER TABLE staff_advances ADD CONSTRAINT staff_advances_settled_amount_chk
  CHECK (settled_amount >= 0 AND settled_amount <= amount);

COMMENT ON COLUMN staff_advances.settled_amount IS
  'How much of this avans a salary has already recovered. Outstanding = amount - settled_amount. settled_at is set only when it reaches amount.';

-- ---------------------------------------------------------------------------
-- 2. Recover up to _budget from a staff member''s outstanding advances, oldest
--    first, and report how much was actually taken. Internal to the two salary
--    paths — NOT granted to app roles (it rewrites settlement state).
--    FOR UPDATE serialises two salary runs racing on the same staff.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _recover_staff_advances(_user_id uuid, _budget numeric)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  budget_left     numeric := GREATEST(0, COALESCE(_budget, 0));
  recovered_total numeric := 0;
  adv             record;
  take            numeric;
BEGIN
  FOR adv IN
    SELECT id, amount - settled_amount AS outstanding
      FROM staff_advances
     WHERE user_id = _user_id
       AND amount > settled_amount
     ORDER BY given_at, id          -- oldest first; id breaks ties deterministically
       FOR UPDATE
  LOOP
    EXIT WHEN budget_left <= 0;
    take := LEAST(adv.outstanding, budget_left);

    UPDATE staff_advances
       SET settled_amount = settled_amount + take,
           -- Only a full recovery stamps settled_at; a partial one leaves it
           -- NULL so the row still reads as outstanding everywhere.
           settled_at = CASE WHEN settled_amount + take >= amount THEN now() ELSE NULL END
     WHERE id = adv.id;

    budget_left     := budget_left - take;
    recovered_total := recovered_total + take;
  END LOOP;

  RETURN recovered_total;
END;
$$;

REVOKE ALL ON FUNCTION _recover_staff_advances(uuid, numeric) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Manual salary RPC — pay the operator''s amount, then recover only what
--    this salary can afford. Body otherwise verbatim from 082.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pay_staff_salary(
  _user_id    uuid,
  _amount     numeric,
  _pay_period date,
  _note       text DEFAULT NULL
) RETURNS staff_salary_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  kasa_id     uuid;
  staff_name  text;
  staff_maas  numeric;
  outstanding numeric;
  budget      numeric;
  new_tx_id   uuid;
  result      staff_salary_payments;
BEGIN
  IF auth_role() <> 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'Maaş ödemesi için yönetici yetkisi gerekir.' USING ERRCODE = '42501';
  END IF;
  -- 0 is legal now (see header); negative is not.
  IF _amount IS NULL OR _amount < 0 THEN
    RAISE EXCEPTION 'Maaş tutarı negatif olamaz.';
  END IF;

  SELECT id INTO kasa_id FROM cash_accounts WHERE property_id IS NULL LIMIT 1;
  IF kasa_id IS NULL THEN
    RAISE EXCEPTION 'Genel kasa bulunamadı.';
  END IF;

  SELECT full_name, salary INTO staff_name, staff_maas
    FROM staff_profiles WHERE user_id = _user_id;
  IF staff_name IS NULL THEN
    RAISE EXCEPTION 'Personel bulunamadı.';
  END IF;

  -- No cash movement for a fully-offset month — mirrors the cron.
  IF _amount > 0 THEN
    INSERT INTO cash_transactions (
      cash_account_id, amount, direction, description,
      ref_type, ref_id, created_by, approval_status
    ) VALUES (
      kasa_id, _amount, 'OUT',
      'Maaş: ' || staff_name,
      'staff_salary_payment', NULL, auth.uid(), 'approved'
    )
    RETURNING id INTO new_tx_id;
  END IF;

  INSERT INTO staff_salary_payments (
    user_id, amount, source, pay_period,
    cash_account_id, cash_tx_id, note, created_by
  ) VALUES (
    _user_id, _amount, 'MANUAL',
    date_trunc('month', _pay_period)::date,
    kasa_id, new_tx_id, _note, auth.uid()
  )
  RETURNING * INTO result;

  -- ödenen + tahsil = maaş. With no salary on file there is no cycle amount to
  -- net against, so recover NOTHING rather than silently writing the debt off —
  -- it stays outstanding and shows as borç until a salary exists.
  SELECT COALESCE(SUM(amount - settled_amount), 0) INTO outstanding
    FROM staff_advances
   WHERE user_id = _user_id AND amount > settled_amount;

  budget := GREATEST(0, LEAST(outstanding, COALESCE(staff_maas, _amount) - _amount));
  PERFORM _recover_staff_advances(_user_id, budget);

  RETURN result;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Auto-pay cron — same cash as 082 (GREATEST(0, maaş − outstanding)), but it
--    now recovers at most one salary''s worth and lets the rest carry.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION process_auto_salary_payments()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  today_day         int;
  today_month       date;
  last_day_of_month int;
  kasa_id           uuid;
  staff_rec         record;
  outstanding       numeric;
  recovered         numeric;
  net               numeric;
  new_tx_id         uuid;
  count_paid        int := 0;
BEGIN
  today_day := EXTRACT(DAY FROM (now() AT TIME ZONE 'Europe/Istanbul')::date)::int;
  today_month := date_trunc('month', (now() AT TIME ZONE 'Europe/Istanbul')::date)::date;
  last_day_of_month := EXTRACT(
    DAY FROM (today_month + interval '1 month' - interval '1 day')
  )::int;

  SELECT id INTO kasa_id FROM cash_accounts WHERE property_id IS NULL LIMIT 1;
  IF kasa_id IS NULL THEN
    RAISE NOTICE 'No general kasa configured; skipping salary cron run.';
    RETURN 0;
  END IF;

  FOR staff_rec IN
    SELECT sp.user_id, sp.salary, sp.full_name
    FROM staff_profiles sp
    WHERE sp.deleted_at IS NULL
      AND sp.salary IS NOT NULL
      AND sp.salary > 0
      AND (
        sp.salary_day = today_day
        OR (sp.salary_day > last_day_of_month AND today_day = last_day_of_month)
      )
      AND NOT EXISTS (
        SELECT 1 FROM staff_salary_payments ssp
        WHERE ssp.user_id = sp.user_id
          AND ssp.pay_period = today_month
      )
  LOOP
    SELECT COALESCE(SUM(amount - settled_amount), 0) INTO outstanding
    FROM staff_advances
    WHERE user_id = staff_rec.user_id AND amount > settled_amount;

    -- Take back at most one salary; the remainder carries to the next cycle.
    recovered := LEAST(outstanding, staff_rec.salary);
    net := staff_rec.salary - recovered;     -- = GREATEST(0, maaş − outstanding)

    new_tx_id := NULL;
    IF net > 0 THEN
      INSERT INTO cash_transactions (
        cash_account_id, amount, direction, description,
        ref_type, ref_id, created_by, approval_status
      ) VALUES (
        kasa_id, net, 'OUT',
        'Maaş (otomatik): ' || staff_rec.full_name,
        'staff_salary_payment', NULL, NULL, 'approved'
      )
      RETURNING id INTO new_tx_id;
    END IF;

    INSERT INTO staff_salary_payments (
      user_id, amount, source, pay_period,
      cash_account_id, cash_tx_id, created_by
    ) VALUES (
      staff_rec.user_id, net, 'AUTO',
      today_month, kasa_id, new_tx_id, NULL
    );

    PERFORM _recover_staff_advances(staff_rec.user_id, recovered);

    count_paid := count_paid + 1;
  END LOOP;

  RETURN count_paid;
END;
$$;

-- =============================================================================
-- 5. ONE-TIME REPAIR — reopen the avans that the old behaviour wrote off.
--
-- This runs automatically and derives the amount itself; nothing to fill in.
-- For each past salary payment it reconstructs what that payment recovered (082
-- stamps settled_at inside the payment's own transaction, so those advances
-- carry settled_at = paid_at) and applies the same invariant the new code uses:
--
--     tahsil edilen + ödenen  should equal  maaş
--     fazla = tahsil edilen + ödenen − maaş        (> 0 only when the bug hit)
--
-- The excess is then un-recovered from that person's most recent advances, newest
-- first, so exactly that much becomes outstanding again. It surfaces as "Önceki
-- avans borcu" on Personel detay and the next salary deducts it. No trigger
-- fires on UPDATE, so the kasa is deliberately untouched — that cash really did
-- leave the till; what was wrong was calling it recovered.
--
-- Guards:
--   * skips anyone who already has a partially-recovered avans — that state only
--     exists once 131 has acted, so a re-run is a no-op (idempotent);
--   * per-person excesses are summed, so a person hit in several cycles is fixed
--     in one pass;
--   * aborts loudly if the excess cannot be fully un-recovered rather than
--     leaving a half-applied correction;
--   * only considers staff with a salary on file (salary > 0).
--
-- Expected on the live DB (from Personel detay, Temmuz 2026): maaş 30.000,
-- avanslar 31.870, otomatik ödeme 0 → the NOTICE should report 1.870 TL.
-- Caveat worth knowing: staff_profiles.salary is TODAY's salary. If someone's
-- salary changed between the affected payday and now, their computed excess is
-- measured against the new figure — check the NOTICE amounts look right.
-- =============================================================================
DO $repair$
DECLARE
  rec          record;
  adv          record;
  left_to_undo numeric;
  give_back    numeric;
  fixed_count  int := 0;
BEGIN
  FOR rec IN
    SELECT t.user_id,
           t.full_name,
           t.salary,
           SUM(t.excess) AS total_excess
      FROM (
        SELECT ssp.user_id,
               sp.full_name,
               sp.salary,
               -- Capped at what was actually recovered. Without the cap a
               -- legitimate over-payment (bonus / back-pay, or a salary that has
               -- since been LOWERED) would inflate the excess and reopen debt
               -- that was never written off. Only the recovered portion can ever
               -- be the bug's doing.
               LEAST(
                 COALESCE(SUM(sa.amount), 0),
                 COALESCE(SUM(sa.amount), 0) + ssp.amount - sp.salary
               ) AS excess
          FROM staff_salary_payments ssp
          JOIN staff_profiles sp ON sp.user_id = ssp.user_id
          LEFT JOIN staff_advances sa
                 ON sa.user_id = ssp.user_id
                AND sa.settled_at BETWEEN ssp.paid_at - interval '5 seconds'
                                      AND ssp.paid_at + interval '5 seconds'
         WHERE sp.salary IS NOT NULL
           AND sp.salary > 0
         GROUP BY ssp.user_id, sp.full_name, sp.salary, ssp.amount, ssp.paid_at
        -- Something must actually have been recovered, and it must have exceeded
        -- what this payment could afford. A payment that settled nothing cannot
        -- have written anything off.
        HAVING COALESCE(SUM(sa.amount), 0) > 0
           AND COALESCE(SUM(sa.amount), 0) + ssp.amount - sp.salary > 0
      ) t
     GROUP BY t.user_id, t.full_name, t.salary
  LOOP
    IF EXISTS (
      SELECT 1 FROM staff_advances
       WHERE user_id = rec.user_id
         AND settled_amount > 0
         AND settled_amount < amount
    ) THEN
      RAISE NOTICE '131 onarım atlandı (%) — zaten kısmî tahsilatlı avansı var.',
        rec.full_name;
      CONTINUE;
    END IF;

    left_to_undo := rec.total_excess;

    FOR adv IN
      SELECT id, settled_amount
        FROM staff_advances
       WHERE user_id = rec.user_id
         AND settled_amount > 0
       ORDER BY given_at DESC, id DESC      -- newest first: the debt just incurred
    LOOP
      EXIT WHEN left_to_undo <= 0;
      give_back := LEAST(adv.settled_amount, left_to_undo);

      UPDATE staff_advances
         SET settled_amount = settled_amount - give_back,
             settled_at     = NULL          -- no longer fully recovered
       WHERE id = adv.id;

      left_to_undo := left_to_undo - give_back;
    END LOOP;

    IF left_to_undo > 0 THEN
      RAISE EXCEPTION
        '131 onarım başarısız (%): % TL geri açılamadı — tahsil edilmiş avans yetersiz.',
        rec.full_name, left_to_undo;
    END IF;

    fixed_count := fixed_count + 1;
    RAISE NOTICE '131 onarım (%): maaş % — % TL borç olarak geri açıldı.',
      rec.full_name, rec.salary, rec.total_excess;
  END LOOP;

  IF fixed_count = 0 THEN
    RAISE NOTICE '131: onarılacak fazla tahsilat bulunamadı.';
  END IF;
END $repair$;
