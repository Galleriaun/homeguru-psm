-- =============================================================================
-- HomeGuru PMS — migration 143  (İSTEĞE BAĞLI / ERTELENMİŞ)
-- TC + pasaport tekilliğini veritabanı seviyesinde de kilitle.
-- =============================================================================
-- BU DOSYAYI ŞİMDİ ÇALIŞTIRMAK ZORUNDA DEĞİLSİNİZ.
--
-- 140/141 tekilliği zaten uyguluyor: create_guest / update_guest yeni bir TC
-- veya pasaport girildiğinde parmak izini arar ve çakışıyorsa reddeder. Günlük
-- kullanımdaki asıl senaryo (personel dönen misafiri yeniden giriyor) tamamen
-- korunuyor.
--
-- Bu dosyanın eklediği TEK şey, veritabanı seviyesinde mutlak sınır:
--   • Yarış durumu: tam olarak aynı anda gelen iki oluşturma isteği ön kontrolü
--     birlikte geçebilir. Index bunu imkânsız kılar (RPC'lerdeki
--     `WHEN unique_violation` yakalayıcıları bu iş için zaten yazılmış durumda
--     ve index gelince anlamlı hâle gelir).
--   • Gelecekte eklenecek herhangi bir yazma yolu ön kontrolü unutursa.
--
-- BEDELİ: index, mevcut çift kayıtlar TEMİZLENMEDEN kurulamaz. Owner 2026-08-22
-- itibarıyla 100 grup / 225 kayıtla eskiyi olduğu gibi bırakmayı seçti; bu
-- dosya o temizlik yapıldığında çalıştırılmak üzere bekliyor.
--
-- Temiz değilse: DURUR, hiçbir şey uygulanmaz ve çakışan kayıtları ad + id ile
-- listeler (TC/pasaport numarasının kendisi KVKK gereği yazdırılmaz).
--
-- Temizlik için triage sorgusu SETUP.md'dedir (hangi kaydın rezervasyonu ve
-- cari hareketi var — hangisi korunmalı).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Ön koşul.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'guests_tc_kimlik_hash_idx'
  ) THEN
    RAISE EXCEPTION 'Once 140_guest_tc_unique.sql calistirilmali.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'guests_passport_hash_idx'
  ) THEN
    RAISE EXCEPTION 'Once 141_guest_passport_unique.sql calistirilmali.';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. Veri temiz mi? Değilse BURADA dur.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_tc text;
  v_pp text;
BEGIN
  SELECT string_agg(grp, E'\n')
    INTO v_tc
  FROM (
    SELECT '  - ' || string_agg(full_name || ' [' || id::text || ']', '  /  '
                                ORDER BY created_at) AS grp
    FROM guests
    WHERE tc_kimlik_hash IS NOT NULL
    GROUP BY tc_kimlik_hash
    HAVING count(*) > 1
  ) d;

  SELECT string_agg(grp, E'\n')
    INTO v_pp
  FROM (
    SELECT '  - ' || string_agg(full_name || ' [' || id::text || ']', '  /  '
                                ORDER BY created_at) AS grp
    FROM guests
    WHERE passport_hash IS NOT NULL
    GROUP BY passport_hash
    HAVING count(*) > 1
  ) d;

  IF v_tc IS NOT NULL OR v_pp IS NOT NULL THEN
    RAISE EXCEPTION E'Veri henuz temiz degil; UNIQUE index kurulamaz. Hicbir sey uygulanmadi.\n%\n%',
      COALESCE(E'AYNI TC:\n' || v_tc, 'AYNI TC: yok'),
      COALESCE(E'AYNI PASAPORT:\n' || v_pp, 'AYNI PASAPORT: yok');
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. UNIQUE index'ler.
-- -----------------------------------------------------------------------------
-- Kısmi (WHERE ... IS NOT NULL): TC'si/pasaportu olmayan misafirler sınırsızdır.
-- guests'te deleted_at YOK (silme sert), o yüzden soft-delete yüklemi gerekmiyor.
--
-- Ad'lar 140/141'in EXCEPTION yakalayıcılarındaki adlarla birebir aynı olmalı —
-- `guests_tc_kimlik_unique` / `guests_passport_unique`. Aksi hâlde yarış
-- durumunda kullanıcı ham Postgres hatası görür.
CREATE UNIQUE INDEX IF NOT EXISTS guests_tc_kimlik_unique
  ON guests (tc_kimlik_hash)
  WHERE tc_kimlik_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS guests_passport_unique
  ON guests (passport_hash)
  WHERE passport_hash IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3. Artık gereksiz arama index'lerini düşür.
-- -----------------------------------------------------------------------------
-- UNIQUE index aynı sütun + aynı yüklemle kurulduğu için arama işini de görür;
-- ikisini birden tutmak her yazmada iki index güncellemesi demektir.
-- SIRA ÖNEMLİ: önce UNIQUE kuruldu, sonra bunlar düşüyor — arada index'siz
-- kalan bir an olmuyor.
DROP INDEX IF EXISTS guests_tc_kimlik_hash_idx;
DROP INDEX IF EXISTS guests_passport_hash_idx;

-- -----------------------------------------------------------------------------
-- 4. Doğrulama.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = 'guests_tc_kimlik_unique' AND i.indisunique
  ) THEN
    RAISE EXCEPTION 'guests_tc_kimlik_unique yok veya UNIQUE degil';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = 'guests_passport_unique' AND i.indisunique
  ) THEN
    RAISE EXCEPTION 'guests_passport_unique yok veya UNIQUE degil';
  END IF;

  RAISE NOTICE 'Migration 143 tamam: TC ve pasaport tekilligi artik DB seviyesinde de kilitli.';
END $$;
