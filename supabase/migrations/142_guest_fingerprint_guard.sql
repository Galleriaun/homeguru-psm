-- =============================================================================
-- HomeGuru PMS — migration 142
-- Parmak izi kolonlarını doğrudan yazmaya karşı koru (140/141 denetim bulgusu).
-- =============================================================================
-- BULGU: guests_update politikası (028) SUPER_ADMIN / PROPERTY_MANAGER /
--   RECEPTION / YETKILI rollerine guests üzerinde DOĞRUDAN UPDATE verir ve
--   guests'te kolon bazlı grant YOKTUR. Yani elle hazırlanmış tek bir PostgREST
--   çağrısı `tc_kimlik_hash = null` yazabilir; parmak izi NULL olan satırı
--   create_guest'in ön kontrolü ARTIK BULAMAZ ve aynı TC ile ikinci bir misafir
--   normal yoldan açılabilir hâle gelir. Uygulama arayüzünden mümkün değildi,
--   ama sınır arayüzde değil veritabanında olmalı.
--
-- ⚠ ESKİ ÇİFTLER YERİNDE BIRAKILDIĞI İÇİN (140/141 başlık notu) DB seviyesinde
--   UNIQUE index henüz YOK — tekilliği yalnızca RPC ön kontrolü uyguluyor ve o
--   da parmak izi kolonunu okuyor. Yani bu trigger şu anda tek yedek değil,
--   kuralın bütünlüğünü koruyan ASIL şey; index eklendiğinde (143) ikinci bir
--   katman daha devreye girer.
--
-- KURAL (UPDATE): parmak izi yalnızca kendi şifreli alanıyla BİRLİKTE oynayabilir.
--   Bu, RPC'lerin zaten yaptığı şeyin aynen ifadesidir; yeni bir mekanizma,
--   bayrak ya da oturum durumu gerektirmez — bu yüzden meşru bir düzenlemeyi
--   yanlışlıkla reddetmesi yapısal olarak imkânsızdır:
--     • _tc_kimlik NULL (dokunma)     → ikisi de değişmez            → geçer
--     • yeni TC                        → ikisi de değişir             → geçer
--     • AYNI TC tekrar gönderilir      → şifreli metin DEĞİŞİR (pgp her seferinde
--                                        rastgele IV kullanır), hash sabit kalır
--                                        → "hash değişti" koşulu sağlanmaz → geçer
--     • TC temizlenir                  → ikisi de NULL olur           → geçer
--     • set_guest_problematic          → ikisine de dokunmaz          → geçer
--     • elle `hash = null` çağrısı     → hash değişti, şifreli metin aynı → RED
--
-- ⚠ `OLD.hash IS NOT NULL` koşulu KASITLIDIR ve 140/141'i yeniden
--   çalıştırılabilir tutan şeydir. O dosyaların backfill'i tam olarak
--   "şifreli metne dokunmadan hash yaz" işlemidir; bu koşul olmasaydı guard
--   kendi backfill'imizi reddederdi. Şöyle güvenlidir:
--     • ilk backfill:      OLD.hash NULL           → izin verilir
--     • tekrar çalıştırma: NEW.hash = OLD.hash     → "değişti" değil, izin verilir
--     • saldırı:           OLD.hash dolu → NULL    → reddedilir
--   140'ın rakamsız TC yüzünden hash'i NULL bıraktığı eski satırlar da bu
--   sayede ileride düzenlenebilir kalır.
--
-- KURAL (INSERT): TC şifreli metni varken parmak izi yoksa reddet. create_guest
--   ikisini de AYNI v_tc değerinden türetir ve ikisi de tam olarak v_tc NULL
--   iken NULL olur, dolayısıyla bu kural create_guest'i asla reddedemez.
--   Kapattığı yol: başka bir misafirin tc_kimlik_encrypted değerini okuyup
--   (guests_select şifreli kolonu gösterir) parmak izi NULL olacak şekilde yeni
--   bir satıra kopyalamak — bu, aynı TC'yi ön kontrole görünmeden ikinci kez
--   yazardı (ve 143 sonrası index'e de görünmezdi).
--
-- ⚠ PASAPORTA INSERT KURALI BİLEREK KONULMADI. Pasaportta şifreli metin
--   "yazıldığı gibi" (yalnızca btrim) saklanır, parmak izi ise harf/rakam dışını
--   atarak üretilir. Bu yüzden `---` gibi bir pasaport için şifreli metin DOLU,
--   parmak izi NULL olur — meşru bir durumdur ve simetrik bir kural onu
--   reddederdi. UPDATE kuralı pasaportta da geçerlidir (orada asimetri yok).
--
-- ARTIK KALAN AÇIK (bilerek, dürüstçe yazılıyor): şifreli metni de değiştiren
--   bir çağrı (ör. çöp veri + NULL hash) UPDATE kuralından geçer. Bunu kapatmak
--   trigger içinde şifre çözmeyi, yani her yazmada Vault anahtarını okumayı
--   gerektirirdi. Ayrıca böyle bir çağrı misafirin TC'sini görünür biçimde
--   bozar — sessiz bir atlatma değil, kendi kendini ele veren bir tahribattır.
--
-- 140 ve 141 uygulanmış olmalıdır.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Ön koşul.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'guests'
       AND column_name = 'tc_kimlik_hash'
  ) THEN
    RAISE EXCEPTION 'Once 140_guest_tc_unique.sql calistirilmali.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'guests'
       AND column_name = 'passport_hash'
  ) THEN
    RAISE EXCEPTION 'Once 141_guest_passport_unique.sql calistirilmali.';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. Guard.
-- -----------------------------------------------------------------------------
-- SECURITY INVOKER (varsayılan, açıkça yazıldı): trigger yalnızca NEW/OLD
-- okur, yükseltilmiş yetkiye ihtiyacı yoktur. Rolden bağımsız çalışır — RPC'ler
-- SECURITY DEFINER olsa da trigger'lar yine ateşlenir, bu yüzden yukarıdaki
-- "meşru yolu reddedemez" analizi RPC'ler için de geçerlidir.
--
-- ERRCODE 42501 (insufficient_privilege) BİLEREK seçildi: 23505 (unique_violation)
-- kullanılsaydı create_guest/update_guest içindeki `WHEN unique_violation`
-- yakalayıcıları bu hatayı yutup "bu TC zaten kayıtlı" gibi TAMAMEN YANLIŞ bir
-- mesaj gösterirdi.
CREATE OR REPLACE FUNCTION guests_fingerprint_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.tc_kimlik_encrypted IS NOT NULL AND NEW.tc_kimlik_hash IS NULL THEN
      RAISE EXCEPTION
        'TC kimlik yalnızca create_guest ile yazılabilir (parmak izi eksik).'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.tc_kimlik_hash IS NOT NULL
     AND NEW.tc_kimlik_hash IS DISTINCT FROM OLD.tc_kimlik_hash
     AND NEW.tc_kimlik_encrypted IS NOT DISTINCT FROM OLD.tc_kimlik_encrypted THEN
    RAISE EXCEPTION
      'TC parmak izi doğrudan değiştirilemez; TC güncellemesi update_guest ile yapılır.'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.passport_hash IS NOT NULL
     AND NEW.passport_hash IS DISTINCT FROM OLD.passport_hash
     AND NEW.passport_encrypted IS NOT DISTINCT FROM OLD.passport_encrypted THEN
    RAISE EXCEPTION
      'Pasaport parmak izi doğrudan değiştirilemez; pasaport güncellemesi update_guest ile yapılır.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guests_fingerprint_guard ON guests;
CREATE TRIGGER guests_fingerprint_guard
  BEFORE INSERT OR UPDATE ON guests
  FOR EACH ROW
  EXECUTE FUNCTION guests_fingerprint_guard();

-- -----------------------------------------------------------------------------
-- 2. Doğrulama.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_type smallint;
BEGIN
  SELECT t.tgtype INTO v_type
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
   WHERE c.relname = 'guests' AND t.tgname = 'guests_fingerprint_guard'
     AND NOT t.tgisinternal;

  IF v_type IS NULL THEN
    RAISE EXCEPTION 'guests_fingerprint_guard trigger yok';
  END IF;

  -- Bit maskesi: ROW(1) | BEFORE(2) | INSERT(4) | UPDATE(16) = 23.
  -- Sadece adin varligini sinamak yetmez — yanlis olayda kurulmus bir trigger
  -- sessizce hicbir sey korumaz.
  IF (v_type & 23) <> 23 THEN
    RAISE EXCEPTION
      'guests_fingerprint_guard yanlis kurulmus (tgtype=%); BEFORE INSERT OR UPDATE ... FOR EACH ROW olmali.',
      v_type;
  END IF;

  RAISE NOTICE 'Migration 142 tamam: parmak izi kolonlari dogrudan yazmaya kapali.';
END $$;
