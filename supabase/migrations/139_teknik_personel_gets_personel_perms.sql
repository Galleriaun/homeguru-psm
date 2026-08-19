-- =============================================================================
-- HomeGuru PMS — migration 139
-- Teknik Personel artık PERSONEL (YETKILI) yetkilerine sahip.
-- =============================================================================
-- Owner kararı (2026-08-19): Teknik Personel rolü, Personel rolünün yetkilerinin
-- TAMAMINI alacak. Bunun dışında hiçbir şey değişmiyor — özellikle MAAŞ VE AVANS
-- HÂLÂ BORNOVA KASASINDAN çıkıyor.
--
-- -----------------------------------------------------------------------------
-- DEĞİŞEN TEK ŞEY: auth_role() eşlemesi
-- -----------------------------------------------------------------------------
--   ÖNCE:  TEKNIK_PERSONEL → 'HOUSEKEEPING'   (114 + 117)
--   SONRA: TEKNIK_PERSONEL → 'YETKILI'
--
-- Rolün adı, staff_profiles'taki değeri ve CHECK kısıtı DEĞİŞMEDİ. Yalnızca
-- hangi temel rol gibi davrandığı değişti.
--
-- -----------------------------------------------------------------------------
-- DOKUNULMAYANLAR — hepsi HAM role baktığı için bu değişiklikten etkilenmez
-- -----------------------------------------------------------------------------
--   * staff_region() (120) → 'bornova'. MAAŞ/AVANS BORNOVA KASASINDAN ÇIKMAYA
--     DEVAM EDER. Owner'ın açıkça korunmasını istediği şey budur ve bu migration
--     o fonksiyona hiç dokunmuyor.
--   * auth_sees_property() (117) → `sp.role = 'TEKNIK_PERSONEL'` bypass'ı duruyor,
--     yani rol TÜM BÖLGELERDEKİ tüm mülkleri görmeye devam eder. YETKILI normalde
--     bölgeye bağlıdır; teknik bu bypass sayesinde bağlı DEĞİLDİR ve öyle kalır.
--   * auth_region() → NULL. Değişmedi.
--   * Sorun (issue) politikaları zaten rol kontrolü içermiyor, yalnızca
--     auth_sees_property'e bakıyor → sorun bildirimi aynen çalışmaya devam eder.
--
-- -----------------------------------------------------------------------------
-- KALDIRILAN ÜÇ YASAK (owner kararı: "üçü de kalksın — tam Personel")
-- -----------------------------------------------------------------------------
-- Bu üç yasak, teknik rolü HOUSEKEEPING'den yetki MİRAS ALDIĞI için yazılmıştı;
-- amaç istenmeyen mirası geri almaktı. Artık yetki bilinçli olarak veriliyor, o
-- yüzden üçü de kalkıyor:
--   116 → misafir TC kimlik / pasaport şifre çözme yasağı
--   118 → temizlik durumu yazma yasağı + tahsilat oluşturma yasağı (trigger)
--   121 → tahsilat (payment_collections) okuma yasağı
--
-- ⚠ KVKK NOTU: 116'nın kalkmasıyla teknik personel misafir TC kimlik ve pasaport
-- bilgisini çözebilir hâle gelir. Bu özel nitelikli kişisel veridir. Erişim
-- audit_log'a _audit_guest_decrypt ile yazılmaya devam eder (043) — yani iz
-- kayboluyor değil, yetki genişliyor. Owner bunu bilerek seçti.
--
-- -----------------------------------------------------------------------------
-- GÖVDELER BİREBİR KOPYALANDI
-- -----------------------------------------------------------------------------
-- Şifre çözme fonksiyonlarının EN SON hâli 116 değil 117'dir (117 ikisini de
-- yeniden tanımlıyor). Bu yüzden gövdeler 043/042'den değil 117'DEN alındı;
-- 043/042'ye dönmek 117'nin değişikliklerini sessizce geri alırdı.
-- Politikalar 033'ün hâline döndürüldü.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. auth_role() — 117'den birebir, YALNIZCA teknik satırı değişti
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
           WHEN role = 'YONETICI_BORNOVA' THEN 'PROPERTY_MANAGER'
           WHEN role = 'PERSONEL_BORNOVA' THEN 'YETKILI'
           WHEN role = 'TEKNIK_PERSONEL' THEN 'YETKILI'
           ELSE role
         END
  FROM staff_profiles
  WHERE user_id = auth.uid() AND deleted_at IS NULL;
$$;

-- -----------------------------------------------------------------------------
-- 2. get_guest_decrypted — 117'den birebir, teknik deny guard'ı ÇIKARILDI
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_guest_decrypted(_id uuid)
RETURNS TABLE(
  id                uuid,
  full_name         text,
  tc_kimlik         text,
  passport          text,
  phone             text,
  email             text,
  address           text,
  nationality       text,
  is_problematic    boolean,
  problematic_note  text,
  consent_given_at  timestamptz,
  consent_version   text,
  created_at        timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    auth_role() = 'SUPER_ADMIN'
    OR auth_role() IN ('PROPERTY_MANAGER', 'RECEPTION')
    OR EXISTS (
      SELECT 1 FROM reservations r
      WHERE r.guest_id = _id
        AND auth_sees_property(r.property_id)
    )
  ) THEN
    RAISE EXCEPTION 'Bu misafire erişim yetkiniz yok' USING ERRCODE = '42501';
  END IF;

  PERFORM _audit_guest_decrypt(_id);

  RETURN QUERY
  SELECT
    g.id,
    g.full_name,
    decrypt_sensitive(g.tc_kimlik_encrypted),
    decrypt_sensitive(g.passport_encrypted),
    g.phone,
    g.email,
    g.address,
    g.nationality,
    g.is_problematic,
    g.problematic_note,
    g.consent_given_at,
    g.consent_version,
    g.created_at
  FROM guests g
  WHERE g.id = _id;
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. get_companions_decrypted — 117'den birebir, teknik deny guard'ı ÇIKARILDI
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_companions_decrypted(_guest_id uuid)
RETURNS TABLE(
  id uuid,
  guest_id uuid,
  full_name text,
  relationship text,
  birth_date date,
  nationality text,
  tc_kimlik text,
  passport text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    auth_role() = 'SUPER_ADMIN'
    OR auth_role() IN ('PROPERTY_MANAGER', 'RECEPTION')
    OR EXISTS (
      SELECT 1 FROM reservations r
      WHERE r.guest_id = _guest_id
        AND auth_sees_property(r.property_id)
    )
  ) THEN
    RAISE EXCEPTION 'Bu misafire erişim yetkiniz yok' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM guest_companions gc WHERE gc.guest_id = _guest_id) THEN
    PERFORM _audit_guest_decrypt(_guest_id);
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.guest_id,
    c.full_name,
    c.relationship,
    c.birth_date,
    c.nationality,
    decrypt_sensitive(c.tc_kimlik_encrypted),
    decrypt_sensitive(c.passport_encrypted),
    c.created_at
  FROM guest_companions c
  WHERE c.guest_id = _guest_id
  ORDER BY c.created_at;
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. hk_tasks_modify — 118'in ham-rol guard'ı kalktı, 033'ün hâline dönüldü
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS hk_tasks_modify ON housekeeping_tasks;
CREATE POLICY hk_tasks_modify ON housekeeping_tasks FOR ALL
  USING (auth_sees_property(property_id))
  WITH CHECK (auth_sees_property(property_id));

-- -----------------------------------------------------------------------------
-- 5. Tahsilat oluşturma yasağı (118) kaldırıldı
-- -----------------------------------------------------------------------------
-- Trigger ÖNCE, fonksiyon SONRA düşürülür — ters sırada trigger hâlâ var olmayan
-- bir fonksiyona bağlı kalırdı.
DROP TRIGGER IF EXISTS payment_collections_deny_teknik ON payment_collections;
DROP FUNCTION IF EXISTS _deny_teknik_payment();

-- -----------------------------------------------------------------------------
-- 6. payment_collections_select — 121'in guard'ı kalktı, 033'e dönüldü
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS payment_collections_select ON payment_collections;
CREATE POLICY payment_collections_select ON payment_collections FOR SELECT
  USING (auth_sees_property(property_id));

-- -----------------------------------------------------------------------------
-- 7. DOĞRULAMA — hem değişenler hem KORUNMASI GEREKENLER sınanır
-- -----------------------------------------------------------------------------
-- Bu blok yalnızca "değişiklik uygulandı mı"ya bakmıyor; owner'ın açıkça
-- korunmasını istediği iki şeyin (Bornova kasası + tüm-bölge görünürlüğü) hâlâ
-- yerinde olduğunu da doğruluyor. Onlar bozulursa migration BAŞARISIZ olsun.
DO $$
DECLARE
  _src text;
BEGIN
  -- (a) Teknik artık YETKILI gibi davranıyor mu?
  SELECT prosrc INTO _src FROM pg_proc WHERE proname = 'auth_role';
  IF _src NOT LIKE '%WHEN role = ''TEKNIK_PERSONEL'' THEN ''YETKILI''%' THEN
    RAISE EXCEPTION 'auth_role() teknik rolü YETKILI''ye eşlemiyor.';
  END IF;

  -- (b) KORUNMALI: maaş/avans hâlâ Bornova kasasından mı?
  SELECT prosrc INTO _src FROM pg_proc WHERE proname = 'staff_region';
  IF _src NOT LIKE '%TEKNIK_PERSONEL%' OR _src NOT LIKE '%bornova%' THEN
    RAISE EXCEPTION
      'staff_region() bozulmuş: teknik personelin maaş/avansı artık Bornova '
      'kasasından çıkmıyor olabilir. Bu migration ona dokunmamalıydı.';
  END IF;

  -- (c) KORUNMALI: tüm bölgelerdeki mülkleri görme bypass'ı duruyor mu?
  SELECT prosrc INTO _src FROM pg_proc WHERE proname = 'auth_sees_property';
  IF _src NOT LIKE '%TEKNIK_PERSONEL%' THEN
    RAISE EXCEPTION
      'auth_sees_property() bozulmuş: teknik personel artık tüm bölgeleri '
      'göremiyor olabilir.';
  END IF;

  -- (d) Üç yasak gerçekten kalktı mı?
  SELECT prosrc INTO _src FROM pg_proc WHERE proname = 'get_guest_decrypted';
  IF _src LIKE '%TEKNIK_PERSONEL%' THEN
    RAISE EXCEPTION 'get_guest_decrypted hâlâ teknik yasağını taşıyor.';
  END IF;

  SELECT prosrc INTO _src FROM pg_proc WHERE proname = 'get_companions_decrypted';
  IF _src LIKE '%TEKNIK_PERSONEL%' THEN
    RAISE EXCEPTION 'get_companions_decrypted hâlâ teknik yasağını taşıyor.';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'payment_collections_deny_teknik') THEN
    RAISE EXCEPTION 'Tahsilat yasağı trigger''ı hâlâ duruyor.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'payment_collections' AND policyname = 'payment_collections_select'
       AND qual LIKE '%TEKNIK_PERSONEL%'
  ) THEN
    RAISE EXCEPTION 'payment_collections_select hâlâ teknik yasağını taşıyor.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE tablename = 'housekeeping_tasks' AND policyname = 'hk_tasks_modify'
       AND (qual LIKE '%TEKNIK_PERSONEL%' OR with_check LIKE '%TEKNIK_PERSONEL%')
  ) THEN
    RAISE EXCEPTION 'hk_tasks_modify hâlâ teknik yasağını taşıyor.';
  END IF;

  RAISE NOTICE
    '139 OK — Teknik Personel = Personel (YETKILI). Bornova kasası ve tüm-bölge '
    'görünürlüğü korundu. ⚠ Frontend bu migration''dan SONRA deploy edilmeli.';
END;
$$;
