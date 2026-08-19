-- =============================================================================
-- HomeGuru PMS — migration 137
-- SMS altyapısı: sms_messages tablosu, misafir ret hakkı, rezervasyon anahtarı.
-- =============================================================================
-- Bu migration HİÇBİR SMS GÖNDERMEZ ve hiçbir cron kurmaz. Yalnızca tabloyu,
-- iki yeni kolonu ve geri-doldurmayı (backfill) oluşturur. Gönderim 138 ve
-- send-sms Edge Function'ı ile gelir.
--
-- MİMARİ: cron SATIR YAZAR, Edge Function GÖNDERİR. Bu ayrım bedava üç şey
-- kazandırır — unique index sayesinde idempotency, başarısız satır için retry,
-- ve gerçek bir teslimat denetim kaydı.
--
-- -----------------------------------------------------------------------------
-- ⚠ EN KRİTİK KISIM: GERİ DOLDURMA (backfill)
-- -----------------------------------------------------------------------------
-- Tablo boş kalırsa 138'deki kuyruk fonksiyonu ilk çalıştığında MEVCUT TÜM
-- rezervasyonları "yeni" sanır ve her misafire SMS atar. Bu yüzden backfill
-- AYNI migration içinde, tablo oluşturulur oluşturulmaz yapılır — sonraki bir
-- migration'a bırakılamaz, arada cron kurulursa iş işten geçer.
--
-- İki tür için farklı davranıyoruz ve bu BİLEREK:
--   * CONFIRMATION → mevcut TÜM rezervasyonlar SKIPPED. Haftalar önce yapılmış
--     bir rezervasyon için "rezervasyonunuz oluşturuldu" demek yanlış olurdu.
--   * CHECKOUT → yalnızca çıkışı BUGÜN veya DAHA ÖNCE olanlar SKIPPED.
--     Gelecekteki çıkışlar normal işlesin (o mesaj güncel ve faydalı), ama
--     özelliği açtığımız gün otelde olan misafire sürpriz SMS gitmesin.
--
-- Migration sonunda backfill sayısı DOĞRULANIR; tutmazsa exception atar.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. sms_messages — kbs_submissions (001_schema.sql:242) kalıbını izler
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sms_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ON DELETE SET NULL: rezervasyon silinse de gönderim kaydı kalmalı (denetim).
  reservation_id  uuid REFERENCES reservations(id) ON DELETE SET NULL,
  guest_id        uuid REFERENCES guests(id) ON DELETE SET NULL,
  kind            text NOT NULL CHECK (kind IN ('CONFIRMATION', 'CHECKOUT')),
  phone           text NOT NULL,
  body            text NOT NULL,
  -- Gönderim anında hesaplanan segment sayısı. Faturayla karşılaştırmak için
  -- saklanır (doğrulama adımı 9) — sonradan yeniden hesaplanamaz, çünkü şablon
  -- metni değişmiş olabilir.
  segments        smallint NOT NULL DEFAULT 1,
  status          text NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED')),
  provider        text,
  provider_msg_id text,
  response_code   text,
  response_body   text,
  retry_count     int NOT NULL DEFAULT 0,
  -- Satırın Edge Function tarafından SENDING'e alındığı an. created_at BUNUN
  -- YERİNE KULLANILAMAZ: fonksiyon gönderim ortasında ölürse satır SENDING'de
  -- kalır ve kurtarma "ne zaman kilitlendi"ye bakar, "ne zaman oluşturuldu"ya
  -- değil — bir kez yeniden denenmiş satırda ikisi saatlerce ayrışır.
  claimed_at      timestamptz,
  sent_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Idempotency'nin TAMAMI bu index'e dayanır: bir rezervasyon + tür için tek
-- satır. Kuyruk fonksiyonu üst üste çalışsa da ikinci satır açılamaz.
-- reservation_id NULL olan satırlar (rezervasyonu silinmiş kayıtlar) kısıt
-- dışında kalır — aksi halde tek bir NULL ikinciyi engellerdi.
CREATE UNIQUE INDEX IF NOT EXISTS sms_messages_once
  ON sms_messages(reservation_id, kind)
  WHERE reservation_id IS NOT NULL;

-- Edge Function'ın "gönderilecek satırları bul" sorgusu için.
CREATE INDEX IF NOT EXISTS sms_messages_claimable
  ON sms_messages(status, created_at)
  WHERE status IN ('PENDING', 'SENDING', 'FAILED');

CREATE INDEX IF NOT EXISTS sms_messages_reservation_idx
  ON sms_messages(reservation_id);

-- -----------------------------------------------------------------------------
-- 2. Misafir bazlı ret hakkı (Yönetmelik MADDE 9)
-- -----------------------------------------------------------------------------
-- Ret hakkı ONAY'dan bağımsızdır: rezervasyon bildirimleri MADDE 6/2 uyarınca
-- onay gerektirmez, ama MADDE 9/4 "gönderilen HER ticari elektronik iletide"
-- ret imkânı arar. Bu kolon personelin elle işaretleyebildiği kayıttır ve
-- SKIPPED satırıyla denetlenebilir iz bırakır.
ALTER TABLE guests
  ADD COLUMN IF NOT EXISTS sms_opt_out boolean NOT NULL DEFAULT false;

-- -----------------------------------------------------------------------------
-- 3. Rezervasyon bazlı SMS anahtarı (owner isteği 2026-08-17)
-- -----------------------------------------------------------------------------
-- Yeni Rezervasyon ekranında Yönetici ve Alt Yönetici'ye görünen bir seçenek.
-- VARSAYILAN AÇIK: kimse dokunmazsa SMS gider. Kapatmak bilinçli bir eylemdir.
--
-- TEK ANAHTAR HER İKİ MESAJI DA KAPATIR. "SMS gönderilsin mi?" diye sorup
-- yalnızca onay mesajını engellemek, çıkış hatırlatmasını yine göndermek
-- kullanıcıyı yanıltırdı. Yalnızca onayı kapatmak istenirse 138'deki CHECKOUT
-- sorgusundan bu kontrol çıkarılır — tek satır.
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS sms_enabled boolean NOT NULL DEFAULT true;

-- Ekranı gizlemek güvenlik değildir: RECEPTION ve YETKILI de rezervasyon
-- oluşturup güncelleyebiliyor (033_scope_based_access.sql:135). Bu trigger
-- sınırı VERİTABANINA koyar — o roller kolona ne yazarsa yazsın yok sayılır.
-- INSERT'te varsayılana (true), UPDATE'te ESKİ değere sabitlenir; yani bir
-- yöneticinin kapattığı SMS'i başka bir rol sessizce geri açamaz.
-- SECURITY INVOKER bilerek: bu fonksiyon hiçbir tabloya dokunmuyor, yalnızca
-- NEW satırını düzenliyor. Yetki gerektiren tek çağrı auth_role() ve o zaten
-- kendi SECURITY DEFINER'ıyla geliyor — burada da tanımlamak gereksiz ayrıcalık
-- olurdu. search_path yine de sabitleniyor.
CREATE OR REPLACE FUNCTION reservations_pin_sms_enabled()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth_role() IN ('SUPER_ADMIN', 'PROPERTY_MANAGER') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.sms_enabled := true;
  ELSE
    NEW.sms_enabled := OLD.sms_enabled;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reservations_pin_sms_enabled_trg ON reservations;
CREATE TRIGGER reservations_pin_sms_enabled_trg
  BEFORE INSERT OR UPDATE ON reservations
  FOR EACH ROW EXECUTE FUNCTION reservations_pin_sms_enabled();

-- -----------------------------------------------------------------------------
-- 4. RLS — okuma finans/yönetim rollerine, yazma İSTEMCİYE HİÇ AÇIK DEĞİL
-- -----------------------------------------------------------------------------
-- kbs_select (003_rls.sql:268) kalıbı. Bilerek YALNIZCA SELECT politikası var:
-- INSERT/UPDATE/DELETE politikası olmadığı için istemci hiçbir şekilde satır
-- yazamaz. Satırları yalnızca 138'deki SECURITY DEFINER kuyruk fonksiyonu ve
-- Edge Function (service key ile) üretir/günceller.
ALTER TABLE sms_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sms_messages_select ON sms_messages;
CREATE POLICY sms_messages_select ON sms_messages FOR SELECT
  USING (
    auth_role() = 'SUPER_ADMIN'
    OR (
      auth_role() = 'PROPERTY_MANAGER'
      AND EXISTS (
        SELECT 1 FROM reservations r
        WHERE r.id = sms_messages.reservation_id
          AND auth_sees_property(r.property_id)
      )
    )
  );

-- -----------------------------------------------------------------------------
-- 5. GERİ DOLDURMA — bu migration'ın asıl koruması
-- -----------------------------------------------------------------------------
-- Boş gövde/telefon bilerek: bunlar gönderilmiş mesaj değil, "bu rezervasyon
-- SMS özelliğinden önce vardı" işaretidir. response_body sebebi taşır.
INSERT INTO sms_messages (reservation_id, guest_id, kind, phone, body, status, response_body)
SELECT r.id, r.guest_id, 'CONFIRMATION', '', '', 'SKIPPED',
       'backfill 137: SMS özelliğinden önceki rezervasyon'
FROM reservations r
ON CONFLICT DO NOTHING;

-- CHECKOUT yalnızca çıkışı geçmiş/bugün olanlar için kapatılır. Gelecekteki
-- çıkışlar normal aksın — o hatırlatma güncel ve faydalıdır.
INSERT INTO sms_messages (reservation_id, guest_id, kind, phone, body, status, response_body)
SELECT r.id, r.guest_id, 'CHECKOUT', '', '', 'SKIPPED',
       'backfill 137: SMS özelliğinden önce çıkışı yapılmış/bugün olan rezervasyon'
FROM reservations r
WHERE (r.stay_end AT TIME ZONE 'Europe/Istanbul')::date
      <= (now() AT TIME ZONE 'Europe/Istanbul')::date
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- 6. DOĞRULAMA — backfill tutmadıysa migration BAŞARISIZ OLSUN
-- -----------------------------------------------------------------------------
-- Sessizce eksik kalmış bir backfill, cron kurulduğu gün toplu SMS demektir.
-- Bu yüzden sayıyoruz ve tutmuyorsa exception atıyoruz (058 dersi: bir korumayı
-- yazmak yetmez, tuttuğunu doğrulamak gerekir).
DO $$
DECLARE
  _reservations  bigint;
  _confirmations bigint;
  _due_checkouts bigint;
  _checkout_rows bigint;
BEGIN
  SELECT count(*) INTO _reservations FROM reservations;
  SELECT count(*) INTO _confirmations
    FROM sms_messages WHERE kind = 'CONFIRMATION' AND status = 'SKIPPED';

  IF _confirmations < _reservations THEN
    RAISE EXCEPTION
      'BACKFILL EKSİK: % rezervasyon var ama yalnızca % CONFIRMATION satırı yazıldı. '
      'Cron KURULMAMALI — kurulursa mevcut misafirlere toplu SMS gider.',
      _reservations, _confirmations;
  END IF;

  SELECT count(*) INTO _due_checkouts
    FROM reservations
    WHERE (stay_end AT TIME ZONE 'Europe/Istanbul')::date
          <= (now() AT TIME ZONE 'Europe/Istanbul')::date;
  SELECT count(*) INTO _checkout_rows
    FROM sms_messages WHERE kind = 'CHECKOUT' AND status = 'SKIPPED';

  IF _checkout_rows < _due_checkouts THEN
    RAISE EXCEPTION
      'BACKFILL EKSİK (CHECKOUT): % uygun rezervasyon var, % satır yazıldı.',
      _due_checkouts, _checkout_rows;
  END IF;

  RAISE NOTICE '137 OK — % rezervasyon, % CONFIRMATION + % CHECKOUT SKIPPED satırı.',
    _reservations, _confirmations, _checkout_rows;
END;
$$;
