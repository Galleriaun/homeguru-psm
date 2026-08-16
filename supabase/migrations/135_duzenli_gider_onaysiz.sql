-- =============================================================================
-- HomeGuru PMS — migration 135
-- Düzenli gider onay gerektirmez; yalnızca REDDEDİLEN şablon engellenir.
-- =============================================================================
-- Owner kararı (2026-08-16): "Düzenli gider onaya gerek kalmadan kasaya
-- işlenmeli." Bu migration onay kapısını düzenli giderlerden kaldırır.
--
-- 134'ÜN ÜZERİNE YAZAR (134 SİLİNMEZ). 134 tam TERS yönde bir düzeltmeydi —
-- "Kasaya işle"yi cron'un o günkü kapısına (yalnızca 'approved') hizalıyordu.
-- Owner o davranışı istemedi. 134 yayınlandığı ve uygulanmış olabileceği için
-- düzenlenmez; bu migration onun post_recurring_instance_now sürümünün üzerine
-- yazar. 134 uygulandıysa da uygulanmadıysa da sonuç aynıdır.
--
-- ARKA PLAN — bu bir gerileme değil, 125'in fazla dar kalan kapısının
-- kalibrasyonu:
--
-- 125 generate_recurring_expenses'e `AND approval_status = 'approved'` ekledi
-- ve MEVCUT satırları backfill ETMEDİ. 125 öncesi üretici onaya hiç bakmıyordu,
-- yani 'pending' bekleyen bir şablon aylarca sorunsuz üretiyordu. 125
-- uygulandığı anda bu şablonlar sessizce durdu — ekranda hâlâ "Beklenen"
-- yazıyordu ama hiçbir zaman gelmeyecekti. Sahada görülen hata tam olarak budur.
--
-- 125'in kapattığı GERÇEK para hatası ise şuydu: REDDEDİLEN bir şablon her ay
-- kasayı borçlandırmaya devam ediyordu, yöneticinin reddi hiçbir işe yaramıyordu.
-- O hata kapalı KALMALI.
--
-- Dolayısıyla kapı kaldırılmıyor, daraltılıyor:
--     ESKİ (125):  approval_status  = 'approved'   → pending de engelleniyordu
--     YENİ (134):  approval_status <> 'rejected'   → yalnızca red engellenir
--
-- Sonuç: bir düzenli gider oluşturulduğu andan itibaren her ay kendiliğinden
-- kasaya işler — kim oluşturmuş olursa olsun, hiçbir onay tıklaması gerekmez.
-- Reddedilen şablon ise hiçbir yoldan kasaya giremez.
--
-- BİLİNEN SINIR (bilerek kapsam dışı): bir şablonun KENDİ ilk ayının kasa OUT'u
-- hâlâ approve_expense tarafından yazılır (105/125). SUPER_ADMIN veya bölgesi
-- olan bir PROPERTY_MANAGER için bu zaten oluşturma anında otomatik çalışır
-- (125'in self-approve'u), yani onlar için hiçbir şey değişmez. Ama bir YETKILI
-- personelin oluşturduğu şablon RLS gereği (064) 'pending' doğar ve kendi ilk
-- ayı onaylanana kadar kasaya girmez; bu migration'dan sonra o şablonun
-- SONRAKİ ayları otomatik işler. İlk ayın da otomatik olması istenirse
-- record_expense/approve_expense tarafında ayrı bir değişiklik gerekir.
--
-- Geçmiş DÜZELTİLMEZ: üretici yalnızca İÇİNDE BULUNULAN ayı üretir, backfill'i
-- yoktur. Şablon aylardır takılıysa aradaki aylar kendiliğinden gelmez; istenirse
-- elle tek seferlik gider olarak girilmelidir.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. generate_recurring_expenses — gövde 125'ten BİREBİR; tek fark onay kapısı.
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
      -- 134: onay ARANMAZ. Yalnızca açıkça reddedilmiş şablon dışlanır —
      -- 125'in kapattığı para hatası (reddedilen şablon her ay kasayı
      -- borçlandırıyordu) bu satır sayesinde kapalı kalır.
      AND approval_status <> 'rejected'
  LOOP
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
-- 2. post_recurring_instance_now ("Kasaya işle") — aynı kuralı uygular.
-- -----------------------------------------------------------------------------
-- Gövde 124'ten BİREBİR; tek ekleme reddedilen şablon kontrolü.
--
-- 124'te hiçbir onay kontrolü YOKTU, yani buton reddedilmiş bir şablonu da tek
-- tıklamayla kasaya işleyebiliyordu — cron'un her ay reddettiği şeyi. 125 bu
-- açığı yalnızca cron tarafında kapattı. Buton ile cron artık AYNI kurala uyar:
-- pending serbest, rejected yasak.
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

  -- ↓↓↓ 124'e göre TEK EKLEME ↓↓↓
  -- Yetki/bölge kontrollerinden SONRA: yetkisiz çağıran önce yetki hatasını
  -- alsın, şablonun durumu sızmasın.
  IF _t.approval_status = 'rejected' THEN
    RAISE EXCEPTION 'Bu düzenli gider reddedilmiş, kasaya işlenemez.'
      USING ERRCODE = '42501';
  END IF;
  -- ↑↑↑ EKLEME SONU ↑↑↑

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
-- 3. Teşhis: hangi düzenli gider neden üretmiyor.
-- -----------------------------------------------------------------------------
-- Üreticinin koşullarının BİREBİR aynısını yansıtır, böylece "durum" sütunu
-- gerçek sebeptir, yaklaşık değil. Salt okunur.
--
-- security_invoker = true ZORUNLU, kozmetik değil: bir view varsayılan olarak
-- OWNER haklarıyla çalışır ve expenses RLS'ini komple baypas ederdi — o hâlde
-- giriş yapmış herkes view üzerinden bütün giderleri okuyabilirdi. Bu ayarla
-- çağıranın kendi RLS'i, tablodaki gibi aynen uygulanır.
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

-- View, expenses RLS'inin zaten yönettiği satırları gösterir; yine de grant'ı
-- PUBLIC'e bırakmak yerine açıkça ver.
REVOKE ALL ON v_duzenli_gider_durum FROM PUBLIC;
GRANT SELECT ON v_duzenli_gider_durum TO authenticated;
