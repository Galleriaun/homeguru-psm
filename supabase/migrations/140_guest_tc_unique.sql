-- =============================================================================
-- HomeGuru PMS — migration 140
-- Aynı TC kimlik numarası ile ikinci bir misafir oluşturulmasını engelle.
-- =============================================================================
-- İSTEK: yeni misafir oluşturulurken aynı TC kimlik numarası zaten varsa
-- oluşturma engellensin.
--
-- NEDEN BASİT BİR UNIQUE INDEX İŞE YARAMAZ:
--   tc_kimlik_encrypted, pgp_sym_encrypt (002/008) çıktısıdır. pgp_sym_encrypt
--   her çağrıda rastgele oturum anahtarı + IV kullanır, yani AYNI TC her
--   seferinde FARKLI bir bytea üretir. tc_kimlik_encrypted üzerine konacak bir
--   UNIQUE index hiçbir zaman çakışma görmez — özelliği sessizce ölü doğurur.
--
--   Karşılaştırmanın diğer yolu her satırı çözmektir; o da iki nedenle olmaz:
--   O(n) çözme maliyeti ve — daha kötüsü — decrypt_sensitive her çağrısında
--   audit_log'a bir DECRYPT satırı yazar (008:46). Tek bir misafir oluşturmak
--   yüzlerce sahte "erişim" kaydı üretirdi; KVKK denetim izi çöpe dönerdi.
--
-- ÇÖZÜM: deterministik, ANAHTARLI parmak izi kolonu (tc_kimlik_hash) + kısmi
--   UNIQUE index. Parmak izi HMAC-SHA256'dır, düz digest DEĞİLDİR:
--   TC kimlik 11 hanedir ve son iki hane sağlamadır → geçerli uzay ~10^9.
--   Düz sha256 olsaydı tüm geçerli TC'lerin gökkuşağı tablosu birkaç saatlik
--   iştir; şifreli kolon fiilen açık metne dönerdi. HMAC ile, Vault anahtarı
--   olmadan tabloyu ele geçiren biri hiçbir şey öğrenemez. Anahtar zaten
--   mevcut pms_encryption_key — yeni sır yönetmeye gerek yok ve ek bir maruziyet
--   de yok (o anahtara sahip olan zaten her şeyi çözebiliyor).
--
-- GÜNCELLEME YOLU DA KAPATILDI: yalnızca create_guest korunsaydı, kural
--   önemsizce delinirdi — B misafirini düzenleyip A'nın TC'sini yazmak yeterdi.
--   Tekillik bir kural olacaksa her yazma yolunda geçerli olmalı. UNIQUE index
--   zaten yoldan bağımsız mutlak sınırdır; RPC kontrolleri yalnızca hatayı
--   Türkçe ve anlaşılır yapar.
--
-- ⚠ ESKİ ÇİFT KAYITLAR OLDUĞU GİBİ BIRAKILIR (owner kararı 2026-08-22).
--   İlk denemede 100 grup / 225 kayıt çıktı; bunları elle birleştirmek büyük bir
--   iş ve kural bunu BEKLEMEK ZORUNDA DEĞİL. Bu dosya artık:
--     • çakışan kayıtları yalnızca RAPORLAR (NOTICE), durdurmaz
--     • UNIQUE index KURMAZ — tekillik yalnızca RPC ön kontrolüyle uygulanır
--   Sonuç: bugünden itibaren AYNI TC ile YENİ misafir açılamaz; mevcut çiftler
--   yerinde durur ve hiçbir şeyi bozmaz.
--
--   DB seviyesindeki UNIQUE index 143'e taşındı; veri temizlendiğinde o dosya
--   çalıştırılır. O gelene kadar eksik olan tek şey yarış koruması (aynı anda
--   iki istek) — asıl kullanım (personel aynı misafiri tekrar giriyor) tam
--   olarak korunuyor.
--
-- ⚠ ESKİ ÇİFTLERİN DÜZENLENEBİLİR KALMASI (bu yaklaşımın asıl tuzağı):
--   update_guest'in çakışma kontrolü "bu TC başkasında var mı" diye sorsaydı,
--   mevcut 225 kaydın HİÇBİRİ düzenlenemezdi — formu açıp Kaydet demek bile
--   kendi TC'sini geri gönderdiği için eşini bulup hata verirdi. O yüzden
--   kontrol yalnızca TC GERÇEKTEN DEĞİŞİYORSA çalışır: kendi TC'sini koruyan
--   bir kayıt, o TC zaten çift olsa bile serbestçe kaydedilir.
--
-- ⚠ BİLİNEN İŞ AKIŞI SONUCU (bölge izolasyonu ile kaçınılmaz etkileşim):
--   guests_select (103) bölge kısıtlı bir role, ancak o rolün görebildiği bir
--   rezervasyonu olan misafiri gösterir. Ana Grup'ta oluşturulmuş bir misafir
--   Bornova personeline GÖRÜNMEZ. Aynı kişi Bornova'ya gelirse personel onu
--   listede bulamaz, yeni kayıt açmayı dener ve bu kural onu ENGELLER — yani
--   ne mevcut kaydı seçebilir ne yenisini açabilir. Tekillik istendiği sürece
--   bu kaçınılmazdır; yapılabilecek şey hatayı anlaşılır kılmaktır, o yüzden
--   görünmeyen çakışmada mesaj "kayıt size görünmüyor, yöneticinizle iletişime
--   geçin" der. Kalıcı çözüm 103'ü gevşetmek olurdu — bu migration'ın işi değil.
--
-- KAPSAM DIŞI (bilerek): guest_companions.tc_kimlik_encrypted. Refakatçiler
--   ayrı bir tablo ve ayrı bir kavram; istek "misafir" içindi. Gerekirse ayrı
--   bir migration ile aynı desen uygulanır.
--
-- 137/138'e BAĞIMLI DEĞİLDİR — SMS migration'ları uygulanmamış olsa da çalışır.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. tc_fingerprint(text) — deterministik, anahtarlı parmak izi.
-- -----------------------------------------------------------------------------
-- Normalizasyon İÇERİDE yapılır: '123 456 789 01' ile '12345678901' aynı parmak
-- izini vermeli, yoksa boşluk/tire ile kural delinir. Tek bir yerde durduğu için
-- backfill, create_guest ve update_guest arasında sapma imkânsızdır.
--
-- STABLE (IMMUTABLE değil): vault tablosunu okur. İfade index'i olarak
-- KULLANILMAZ — değer kolona yazılır, o yüzden IMMUTABLE gerekmiyor.
CREATE OR REPLACE FUNCTION tc_fingerprint(plain text)
RETURNS bytea
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
DECLARE
  k      text;
  digits text;
BEGIN
  digits := NULLIF(regexp_replace(COALESCE(plain, ''), '\D', '', 'g'), '');
  IF digits IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO k FROM vault.decrypted_secrets
   WHERE name = 'pms_encryption_key';
  IF k IS NULL THEN
    RAISE EXCEPTION 'pms_encryption_key not configured in vault';
  END IF;

  RETURN hmac(digits, k, 'sha256');
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. Parmak izi kolonu.
-- -----------------------------------------------------------------------------
ALTER TABLE guests ADD COLUMN IF NOT EXISTS tc_kimlik_hash bytea;

COMMENT ON COLUMN guests.tc_kimlik_hash IS
  'TC kimlik numarasinin HMAC-SHA256 parmak izi (tc_fingerprint). Yalnizca '
  'tekillik kontrolu icindir; geri cevrilemez ve TC yerine kullanilamaz. '
  'tc_kimlik_encrypted ile HER ZAMAN ayni degeri tarif eder — ikisi birlikte '
  'yazilir (migration 140).';

-- -----------------------------------------------------------------------------
-- 3. Backfill — mevcut satırların parmak izini üret.
-- -----------------------------------------------------------------------------
-- decrypt_sensitive BİLEREK kullanılmıyor: her çağrısı audit_log'a DECRYPT
-- satırı yazar (008:46) ve bu toplu işlem gerçek bir erişim değil — tek bir
-- backfill KVKK denetim izini yüzlerce sahte "erişim" ile doldururdu.
--
-- Çözme işi geçici bir yardımcı fonksiyona alındı: `SET search_path = public,
-- vault, extensions` 008'de bu instance üzerinde kanıtlanmış yapılandırmadır
-- (pgcrypto `extensions` şemasındadır, `public` değil). DO bloğunun içinden
-- şema adı tahmin etmek yerine bilinen-çalışan yolu kullanıyoruz.
CREATE OR REPLACE FUNCTION _tc_backfill_fingerprint(cipher bytea)
RETURNS bytea
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
DECLARE
  k text;
BEGIN
  IF cipher IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT decrypted_secret INTO k FROM vault.decrypted_secrets
   WHERE name = 'pms_encryption_key';
  IF k IS NULL THEN
    RAISE EXCEPTION 'pms_encryption_key vault icinde tanimli degil — backfill yapilamaz';
  END IF;
  RETURN tc_fingerprint(pgp_sym_decrypt(cipher, k));
END;
$$;

-- Bu yardımcı bir şifre çözme yüzeyidir; ömrü kısa da olsa istemciye hiç açılmasın
-- (058 dersi: PUBLIC grant'ı otomatik verilir, `FROM public` şart).
REVOKE ALL ON FUNCTION _tc_backfill_fingerprint(bytea) FROM public, anon, authenticated;

DO $$
DECLARE
  n_total bigint;
  n_null  bigint;
BEGIN
  UPDATE guests
     SET tc_kimlik_hash = _tc_backfill_fingerprint(tc_kimlik_encrypted)
   WHERE tc_kimlik_encrypted IS NOT NULL;

  SELECT count(*) FILTER (WHERE tc_kimlik_encrypted IS NOT NULL),
         count(*) FILTER (WHERE tc_kimlik_encrypted IS NOT NULL
                            AND tc_kimlik_hash IS NULL)
    INTO n_total, n_null
  FROM guests;

  RAISE NOTICE 'Backfill: TC tasiyan % misafir kaydi islendi.', n_total;
  IF n_null > 0 THEN
    -- Rakam icermeyen (bozuk) bir TC saklanmis demektir. Zararsiz ama gorunur olsun.
    RAISE NOTICE 'Dikkat: % kayitta TC cozuldu ama rakam icermiyor; parmak izi NULL birakildi.', n_null;
  END IF;
END $$;

-- Yardımcı yalnızca backfill içindi; kalıcı bir "şifreyi çöz" yüzeyi bırakmıyoruz.
DROP FUNCTION IF EXISTS _tc_backfill_fingerprint(bytea);

-- -----------------------------------------------------------------------------
-- 4. Mevcut çift kayıtları RAPORLA (durdurma).
-- -----------------------------------------------------------------------------
-- Eskiden burada RAISE EXCEPTION vardı ve migration'ı durduruyordu. Owner
-- kararı: eski çiftler olduğu gibi kalsın, kural yalnızca yeni kayıtlara
-- uygulansın. O yüzden sadece kaç grup olduğunu bildiriyoruz. Ayrıntılı liste
-- için SETUP.md'deki triage sorgusu kullanılır. Sayı burada da TC numarası
-- YAZDIRILMADAN verilir (KVKK).
DO $$
DECLARE
  n_group bigint;
  n_row   bigint;
BEGIN
  SELECT count(*), COALESCE(sum(c), 0) INTO n_group, n_row
  FROM (
    SELECT count(*) AS c
    FROM guests
    WHERE tc_kimlik_hash IS NOT NULL
    GROUP BY tc_kimlik_hash
    HAVING count(*) > 1
  ) d;

  IF n_group > 0 THEN
    RAISE NOTICE 'Bilgi: ayni TC tasiyan % grup / % mevcut kayit var. Bunlar OLDUGU GIBI birakiliyor; kural yalnizca yeni kayitlara uygulanir. Temizlik sonrasi 143 ile DB seviyesinde UNIQUE index kurulabilir.', n_group, n_row;
  ELSE
    RAISE NOTICE 'Mevcut veride ayni TC tasiyan kayit yok — 143 (UNIQUE index) simdi calistirilabilir.';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 5. Arama index'i (UNIQUE DEĞİL).
-- -----------------------------------------------------------------------------
-- UNIQUE index 143'e taşındı (yukarıdaki başlık notuna bakın). Buradaki index
-- yalnızca performans içindir: create_guest/update_guest her çağrıda
-- `WHERE tc_kimlik_hash = ...` sorguluyor; index olmasaydı her misafir
-- kaydında guests üzerinde seq scan olurdu.
--
-- Kısmi (WHERE ... IS NOT NULL): TC'si olmayan misafirler (pasaportlu yabancı
-- misafirler) index'e hiç girmez, index küçük kalır.
CREATE INDEX IF NOT EXISTS guests_tc_kimlik_hash_idx
  ON guests (tc_kimlik_hash)
  WHERE tc_kimlik_hash IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 6. auth_sees_guest(uuid) — hata mesajında ismi vermeye izin var mı?
-- -----------------------------------------------------------------------------
-- "Bu TC zaten kayıtlı: Ahmet Yılmaz" mesajı, çağıranın göremediği bir misafirin
-- adını sızdırabilir (103 tam da bunu izole ediyor: Bornova rolü yalnızca
-- Bornova misafirini görür). O yüzden ismi YALNIZCA çağıran o misafiri zaten
-- görebiliyorsa yazıyoruz; aksi hâlde genel mesaj.
--
-- ⚠ guests_select (migration 103) politikasının AYNADIR — o politika değişirse
--   burası da güncellenmeli. Çağıran RPC'ler SECURITY DEFINER olduğu için RLS
--   devrede değil, yüklemi elle tekrarlamaktan başka yol yok.
CREATE OR REPLACE FUNCTION auth_sees_guest(p_guest_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    auth_role() = 'SUPER_ADMIN'
    OR (auth_role() IN ('PROPERTY_MANAGER', 'RECEPTION') AND auth_region() IS NULL)
    OR EXISTS (
      SELECT 1 FROM reservations r
      WHERE r.guest_id = p_guest_id
        AND auth_sees_property(r.property_id)
    );
$$;

-- -----------------------------------------------------------------------------
-- 7. create_guest — 074'ten (EN GÜNCEL tanım) birebir; eklenen: normalizasyon,
--    parmak izi, ön kontrol ve yarış durumu için unique_violation yakalama.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_guest(
  _full_name        text,
  _tc_kimlik        text DEFAULT NULL,
  _passport         text DEFAULT NULL,
  _phone            text DEFAULT NULL,
  _email            text DEFAULT NULL,
  _address          text DEFAULT NULL,
  _nationality      text DEFAULT NULL,
  _is_problematic   boolean DEFAULT false,
  _problematic_note text DEFAULT NULL
) RETURNS guests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result       guests;
  caller_role  text;
  v_tc         text;
  v_hash       bytea;
  v_dup_id     uuid;
  v_dup_name   text;
  v_constraint text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Oturum bulunamadı';
  END IF;
  SELECT role INTO caller_role FROM staff_profiles
    WHERE user_id = auth.uid() AND deleted_at IS NULL;
  IF caller_role IS NULL OR caller_role = 'PENDING' THEN
    RAISE EXCEPTION 'Misafir oluşturma yetkisi yok';
  END IF;

  -- Bir kez normalize et, AYNI değeri hem şifrele hem parmak izini al —
  -- ayrı ayrı türetilseler ciphertext ile hash farklı metni tarif edebilirdi.
  v_tc   := NULLIF(regexp_replace(COALESCE(_tc_kimlik, ''), '\D', '', 'g'), '');
  v_hash := tc_fingerprint(v_tc);

  IF v_hash IS NOT NULL THEN
    SELECT g.id, g.full_name INTO v_dup_id, v_dup_name
      FROM guests g
     WHERE g.tc_kimlik_hash = v_hash
     LIMIT 1;

    IF v_dup_id IS NOT NULL THEN
      IF auth_sees_guest(v_dup_id) THEN
        RAISE EXCEPTION
          'Bu TC kimlik numarası zaten kayıtlı: %. Aynı TC ile ikinci misafir oluşturulamaz — mevcut misafiri kullanın.',
          v_dup_name;
      ELSE
        -- Çağıran o misafiri göremiyor (103: bölge izolasyonu). İsmi vermiyoruz
        -- ama "neden" ve "ne yapmalı" olmadan bu mesaj hata gibi okunur.
        RAISE EXCEPTION
          'Bu TC kimlik numarası sistemde zaten kayıtlı, ancak kayıt size görünmüyor (başka bir bölgede oluşturulmuş olabilir). Aynı TC ile ikinci misafir oluşturulamaz — yöneticinizle iletişime geçin.';
      END IF;
    END IF;
  END IF;

  INSERT INTO guests (
    full_name, tc_kimlik_encrypted, tc_kimlik_hash, passport_encrypted,
    phone, email, address, nationality,
    is_problematic, problematic_note, created_by
  ) VALUES (
    _full_name,
    encrypt_sensitive(v_tc),
    v_hash,
    encrypt_sensitive(_passport),
    _phone, _email, _address, _nationality,
    COALESCE(_is_problematic, false),
    NULLIF(btrim(COALESCE(_problematic_note, '')), ''),
    auth.uid()
  )
  RETURNING * INTO result;

  RETURN result;

EXCEPTION
  -- Yarış durumu: iki eşzamanlı istek ön kontrolü birlikte geçebilir, index
  -- birini keser. Ham Postgres hatası yerine aynı Türkçe mesajı ver.
  WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint = 'guests_tc_kimlik_unique' THEN
      RAISE EXCEPTION
        'Bu TC kimlik numarası sistemde zaten kayıtlı. Aynı TC ile ikinci misafir oluşturulamaz.';
    END IF;
    RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION
  create_guest(text, text, text, text, text, text, text, boolean, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 8. update_guest — 065'ten (EN GÜNCEL tanım) birebir; aynı eklemeler.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_guest(
  _id               uuid,
  _full_name        text,
  _tc_kimlik        text DEFAULT NULL,
  _passport         text DEFAULT NULL,
  _phone            text DEFAULT NULL,
  _email            text DEFAULT NULL,
  _address          text DEFAULT NULL,
  _nationality      text DEFAULT NULL,
  _is_problematic   boolean DEFAULT false,
  _problematic_note text DEFAULT NULL
) RETURNS guests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result       guests;
  caller_role  text;
  v_tc         text;
  v_hash       bytea;
  v_own_hash   bytea;   -- satırın ŞU ANKİ TC parmak izi
  v_dup_id     uuid;
  v_dup_name   text;
  v_constraint text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Oturum bulunamadı';
  END IF;
  SELECT role INTO caller_role FROM staff_profiles
    WHERE user_id = auth.uid() AND deleted_at IS NULL;
  IF caller_role IS NULL OR caller_role = 'PENDING' THEN
    RAISE EXCEPTION 'Misafir güncelleme yetkisi yok';
  END IF;

  -- Scope check (5): YETKILI / HOUSEKEEPING must be able to see at least
  -- one reservation for this guest in their access scope. SUPER_ADMIN +
  -- PROPERTY_MANAGER + RECEPTION have blanket guest access per the
  -- guests_select policy (migration 032 line 58–68), so they skip.
  IF caller_role NOT IN ('SUPER_ADMIN', 'PROPERTY_MANAGER', 'RECEPTION') THEN
    IF NOT EXISTS (
      SELECT 1 FROM reservations r
      WHERE r.guest_id = _id AND auth_sees_property(r.property_id)
    ) THEN
      RAISE EXCEPTION 'Bu misafire erişim yetkiniz yok';
    END IF;
  END IF;

  v_tc   := NULLIF(regexp_replace(COALESCE(_tc_kimlik, ''), '\D', '', 'g'), '');
  v_hash := tc_fingerprint(v_tc);

  SELECT g.tc_kimlik_hash INTO v_own_hash FROM guests g WHERE g.id = _id;

  -- _tc_kimlik NULL = "dokunma" (065 davranışı). Yalnızca gerçekten TC
  -- yazılıyorsa çakışma kontrolü yap; kendi satırını hariç tut.
  --
  -- ⚠ `v_hash IS DISTINCT FROM v_own_hash` ŞART: eski çift kayıtlar yerinde
  --   bırakıldığı için (başlık notu), bu koşul olmasa o 225 kaydın hiçbiri
  --   düzenlenemezdi — düzenleme formu kendi TC'sini geri gönderiyor, kontrol
  --   de eşini bulup hata veriyor olurdu. TC gerçekten DEĞİŞMEDİKÇE çakışma
  --   aranmaz; yani "kendi TC'sini koru" her zaman serbest, "başkasının TC'sine
  --   geç" her zaman yasak.
  IF _tc_kimlik IS NOT NULL
     AND v_hash IS NOT NULL
     AND v_hash IS DISTINCT FROM v_own_hash THEN
    SELECT g.id, g.full_name INTO v_dup_id, v_dup_name
      FROM guests g
     WHERE g.tc_kimlik_hash = v_hash
       AND g.id <> _id
     LIMIT 1;

    IF v_dup_id IS NOT NULL THEN
      IF auth_sees_guest(v_dup_id) THEN
        RAISE EXCEPTION
          'Bu TC kimlik numarası başka bir misafire ait: %. Aynı TC iki misafirde birden olamaz.',
          v_dup_name;
      ELSE
        RAISE EXCEPTION
          'Bu TC kimlik numarası sistemde başka bir misafire ait, ancak o kayıt size görünmüyor (başka bir bölgede olabilir). Aynı TC iki misafirde birden olamaz — yöneticinizle iletişime geçin.';
      END IF;
    END IF;
  END IF;

  UPDATE guests SET
    full_name = _full_name,
    -- Preserve encrypted fields when caller passes NULL. Passing '' still
    -- clears (encrypt_sensitive('') = NULL) so the explicit clear path works.
    -- ⚠ Parmak izi ciphertext ile AYNI koşula bağlı olmalı — ikisi ayrışırsa
    --    hash yanlış TC'yi tarif eder ve tekillik sessizce bozulur.
    tc_kimlik_encrypted =
      CASE WHEN _tc_kimlik IS NULL THEN tc_kimlik_encrypted
           ELSE encrypt_sensitive(v_tc) END,
    tc_kimlik_hash =
      CASE WHEN _tc_kimlik IS NULL THEN tc_kimlik_hash
           ELSE v_hash END,
    passport_encrypted =
      CASE WHEN _passport IS NULL THEN passport_encrypted
           ELSE encrypt_sensitive(_passport) END,
    phone = _phone,
    email = _email,
    address = _address,
    nationality = _nationality,
    is_problematic = COALESCE(_is_problematic, false),
    problematic_note = NULLIF(btrim(COALESCE(_problematic_note, '')), '')
  WHERE id = _id
  RETURNING * INTO result;

  IF result.id IS NULL THEN
    RAISE EXCEPTION 'Misafir bulunamadı';
  END IF;

  RETURN result;

EXCEPTION
  WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint = 'guests_tc_kimlik_unique' THEN
      RAISE EXCEPTION
        'Bu TC kimlik numarası sistemde başka bir misafire ait. Aynı TC iki misafirde birden olamaz.';
    END IF;
    RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION
  update_guest(uuid, text, text, text, text, text, text, text, boolean, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 9. Yetkiler — 058 dersi: `FROM anon, authenticated` TEK BAŞINA hiçbir şey
--    kapatmaz, PostgreSQL yeni fonksiyonlara EXECUTE'u PUBLIC'e verir ve
--    authenticated de PUBLIC üyesidir. `FROM public` ŞART.
-- -----------------------------------------------------------------------------
-- tc_fingerprint istemciye AÇIK OLMAMALI: açık olsaydı herhangi bir kullanıcı
-- istediği TC'nin parmak izini üretip guests tablosunda arayabilir, yani
-- "bu TC sistemde kayıtlı mı?" sorusuna sınırsız cevap alan bir oracle olurdu.
-- Çağıran RPC'ler SECURITY DEFINER olduğu için bu revoke onları etkilemez.
REVOKE ALL ON FUNCTION tc_fingerprint(text)     FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION auth_sees_guest(uuid)    FROM public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 10. Doğrulama — sessiz başarısızlık olmasın.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  a bytea;
  b bytea;
  c bytea;
BEGIN
  -- Kolon + index gerçekten var mı, ve index UNIQUE mi?
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'guests'
       AND column_name = 'tc_kimlik_hash'
  ) THEN
    RAISE EXCEPTION 'guests.tc_kimlik_hash kolonu yok';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'guests_tc_kimlik_hash_idx'
  ) THEN
    RAISE EXCEPTION 'guests_tc_kimlik_hash_idx arama index i yok';
  END IF;

  -- Determinizm + normalizasyon: ayni TC ayni parmak izini vermeli.
  a := tc_fingerprint('12345678901');
  b := tc_fingerprint('  123 456-789 01  ');
  c := tc_fingerprint('12345678902');

  IF a IS NULL OR a <> b THEN
    RAISE EXCEPTION 'tc_fingerprint deterministik/normalize degil — tekillik calismaz';
  END IF;
  IF a = c THEN
    RAISE EXCEPTION 'tc_fingerprint farkli TC icin ayni degeri uretti';
  END IF;
  IF tc_fingerprint(NULL) IS NOT NULL
     OR tc_fingerprint('') IS NOT NULL
     OR tc_fingerprint('abc') IS NOT NULL THEN
    RAISE EXCEPTION 'tc_fingerprint bos/rakamsiz girdide NULL dondurmuyor';
  END IF;

  -- Oracle kapali mi? (058 dersi)
  IF has_function_privilege('authenticated', 'tc_fingerprint(text)', 'EXECUTE')
     OR has_function_privilege('anon', 'tc_fingerprint(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'tc_fingerprint hala istemciye acik — REVOKE ... FROM public gerekli';
  END IF;

  -- RPC'ler istemciye acik KALMALI.
  IF NOT has_function_privilege('authenticated',
        'create_guest(text, text, text, text, text, text, text, boolean, text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated',
        'update_guest(uuid, text, text, text, text, text, text, text, boolean, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'create_guest/update_guest authenticated icin calistirilabilir degil';
  END IF;

  RAISE NOTICE 'Migration 140 tamam: TC tekillik kurali aktif.';
END $$;
