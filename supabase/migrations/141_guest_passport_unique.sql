-- =============================================================================
-- HomeGuru PMS — migration 141
-- Aynı pasaport numarası ile ikinci bir misafir oluşturulmasını engelle.
-- =============================================================================
-- 140'ın TC için kurduğu deseni pasaporta uygular: anahtarlı parmak izi kolonu
-- (passport_hash) + kısmi UNIQUE index + create_guest/update_guest ön kontrolü.
-- Gerekçeler 140'ta ayrıntılı yazıldı (pgp_sym_encrypt deterministik değildir;
-- decrypt_sensitive her çağrıda audit_log yazar; düz digest kırılabilir).
--
-- ⚠ 140'TAN SONRA ÇALIŞTIRILMALIDIR. Bu dosya create_guest/update_guest'i
--   140'taki gövdelerin ÜSTÜNE yazar; 140 uygulanmadan çalıştırılırsa TC
--   kontrolü sessizce kaybolurdu. Bu yüzden en başta bir ön koşul kontrolü var
--   ve 140 yoksa hiçbir şey uygulanmadan durur.
--
-- ⚠ PASAPORT NUMARALARI TC GİBİ KÜRESEL TEKİL DEĞİLDİR.
--   TC kimlik tanım gereği tek bir kişiye aittir. Pasaport numarası ise
--   YALNIZCA VEREN ÜLKE İÇİNDE tekildir — farklı ülkeler pekâlâ aynı numarayı
--   verebilir. Yani bu kural teoride iki FARKLI yabancı misafiri yanlışlıkla
--   çakıştırabilir.
--
--   Neden yine de ülke bazlı yapılmadı: elimizdeki tek ülke bilgisi
--   guests.nationality ve o serbest metin ("Türkiye" / "Turkey" / "TR" hepsi
--   yazılabiliyor). Tekillik ona bağlansaydı aynı kişi farklı yazımlarla iki
--   kez girilebilir, yani kural asıl işini yapamazdı. Küresel tekillik daha
--   sıkıdır ve yanlış eşleşme hâlinde personel anlaşılır bir mesaj görür.
--
--   Yanlış pozitif olursa: gerçekten farklı iki kişi ise pasaport alanı boş
--   bırakılıp kayıt açılabilir (boş pasaport hiçbir zaman engellenmez).
--
-- ⚠ 140 ile AYNI YAKLAŞIM: eski çift kayıtlar olduğu gibi bırakılır. Bu dosya
--   çakışmaları yalnızca raporlar, UNIQUE index kurmaz (o 143'te), ve
--   update_guest kontrolü yalnızca pasaport GERÇEKTEN DEĞİŞİYORSA çalışır —
--   aksi hâlde mevcut çift kayıtlar hiç düzenlenemezdi.
--
-- KAPSAM DIŞI (140 ile aynı): guest_companions.passport_encrypted.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Ön koşul — 140 uygulanmış mı?
-- -----------------------------------------------------------------------------
-- 140'ın HER PARÇASI aranır, yalnızca kolon değil. 140 içinde kolon 2. adımda,
-- auth_sees_guest ise 6. adımda yaratılır; dosya parça parça çalıştırılıp
-- ortada kesilmiş olsaydı kolon var / fonksiyon yok durumu oluşur ve buradaki
-- kontrol geçerdi — ama 141'in yazdığı create_guest çalışma anında
-- auth_sees_guest'i çağırdığı için misafir oluşturma tamamen kırılırdı.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'guests'
       AND column_name = 'tc_kimlik_hash'
  ) THEN
    RAISE EXCEPTION
      'Once 140_guest_tc_unique.sql calistirilmali (guests.tc_kimlik_hash kolonu yok).';
  END IF;

  IF to_regprocedure('public.tc_fingerprint(text)') IS NULL THEN
    RAISE EXCEPTION
      '140 eksik uygulanmis: tc_fingerprint(text) yok. 140_guest_tc_unique.sql dosyasini bastan calistirin.';
  END IF;

  IF to_regprocedure('public.auth_sees_guest(uuid)') IS NULL THEN
    RAISE EXCEPTION
      '140 eksik uygulanmis: auth_sees_guest(uuid) yok. 140_guest_tc_unique.sql dosyasini bastan calistirin.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'guests_tc_kimlik_hash_idx'
  ) THEN
    RAISE EXCEPTION
      '140 eksik uygulanmis: guests_tc_kimlik_hash_idx yok. 140_guest_tc_unique.sql dosyasini bastan calistirin.';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. passport_fingerprint(text) — deterministik, anahtarlı parmak izi.
-- -----------------------------------------------------------------------------
-- NORMALİZASYON TC'DEN FARKLI: pasaport alfanümeriktir. Harf/rakam dışındaki
-- her şey atılır (yapıştırılan boşluk, tire) ve harfler BÜYÜĞE çevrilir, yani
-- "u 12-345678" ile "U12345678" aynı sayılır.
--
-- ⚠ upper() KULLANILMIYOR — BİLEREK. upper() collation'a bağlıdır ve Türkçe
--   locale'de upper('i') = 'İ' üretir (noktalı büyük I). O zaman 'i' ile 'I'
--   yazılmış AYNI pasaport iki farklı parmak izi verir ve eşleşme sessizce
--   bozulur. translate() ile ASCII a-z → A-Z tamamen locale'den bağımsızdır.
--   (Aynı disiplin: 138'de _sms_money'nin IMMUTABLE değil STABLE olması.)
--
-- ⚠ Alan ayırıcı ('passport:' öneki): TC ile pasaportun parmak izleri aynı
--   anahtarı kullanır. Önek olmasaydı aynı metin iki alanda aynı hash'i verirdi.
--   Kolonlar ayrı olduğu için bugün zararsız, ama ileride karşılaştırılırlarsa
--   sessiz bir hata olurdu — şimdi ayırmak bedava.
CREATE OR REPLACE FUNCTION passport_fingerprint(plain text)
RETURNS bytea
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
DECLARE
  k     text;
  clean text;
BEGIN
  clean := NULLIF(
             translate(
               regexp_replace(COALESCE(plain, ''), '[^A-Za-z0-9]', '', 'g'),
               'abcdefghijklmnopqrstuvwxyz',
               'ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
             '');
  IF clean IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO k FROM vault.decrypted_secrets
   WHERE name = 'pms_encryption_key';
  IF k IS NULL THEN
    RAISE EXCEPTION 'pms_encryption_key not configured in vault';
  END IF;

  RETURN hmac('passport:' || clean, k, 'sha256');
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. Parmak izi kolonu.
-- -----------------------------------------------------------------------------
ALTER TABLE guests ADD COLUMN IF NOT EXISTS passport_hash bytea;

COMMENT ON COLUMN guests.passport_hash IS
  'Pasaport numarasinin HMAC-SHA256 parmak izi (passport_fingerprint). Yalnizca '
  'tekillik kontrolu icindir; geri cevrilemez. passport_encrypted ile HER ZAMAN '
  'ayni degeri tarif eder — ikisi birlikte yazilir (migration 141).';

-- -----------------------------------------------------------------------------
-- 3. Backfill — 140'taki desenin aynısı (geçici yardımcı, sonra düşürülür).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _pp_backfill_fingerprint(cipher bytea)
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
  RETURN passport_fingerprint(pgp_sym_decrypt(cipher, k));
END;
$$;

REVOKE ALL ON FUNCTION _pp_backfill_fingerprint(bytea) FROM public, anon, authenticated;

DO $$
DECLARE
  n_total bigint;
  n_null  bigint;
BEGIN
  UPDATE guests
     SET passport_hash = _pp_backfill_fingerprint(passport_encrypted)
   WHERE passport_encrypted IS NOT NULL;

  SELECT count(*) FILTER (WHERE passport_encrypted IS NOT NULL),
         count(*) FILTER (WHERE passport_encrypted IS NOT NULL
                            AND passport_hash IS NULL)
    INTO n_total, n_null
  FROM guests;

  RAISE NOTICE 'Backfill: pasaport tasiyan % misafir kaydi islendi.', n_total;
  IF n_null > 0 THEN
    RAISE NOTICE 'Dikkat: % kayitta pasaport cozuldu ama harf/rakam icermiyor; parmak izi NULL birakildi.', n_null;
  END IF;
END $$;

DROP FUNCTION IF EXISTS _pp_backfill_fingerprint(bytea);

-- -----------------------------------------------------------------------------
-- 4. Mevcut çift kayıtları RAPORLA (durdurma) — 140 ile aynı gerekçe.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  n_group bigint;
  n_row   bigint;
BEGIN
  SELECT count(*), COALESCE(sum(c), 0) INTO n_group, n_row
  FROM (
    SELECT count(*) AS c
    FROM guests
    WHERE passport_hash IS NOT NULL
    GROUP BY passport_hash
    HAVING count(*) > 1
  ) d;

  IF n_group > 0 THEN
    RAISE NOTICE 'Bilgi: ayni pasaport tasiyan % grup / % mevcut kayit var. Oldugu gibi birakiliyor; kural yalnizca yeni kayitlara uygulanir.', n_group, n_row;
  ELSE
    RAISE NOTICE 'Mevcut veride ayni pasaport tasiyan kayit yok.';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 5. Arama index'i (UNIQUE DEĞİL — o 143'te).
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS guests_passport_hash_idx
  ON guests (passport_hash)
  WHERE passport_hash IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 6. create_guest — 140'tan (EN GÜNCEL tanım) birebir; eklenen tek şey pasaport
--    normalizasyonu + parmak izi + ön kontrol. TC bloğuna DOKUNULMADI.
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
  v_hash       bytea;   -- TC parmak izi (140)
  v_pp         text;    -- normalize pasaport (141)
  v_pp_hash    bytea;   -- pasaport parmak izi (141)
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
  v_tc      := NULLIF(regexp_replace(COALESCE(_tc_kimlik, ''), '\D', '', 'g'), '');
  v_hash    := tc_fingerprint(v_tc);
  v_pp      := NULLIF(btrim(COALESCE(_passport, '')), '');
  v_pp_hash := passport_fingerprint(v_pp);

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

  IF v_pp_hash IS NOT NULL THEN
    SELECT g.id, g.full_name INTO v_dup_id, v_dup_name
      FROM guests g
     WHERE g.passport_hash = v_pp_hash
     LIMIT 1;

    IF v_dup_id IS NOT NULL THEN
      IF auth_sees_guest(v_dup_id) THEN
        RAISE EXCEPTION
          'Bu pasaport numarası zaten kayıtlı: %. Aynı pasaport ile ikinci misafir oluşturulamaz — mevcut misafiri kullanın.',
          v_dup_name;
      ELSE
        RAISE EXCEPTION
          'Bu pasaport numarası sistemde zaten kayıtlı, ancak kayıt size görünmüyor (başka bir bölgede oluşturulmuş olabilir). Aynı pasaport ile ikinci misafir oluşturulamaz — yöneticinizle iletişime geçin.';
      END IF;
    END IF;
  END IF;

  INSERT INTO guests (
    full_name, tc_kimlik_encrypted, tc_kimlik_hash,
    passport_encrypted, passport_hash,
    phone, email, address, nationality,
    is_problematic, problematic_note, created_by
  ) VALUES (
    _full_name,
    encrypt_sensitive(v_tc),
    v_hash,
    encrypt_sensitive(v_pp),
    v_pp_hash,
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
    ELSIF v_constraint = 'guests_passport_unique' THEN
      RAISE EXCEPTION
        'Bu pasaport numarası sistemde zaten kayıtlı. Aynı pasaport ile ikinci misafir oluşturulamaz.';
    END IF;
    RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION
  create_guest(text, text, text, text, text, text, text, boolean, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 7. update_guest — 140'tan birebir; aynı ekleme.
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
  v_hash       bytea;   -- TC parmak izi (140)
  v_pp         text;    -- normalize pasaport (141)
  v_pp_hash    bytea;   -- pasaport parmak izi (141)
  v_own_hash   bytea;   -- satırın ŞU ANKİ TC parmak izi
  v_own_pp     bytea;   -- satırın ŞU ANKİ pasaport parmak izi
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

  v_tc      := NULLIF(regexp_replace(COALESCE(_tc_kimlik, ''), '\D', '', 'g'), '');
  v_hash    := tc_fingerprint(v_tc);
  v_pp      := NULLIF(btrim(COALESCE(_passport, '')), '');
  v_pp_hash := passport_fingerprint(v_pp);

  SELECT g.tc_kimlik_hash, g.passport_hash INTO v_own_hash, v_own_pp
    FROM guests g WHERE g.id = _id;

  -- _tc_kimlik NULL = "dokunma" (065 davranışı). Yalnızca gerçekten TC
  -- yazılıyorsa çakışma kontrolü yap; kendi satırını hariç tut.
  --
  -- ⚠ `IS DISTINCT FROM v_own_hash` ŞART: eski çift kayıtlar yerinde
  --   bırakıldığı için bu koşul olmasa o kayıtların hiçbiri düzenlenemezdi
  --   (form kendi TC'sini geri gönderir, kontrol eşini bulup hata verirdi).
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

  -- Pasaport için aynı kural: _passport NULL = dokunma, ve yalnızca pasaport
  -- gerçekten değişiyorsa çakışma aranır (yukarıdaki aynı gerekçe).
  IF _passport IS NOT NULL
     AND v_pp_hash IS NOT NULL
     AND v_pp_hash IS DISTINCT FROM v_own_pp THEN
    SELECT g.id, g.full_name INTO v_dup_id, v_dup_name
      FROM guests g
     WHERE g.passport_hash = v_pp_hash
       AND g.id <> _id
     LIMIT 1;

    IF v_dup_id IS NOT NULL THEN
      IF auth_sees_guest(v_dup_id) THEN
        RAISE EXCEPTION
          'Bu pasaport numarası başka bir misafire ait: %. Aynı pasaport iki misafirde birden olamaz.',
          v_dup_name;
      ELSE
        RAISE EXCEPTION
          'Bu pasaport numarası sistemde başka bir misafire ait, ancak o kayıt size görünmüyor (başka bir bölgede olabilir). Aynı pasaport iki misafirde birden olamaz — yöneticinizle iletişime geçin.';
      END IF;
    END IF;
  END IF;

  UPDATE guests SET
    full_name = _full_name,
    -- Preserve encrypted fields when caller passes NULL. Passing '' still
    -- clears (encrypt_sensitive('') = NULL) so the explicit clear path works.
    -- ⚠ Parmak izi ciphertext ile AYNI koşula bağlı olmalı — ikisi ayrışırsa
    --    hash yanlış değeri tarif eder ve tekillik sessizce bozulur.
    tc_kimlik_encrypted =
      CASE WHEN _tc_kimlik IS NULL THEN tc_kimlik_encrypted
           ELSE encrypt_sensitive(v_tc) END,
    tc_kimlik_hash =
      CASE WHEN _tc_kimlik IS NULL THEN tc_kimlik_hash
           ELSE v_hash END,
    passport_encrypted =
      CASE WHEN _passport IS NULL THEN passport_encrypted
           ELSE encrypt_sensitive(v_pp) END,
    passport_hash =
      CASE WHEN _passport IS NULL THEN passport_hash
           ELSE v_pp_hash END,
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
    ELSIF v_constraint = 'guests_passport_unique' THEN
      RAISE EXCEPTION
        'Bu pasaport numarası sistemde başka bir misafire ait. Aynı pasaport iki misafirde birden olamaz.';
    END IF;
    RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION
  update_guest(uuid, text, text, text, text, text, text, text, boolean, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 8. Yetkiler — 058 dersi: `FROM public` olmadan hiçbir şey kapanmaz.
-- -----------------------------------------------------------------------------
-- passport_fingerprint istemciye açık olsaydı "bu pasaport sistemde var mı?"
-- sorusuna sınırsız cevap veren bir oracle olurdu.
REVOKE ALL ON FUNCTION passport_fingerprint(text) FROM public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 9. Doğrulama.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  a bytea;
  b bytea;
  c bytea;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'guests'
       AND column_name = 'passport_hash'
  ) THEN
    RAISE EXCEPTION 'guests.passport_hash kolonu yok';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'guests_passport_hash_idx'
  ) THEN
    RAISE EXCEPTION 'guests_passport_hash_idx arama index i yok';
  END IF;

  -- 140'in TC tarafi hala duruyor mu? (Bu dosya ayni fonksiyonlari yeniden
  -- yazdigi icin, TC tarafinin bozulmadigini acikca dogruluyoruz.)
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'guests_tc_kimlik_hash_idx'
  ) THEN
    RAISE EXCEPTION '140 TC index kaybolmus';
  END IF;

  -- Determinizm + normalizasyon (buyuk/kucuk harf, tire, bosluk).
  a := passport_fingerprint('U12345678');
  b := passport_fingerprint('  u12-345 678 ');
  c := passport_fingerprint('U12345679');

  IF a IS NULL OR a <> b THEN
    RAISE EXCEPTION 'passport_fingerprint deterministik/normalize degil — tekillik calismaz';
  END IF;
  IF a = c THEN
    RAISE EXCEPTION 'passport_fingerprint farkli pasaport icin ayni degeri uretti';
  END IF;
  IF passport_fingerprint(NULL) IS NOT NULL
     OR passport_fingerprint('') IS NOT NULL
     OR passport_fingerprint('---') IS NOT NULL THEN
    RAISE EXCEPTION 'passport_fingerprint bos girdide NULL dondurmuyor';
  END IF;

  -- Turkce locale tuzagi: 'i' iceren pasaport buyuk/kucuk yazilinca eslesmeli.
  IF passport_fingerprint('i123') <> passport_fingerprint('I123') THEN
    RAISE EXCEPTION 'passport_fingerprint locale bagimli (i/I eslesmiyor) — translate() bozulmus';
  END IF;

  -- Alan ayirici: ayni metin TC ve pasaportta ayni hash'i vermemeli.
  IF passport_fingerprint('12345678901') = tc_fingerprint('12345678901') THEN
    RAISE EXCEPTION 'alan ayirici yok — TC ve pasaport parmak izleri cakisiyor';
  END IF;

  IF has_function_privilege('authenticated', 'passport_fingerprint(text)', 'EXECUTE')
     OR has_function_privilege('anon', 'passport_fingerprint(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'passport_fingerprint hala istemciye acik — REVOKE ... FROM public gerekli';
  END IF;

  IF NOT has_function_privilege('authenticated',
        'create_guest(text, text, text, text, text, text, text, boolean, text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated',
        'update_guest(uuid, text, text, text, text, text, text, text, boolean, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'create_guest/update_guest authenticated icin calistirilabilir degil';
  END IF;

  RAISE NOTICE 'Migration 141 tamam: pasaport tekillik kurali aktif.';
END $$;
