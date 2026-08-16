-- =============================================================================
-- HomeGuru PMS — migration 135
-- Düzenli gider KENDİ GÜNÜNDE kasaya işlenir, oluşturma anında değil.
-- =============================================================================
-- Owner raporu (2026-08-16): "16 Ağustos'ta, her ayın 17'si için bir düzenli
-- gider oluşturdum. 'Beklenen' görünmesi gerekirken görünmedi ve oluşturur
-- oluşturmaz kasaya işlendi — hâlbuki tek seferlik değil."
--
-- İkisi de doğru ve İKİSİ DE AYNI KÖKTEN geliyor.
--
-- OLAN ŞU:
--   1. Form, tarihin GÜNÜNÜ tekrar gününe sabitler (ExpenseFormPage) →
--      satır expense_date = 2026-08-17 olarak kaydedilir.
--   2. record_expense (125) `_is_recurring` görür ve oluşturan kendi kendini
--      onaylayabiliyorsa AYNI İŞLEMDE approve_expense'i çağırır.
--   3. approve_expense (096) kasa OUT'unu ANINDA yazar — 16 Ağustos'ta,
--      17 Ağustos tarihli bir satır için.
--
-- Yani 125'in self-approve'u onay TIKLAMASINI atlıyordu ama ZAMANLAMAYI da
-- atlıyordu: para, kaydet'e basıldığı anda kasadan çıkıyordu.
--
-- "Beklenen" etiketinin çıkmaması da bunun sonucu: şablon satırı Ağustos için
-- GERÇEK bir gider satırı olarak zaten var, dolayısıyla listedeki projeksiyon
-- onu haklı olarak eliyor (yalnızca gerçek satırı olmayan aylar projekte edilir).
--
-- ÇÖZÜM — şablon bir ÖDEME değil bir TAKVİMDİR:
--   * record_expense artık düzenli gideri yalnızca GÜNÜ GELDİYSE
--     (expense_date <= bugün) anında onaylar/kasaya işler. Günü gelmemişse
--     satır 'pending' kalır ve KASA HİÇ OYNAMAZ.
--   * generate_recurring_expenses şablonun KENDİ ayını da üstlenir: günü
--     geldiğinde şablonu onaylar ve kasa OUT'unu o zaman yazar.
--   * Onay bildirimi düzenli gider için HİÇ üretilmez (aşağıya bak) ve
--     istemci Onay listesi düzenli şablonları göstermez — owner kuralı:
--     "düzenli gider onay bölümüne düşmemeli".
--
-- ÇİFT TAHSİLAT İMKÂNSIZ: kasa OUT'u yalnızca o şablon için
-- cash_transactions'ta (ref_type='expense', ref_id=şablon.id) satır YOKSA
-- yazılır. Cron yarım saatte bir koşar; ikinci koşu hiçbir şey yapmaz.
--
-- 134 ile birlikte uygulanmalıdır (önce 134, sonra 135).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. record_expense — gövde 125'ten BİREBİR; iki nokta değişti.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION record_expense(
  _property_id    uuid,
  _category       text,
  _amount         numeric,
  _description    text,
  _expense_date   date,
  _is_recurring   boolean,
  _paid_from_kasa boolean,
  _recurring_day  smallint DEFAULT NULL,
  _region         text     DEFAULT NULL,
  _unit_id        uuid     DEFAULT NULL
) RETURNS expenses
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _expense    expenses;
  _eff_region text;
  _auto       boolean;
  _today      date := (now() AT TIME ZONE 'Europe/Istanbul')::date;
BEGIN
  IF _unit_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM units WHERE id = _unit_id AND property_id = _property_id
  ) THEN
    RAISE EXCEPTION 'Seçilen birim bu mülke ait değil';
  END IF;

  -- Mirrors set_expense_region (095) so the decision can be made BEFORE the
  -- INSERT (the notify trigger fires on it).
  IF _property_id IS NOT NULL THEN
    _eff_region := (SELECT region FROM properties WHERE id = _property_id);
  ELSE
    _eff_region := COALESCE(NULLIF(btrim(COALESCE(_region, '')), ''), auth_region());
  END IF;

  -- DEĞİŞİKLİK 1 (135): düzenli gider yalnızca GÜNÜ GELDİYSE anında kasaya
  -- işlenir. Günü gelmemiş şablon 'pending' kalır ve kasaya dokunulmaz;
  -- kasa OUT'unu generate_recurring_expenses o gün yazar. 125'te bu tarih
  -- koşulu yoktu, bu yüzden 17'si için kurulan gider 16'sında ödeniyordu.
  _auto := COALESCE(_is_recurring, false)
           AND auth_can_review_region(_eff_region)
           AND _expense_date <= _today;

  -- DEĞİŞİKLİK 2 (135): "Onay bekleyen gider" push'u düzenli gider için ASLA
  -- üretilmez. 125'te bayrak yalnızca _auto iken kuruluyordu; artık günü
  -- gelmemiş şablon 'pending' doğduğu için bayrak kurulmasaydı owner'a
  -- onaylayacak bir şey yokken bildirim giderdi. Düzenli gider onay
  -- bölümüne hiç düşmez (owner kuralı), dolayısıyla bildirimi de yoktur.
  IF COALESCE(_is_recurring, false) THEN
    PERFORM set_config('app.expense_autoapprove', 'on', true);
  END IF;

  INSERT INTO expenses (
    property_id, unit_id, category, amount, description, expense_date,
    is_recurring, paid_from_kasa, recurring_day, region, approval_status, created_by
  ) VALUES (
    _property_id, _unit_id, _category, _amount,
    NULLIF(btrim(COALESCE(_description, '')), ''),
    _expense_date,
    COALESCE(_is_recurring, false),
    COALESCE(_paid_from_kasa, false),
    _recurring_day,
    NULLIF(btrim(COALESCE(_region, '')), ''),
    'pending',
    auth.uid()
  )
  RETURNING * INTO _expense;

  -- Writes the kasa OUT + reviewed_by/at. Runs in this same transaction, so if
  -- it refuses, the gider is not created either — no half state.
  IF _auto THEN
    _expense := approve_expense(_expense.id);
  END IF;

  RETURN _expense;
END;
$$;

GRANT EXECUTE ON FUNCTION
  record_expense(uuid, text, numeric, text, date, boolean, boolean, smallint, text, uuid)
  TO authenticated;

-- -----------------------------------------------------------------------------
-- 2. generate_recurring_expenses — 134'ün gövdesi + şablonun KENDİ ayı.
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
      -- 134: onay ARANMAZ; yalnızca açıkça reddedilmiş şablon dışlanır.
      AND approval_status <> 'rejected'
  LOOP
    -- =======================================================================
    -- 135 — ŞABLONUN KENDİ AYI.
    -- =======================================================================
    -- Şablon satırı aynı zamanda kendi ayının gideridir. 135 öncesi kasa OUT'u
    -- oluşturma anında yazılıyordu (17'si için kurulan gider 16'sında
    -- ödeniyordu). Artık günü gelene kadar 'pending' bekler ve kasa OUT'u
    -- BURADA, gerçek gününde yazılır.
    --
    -- Çift tahsilat imkânsız: NOT EXISTS koşulu o şablona ait bir kasa satırı
    -- varsa hiçbir şey yapmaz. Cron yarım saatte bir koşar, ikinci koşu no-op.
    IF _t.approval_status <> 'approved' AND _t.expense_date <= _today THEN
      UPDATE expenses
         SET approval_status = 'approved',
             reviewed_at     = now()
       WHERE id = _t.id
         AND approval_status <> 'approved';

      IF _t.paid_from_kasa
         AND _kasa_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM cash_transactions
            WHERE ref_type = 'expense' AND ref_id = _t.id
         )
      THEN
        SELECT name INTO _prop FROM properties WHERE id = _t.property_id;
        -- Açıklama bilerek kardeş aylarla AYNI biçimde ("Düzenli gider: …"):
        -- bu satır o şablonun ilk ayıdır, kasa dökümünde sonraki aylarıyla
        -- yan yana okunabilmeli.
        INSERT INTO cash_transactions (
          cash_account_id, amount, direction, description,
          ref_type, ref_id, approval_status, created_by
        ) VALUES (
          _kasa_id, _t.amount, 'OUT',
          'Düzenli gider: '
            || COALESCE(COALESCE(_prop, _t.deleted_property_name) || ' · ', '')
            || _t.category || COALESCE(' — ' || _t.description, ''),
          'expense', _t.id, 'approved', NULL
        );
      END IF;
    END IF;
    -- =======================================================================

    _due_day := LEAST(_t.recurring_day, _last_day);

    IF _today_day < _due_day THEN
      CONTINUE;
    END IF;

    -- The template's own month already represents that month, and a template
    -- dated in a LATER month has not started yet (124).
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
-- 3. Teşhis view'i — 134'teki hâli 135'ten sonra YANILTICI kalıyor.
-- -----------------------------------------------------------------------------
-- 134'te şablonun kendi ayı için tek bir dal vardı ("KENDI AYI — ilk uretim
-- gelecek ay"). 135 ile şablonun kendi ayı da kasaya işleniyor, üstelik
-- gününde; dolayısıyla "günü gelmemiş, bekliyor" ile "günü geçmiş, ilk cron
-- koşusunda işlenecek" hâllerinin ayrı görünmesi gerekiyor — yoksa view
-- bekleyen bir tahsilatı "gelecek ay" diye raporlar.
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
    WHEN e.approval_status = 'rejected'
      THEN 'REDDEDILMIS — kasaya islenmez'
    -- 135: şablon kendi gününü bekliyor, kasa henüz oynamadı.
    WHEN e.approval_status = 'pending'
         AND e.expense_date > (now() AT TIME ZONE 'Europe/Istanbul')::date
      THEN 'BEKLENEN — ' || to_char(e.expense_date, 'DD.MM.YYYY') || ' tarihinde islenecek'
    -- 135: günü geçmiş ama henüz işlenmemiş — ilk cron koşusunda kasaya girer.
    WHEN e.approval_status = 'pending'
      THEN 'GUNU GECTI — ilk cron kosusunda kasaya islenecek'
    WHEN date_trunc('month', e.expense_date)::date
         >= date_trunc('month', (now() AT TIME ZONE 'Europe/Istanbul')::date)::date
      THEN 'KENDI AYI — sonraki uretim gelecek ay'
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

REVOKE ALL ON v_duzenli_gider_durum FROM PUBLIC;
GRANT SELECT ON v_duzenli_gider_durum TO authenticated;
