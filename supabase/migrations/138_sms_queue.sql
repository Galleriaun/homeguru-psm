-- =============================================================================
-- HomeGuru PMS — migration 138
-- SMS kuyruğu: gecelik ücret yardımcısı, birim etiketi, kuyruk fonksiyonu.
-- =============================================================================
-- ⚠ BU MIGRATION CRON KURMAZ. Fonksiyonları tanımlar, hepsi bu. Hiçbir SMS
-- gönderilmez, çünkü (a) cron yok, (b) Vault'ta send_sms_url yoksa
-- _send_sms_async sessizce çıkar. Cron'u kurma komutu dosyanın EN SONUNDA,
-- YORUM İÇİNDE duruyor ve doğrulama adımları geçmeden çalıştırılmamalı.
--
-- MİMARİ: cron SATIR YAZAR, Edge Function GÖNDERİR.
--   pg_cron  →  _queue_reservation_sms()   satırları PENDING olarak yazar
--                 └─ _send_sms_async()     Vault → net.http_post → send-sms
--                      └─ send-sms         satırları alır, İletiMerkezi'ye POST eder
--
-- Bu ayrım idempotency'yi 137'deki unique index'e devreder: kuyruk fonksiyonu
-- kaç kez koşarsa koşsun rezervasyon+tür başına tek satır açılır.
--
-- TELEFON NORMALİZASYONU BİLEREK BURADA DEĞİL. Tek bir normalizatör olsun diye
-- ham numara saklanır; E.164'e çevirme send-sms içinde, src/lib/utils.ts'teki
-- toWhatsAppPhone ile AYNI kurallarla yapılır. SQL'e ikinci bir kopya yazmak iki
-- kuralın zamanla ayrışması demekti.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. _reservation_nightly_rate — 088'in ifadesinin TEK KOPYASI
-- -----------------------------------------------------------------------------
-- 088_auto_debit_nightly_rate.sql uyarıyor: total_amount / gece sayısı GÜVENİLİR
-- DEĞİL. Gerçek gecelik ücret, o birim+tarih için fiyat takvimi kaydı varsa o,
-- yoksa birimin base_price'ıdır. SMS'in yazdığı rakam ile kasaya işlenen rakam
-- asla ayrışmasın diye ifade buraya çıkarıldı.
--
-- Varsayılan tarih GİRİŞ günü: SMS tek bir rakam yazar ve misafirin geldiği gün
-- ödeyeceği ücret en dürüst olanıdır. Geceden geceye değişen fiyatlarda bu bir
-- yaklaşımdır — mesaj "gecelik ücret" diyor, "toplam" demiyor.
CREATE OR REPLACE FUNCTION _reservation_nightly_rate(
  _reservation_id uuid,
  _for_date       date DEFAULT NULL
) RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
           (SELECT pnp.price
              FROM property_nightly_prices pnp
             WHERE pnp.unit_id = r.unit_id
               AND pnp.price_date = COALESCE(
                     _for_date,
                     (r.stay_start AT TIME ZONE 'Europe/Istanbul')::date
                   )
             LIMIT 1),
           u.base_price
         )
    FROM reservations r
    -- LEFT JOIN ŞART: 079_delete_property_orphan.sql reservations.unit_id'yi
    -- nullable yaptı; birim silinince rezervasyon KALIR ve unit_id NULL olur.
    -- INNER JOIN olsaydı bu fonksiyon o rezervasyonlar için HİÇ SATIR DÖNMEZ,
    -- ücret sessizce NULL olurdu. Şimdi de NULL dönebilir (silinmiş birimin
    -- base_price'ı yok) ama bu artık AÇIK bir durum ve çağıran onu SKIPPED
    -- satırı yazarak ele alıyor.
    LEFT JOIN units u ON u.id = r.unit_id
   WHERE r.id = _reservation_id;
$$;

-- -----------------------------------------------------------------------------
-- 2. _sms_money — "2.500 TL" / "1.234,50 TL"
-- -----------------------------------------------------------------------------
-- to_char'ın ayırıcıları locale'e bağlı olduğu için maskede AÇIKÇA ',' ve '.'
-- kullanılıp translate ile yer değiştiriliyor: '2,500.00' → '2.500,00'. Böylece
-- sunucunun lc_numeric ayarı ne olursa olsun çıktı Türkçe olur.
-- Tam sayıysa kuruş yazılmaz — SMS'te her karakter bütçedir.
-- STABLE, IMMUTABLE değil: to_char(numeric, text) lc_numeric'e bağlı olduğu için
-- PostgreSQL'de STABLE'dır. Açık maske + translate sayesinde çıktımız pratikte
-- sabit ama bir fonksiyonu çağırdığından daha güçlü işaretlemek yanlış olur.
CREATE OR REPLACE FUNCTION _sms_money(_amount numeric)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT translate(
           to_char(_amount, CASE WHEN _amount = trunc(_amount)
                                 THEN 'FM999,999,990'
                                 ELSE 'FM999,999,990.00' END),
           ',.', '.,'
         ) || ' TL';
$$;

-- -----------------------------------------------------------------------------
-- 3. _sms_birim_label — misafirin tanıyacağı tek isim
-- -----------------------------------------------------------------------------
-- HOTEL  → oda ("Oda 101"). Misafir zaten hangi oteli tuttuğunu biliyor.
-- APARTMENT → mülkün adı ("Villa Deniz"). Dairede birim = mülkün kendisi.
--
-- 30 KARAKTER SINIRI ÖLÇÜMLE BELİRLENDİ (scratchpad/sms-verify.cjs): en uzun
-- misafir adıyla birlikte etiket 36 karakterde mesajı ikinci segmente taşıyor,
-- tipik adla 46'da. 30 en kötü durumu 6 karakterle geçiyor. Bu mesajlar kimse
-- bakmadan gidiyor; taşmayı yakalayacak insan yok.
CREATE OR REPLACE FUNCTION _sms_birim_label(
  _property_type text,
  _property_name text,
  _unit_name     text
) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT left(
    CASE WHEN _property_type = 'HOTEL' AND COALESCE(_unit_name, '') <> ''
         THEN 'Oda ' || _unit_name
         ELSE COALESCE(_property_name, '')
    END, 30);
$$;

-- -----------------------------------------------------------------------------
-- 4. _sms_segments — üç bantlı segment tahmini
-- -----------------------------------------------------------------------------
-- REFERANS UYGULAMA src/lib/sms.ts'tir (32 testle doğrulandı,
-- scratchpad/sms-verify.cjs). Buradaki İKİNCİ kopyadır ve bilerek İKİYLE
-- SINIRLI tutulmuştur: send-sms segmenti YENİDEN HESAPLAMAZ, çünkü gövde kuyruğa
-- girdikten sonra değişmiyor — üçüncü bir kopya yalnızca üçünün birbirinden
-- ayrışması için yeni bir yol açardı. Saklanan değer bu fonksiyonunkidir ve
-- gerçek fatura ile karşılaştırılacak olan da odur (doğrulama adımı 9).
--
-- Bantlar (İletiMerkezi'nin yayımladığı değerler):
--   İngilizce GSM-7  155 / 153      Türkçe 150 / 148      Unicode 65 / 63
-- translate() ile temsil edilebilen tüm karakterler silinir; geriye bir şey
-- kalıyorsa (emoji, Kiril…) mesaj Unicode'a düşer ve limit 65'e iner.
CREATE OR REPLACE FUNCTION _sms_segments(_body text)
RETURNS smallint
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  -- GSM-7 temel alfabe + uzantı tablosu + Türkçe ek harfler.
  _representable constant text :=
    '@£$¥èéùìòÇØø' || chr(10) || chr(13) ||
    'ÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&''()*+,-./0123456789:;<=>?' ||
    '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà' ||
    '^{}\[~]|€' ||
    'çğĞıİşŞ';
  -- Yalnızca Türkçe moda düşüren harfler. Ç Ö ö Ü ü BİLEREK YOK: onlar zaten
  -- GSM-7 temel alfabede, listeye eklenirse mesaj boş yere 150 bandına iner.
  _turkish_only constant text := 'çğĞıİşŞ';
  _chars   int;
  _single  int;
  _multi   int;
BEGIN
  IF _body IS NULL OR _body = '' THEN
    RETURN 0;
  END IF;
  _chars := length(_body);

  IF length(translate(_body, _representable, '')) > 0 THEN
    _single := 65;  _multi := 63;   -- Unicode
  ELSIF _body <> translate(_body, _turkish_only, '') THEN
    _single := 150; _multi := 148;  -- Türkçe
  ELSE
    _single := 155; _multi := 153;  -- İngilizce GSM-7
  END IF;

  IF _chars <= _single THEN
    RETURN 1;
  END IF;
  RETURN ceil(_chars::numeric / _multi)::smallint;
END;
$$;

-- -----------------------------------------------------------------------------
-- 5. _send_sms_async — Edge Function'ı uyandırır
-- -----------------------------------------------------------------------------
-- _send_push_async (130_send_push_shared_secret.sql:28) kalıbı, İKİ FARKLA:
--
--  (a) Vault'taki `service_role_key` BİLEREK OKUNMUYOR. O sır rotasyondan kalma
--      eski HS256 anahtarını taşıyor ve google-sync-pull'u sürekli 401'letiyor.
--      Buraya bağlanmak, SMS'i bilinen bozuk bir sırra bağlamak olurdu.
--      Bunun yerine fonksiyon `--no-verify-jwt` ile deploy edilir ve tek yetki
--      sınırı `x-sms-secret` başlığıdır.
--  (b) sms_secret YOKSA HİÇ ÇAĞIRMIYORUZ. send-push rollout sırasında sırrı
--      opsiyonel tutmuştu; burada kapalı devre başlıyoruz — sır yoksa Edge
--      Function zaten 503 dönecek, boşuna istek atmanın anlamı yok.
CREATE OR REPLACE FUNCTION _send_sms_async()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  function_url text;
  sms_secret   text;
  request_id   bigint;
BEGIN
  SELECT decrypted_secret INTO function_url
    FROM vault.decrypted_secrets WHERE name = 'send_sms_url' LIMIT 1;
  SELECT decrypted_secret INTO sms_secret
    FROM vault.decrypted_secrets WHERE name = 'sms_secret' LIMIT 1;

  IF function_url IS NULL OR sms_secret IS NULL THEN
    -- Kurulum tamamlanmadan kuyruk çalışsa bile satırlar PENDING'de bekler.
    -- Doğrulama adımı 3 tam olarak bu duruma dayanır.
    RAISE NOTICE '[sms] vault sırları send_sms_url/sms_secret eksik — gönderim atlandı';
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url     := function_url,
    headers := jsonb_build_object(
      'Content-Type',   'application/json',
      'x-sms-secret',   sms_secret
    ),
    body    := '{}'::jsonb
  ) INTO request_id;

  RETURN request_id;
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. _queue_reservation_sms — satırları yazan asıl iş
-- -----------------------------------------------------------------------------
-- Her rezervasyon kendi BEGIN…EXCEPTION bloğunda: tek bir bozuk kayıt (silinmiş
-- birim, NULL fiyat…) tüm turu düşürmemeli.
--
-- ATLAMA SESSİZ DEĞİL: telefon yok / ret hakkı kullanılmış durumlarda SKIPPED
-- satırı sebebiyle birlikte yazılır. Hem denetim izi olur hem de unique index
-- sayesinde o rezervasyon bir daha denenmez.
CREATE OR REPLACE FUNCTION _queue_reservation_sms()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _r       record;
  _queued  int := 0;
  -- ON CONFLICT DO NOTHING sessizce hiçbir şey yazmayabilir (eşzamanlı ikinci
  -- tur). ROW_COUNT okunmazsa _queued yalan söyler ve doğrulama adımı 4
  -- ("üç kez çalıştır, tek satır olsun") anlamsızlaşır.
  _ins     int;
  _body    text;
  _birim   text;
  _phone   text;
  _reason  text;
  _rate    numeric;
  _now_ist timestamp := (now() AT TIME ZONE 'Europe/Istanbul');
  _today   date      := (now() AT TIME ZONE 'Europe/Istanbul')::date;
BEGIN
  -- ===========================================================================
  -- A. REZERVASYON OLUŞTURULDU
  -- ===========================================================================
  FOR _r IN
    -- properties/units LEFT JOIN, isimler COALESCE'lı: 079 mülk/birim silinince
    -- rezervasyonu SİLMİYOR, id'leri NULL'layıp adı deleted_*_name kolonlarına
    -- yazıyor. INNER JOIN bu rezervasyonları sessizce eler — ne SMS gider ne de
    -- atlandığına dair bir iz kalır. guests INNER kalabilir: guest_id NOT NULL
    -- ve ON DELETE RESTRICT, yani rezervasyonu olan misafir silinemiyor.
    SELECT r.id, r.guest_id, r.stay_start, r.stay_end,
           g.full_name, g.phone, g.sms_opt_out,
           COALESCE(p.name, r.deleted_property_name) AS property_name,
           p.type                                    AS property_type,
           COALESCE(u.name, r.deleted_unit_name)     AS unit_name
      FROM reservations r
      JOIN      guests     g ON g.id = r.guest_id
      LEFT JOIN properties p ON p.id = r.property_id
      LEFT JOIN units      u ON u.id = r.unit_id
     WHERE r.status IN ('pending', 'active')
       AND r.sms_enabled
       -- Emniyet kemeri. 137'nin backfill'i asıl korumadır; bu pencere, cron
       -- bir süre durursa arada oluşturulan rezervasyonları yakalar ama çok
       -- eski bir kaydın "yeni" sanılmasına da izin vermez.
       AND r.created_at >= now() - interval '7 days'
       AND NOT EXISTS (
             SELECT 1 FROM sms_messages m
              WHERE m.reservation_id = r.id AND m.kind = 'CONFIRMATION'
           )
  LOOP
    BEGIN
      _phone  := NULLIF(btrim(COALESCE(_r.phone, '')), '');
      _rate   := _reservation_nightly_rate(_r.id);
      _birim  := _sms_birim_label(_r.property_type, _r.property_name, _r.unit_name);
      _reason := NULL;

      IF _r.sms_opt_out THEN
        _reason := 'Misafir SMS almayı reddetti (ret hakkı)';
      ELSIF _phone IS NULL THEN
        _reason := 'Misafir kaydında telefon numarası yok';
      ELSIF _rate IS NULL THEN
        -- Birim silinmişse base_price kalmaz. Mesaj "Gecelik ücret" yazdığı için
        -- rakamsız gönderilemez; sessizce düşmek yerine sebebi kaydediyoruz.
        _reason := 'Gecelik ücret hesaplanamadı (birim silinmiş olabilir)';
      ELSIF COALESCE(_birim, '') = '' THEN
        -- Hem mülk hem birim silinmiş ve anlık görüntü adları da boşsa mesaj
        -- neyin rezervasyonu olduğunu söyleyemez. Yarım mesaj göndermeyiz.
        _reason := 'Mülk/birim adı bulunamadı';
      END IF;

      IF _reason IS NOT NULL THEN
        INSERT INTO sms_messages (reservation_id, guest_id, kind, phone, body,
                                  segments, status, response_body)
        VALUES (_r.id, _r.guest_id, 'CONFIRMATION', COALESCE(_phone, ''), '',
                0, 'SKIPPED', _reason)
        ON CONFLICT DO NOTHING;
        CONTINUE;
      END IF;

      -- ⚠ ŞABLON — DEĞİŞTİRMEDEN ÖNCE OKU
      --   * EMOJİ YASAK: tek bir emoji mesajı Unicode/65'e düşürür, maliyeti
      --     üçe katlar.
      --   * TANITIM/KAMPANYA/İNDİRİM YASAK ve KUTLAMA-TEMENNİ YASAK: Yönetmelik
      --     MADDE 5/1 "kutlama ve temenni" ifadelerini açıkça sayar, MADDE 6/2
      --     de bildirimlerde mal/hizmet özendirilemeyeceğini söyler. Bu yüzden
      --     "İyi yolculuklar dileriz" kaldırıldı.
      --   * "oluşturuldu" — "onaylandı" DEĞİL: rezervasyon iptal edilebiliyor,
      --     mesaj kaydın hak etmediği bir şeyi vaat etmemeli (owner kararı).
      _body := 'Sayın ' || _r.full_name || ', ' || _birim
            || ' rezervasyonunuz oluşturuldu. '
            || to_char(_r.stay_start AT TIME ZONE 'Europe/Istanbul', 'DD.MM.YYYY')
            || '-'
            || to_char(_r.stay_end   AT TIME ZONE 'Europe/Istanbul', 'DD.MM.YYYY')
            || '. Gecelik ücret ' || _sms_money(_rate)
            || '. HomeGuru';

      INSERT INTO sms_messages (reservation_id, guest_id, kind, phone, body,
                                segments, status)
      VALUES (_r.id, _r.guest_id, 'CONFIRMATION', _phone, _body,
              _sms_segments(_body), 'PENDING')
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS _ins = ROW_COUNT;
      _queued := _queued + _ins;

    EXCEPTION WHEN OTHERS THEN
      -- Handler bitince blok kapanır ve döngü kendiliğinden bir sonraki kayda
      -- geçer; buraya CONTINUE yazmak gereksiz.
      RAISE NOTICE '[sms] rezervasyon % için onay SMS''i kuyruğa alınamadı: %',
        _r.id, SQLERRM;
    END;
  END LOOP;

  -- ===========================================================================
  -- B. ÇIKIŞ GÜNÜ HATIRLATMASI — 08:00'den sonra, yalnızca konaklamalı
  -- ===========================================================================
  IF EXTRACT(hour FROM _now_ist) >= 8 THEN
    FOR _r IN
      SELECT r.id, r.guest_id, r.late_checkout_hours,
             g.full_name, g.phone, g.sms_opt_out
        FROM reservations r
        JOIN guests g ON g.id = r.guest_id
       WHERE r.stay_type = 'OVERNIGHT'          -- günübirlik tamamen dışarıda
         -- 'completed' BİLEREK DAHİL — KALDIRMAYIN, YARIŞ VAR.
         -- Konaklamalı stay_end çıkış gününün gece yarısına hizalı (044) ve
         -- 075'in cron'u kaydı tam olarak `stay_end + 8 saat + geç çıkış`
         -- anında 'completed' yapıyor — yani late_checkout_hours = 0 için
         -- SAAT 08:00'DE, bizim gönderdiğimiz dakikada. Hangi cron'un önce
         -- koştuğuna göre satır 'active' de olabilir 'completed' de.
         -- Yalnızca 'active' aransaydı hatırlatma bazı günler sessizce
         -- kaybolurdu — üstelik gece yarısı biten konaklamalarda her gün.
         -- Misafir her hâlükârda oteldedir: çıkış operasyonel olarak 11:00'e
         -- kadardır, statü yalnızca defter kaydıdır.
         AND r.status IN ('active', 'completed')
         AND r.sms_enabled
         AND (r.stay_end AT TIME ZONE 'Europe/Istanbul')::date = _today
         AND NOT EXISTS (
               SELECT 1 FROM sms_messages m
                WHERE m.reservation_id = r.id AND m.kind = 'CHECKOUT'
             )
    LOOP
      BEGIN
        _phone  := NULLIF(btrim(COALESCE(_r.phone, '')), '');
        _reason := NULL;
        IF _r.sms_opt_out THEN
          _reason := 'Misafir SMS almayı reddetti (ret hakkı)';
        ELSIF _phone IS NULL THEN
          _reason := 'Misafir kaydında telefon numarası yok';
        END IF;

        IF _reason IS NOT NULL THEN
          INSERT INTO sms_messages (reservation_id, guest_id, kind, phone, body,
                                    segments, status, response_body)
          VALUES (_r.id, _r.guest_id, 'CHECKOUT', COALESCE(_phone, ''), '',
                  0, 'SKIPPED', _reason)
          ON CONFLICT DO NOTHING;
          CONTINUE;
        END IF;

        -- Çıkış saati SABİT 11:00 DEĞİL: late_checkout_hours (058) 0-4 saat
        -- ekliyor ve misafire yanlış saati yazmak doğrudan şikâyet sebebi.
        -- src/lib/utils.ts'teki checkoutTimeLabel ile aynı kural.
        _body := 'Sayın ' || _r.full_name || ', bugün çıkış gününüz. '
              || 'Çıkış saati en geç '
              || lpad((11 + COALESCE(_r.late_checkout_hours, 0))::text, 2, '0')
              || ':00. HomeGuru';

        INSERT INTO sms_messages (reservation_id, guest_id, kind, phone, body,
                                  segments, status)
        VALUES (_r.id, _r.guest_id, 'CHECKOUT', _phone, _body,
                _sms_segments(_body), 'PENDING')
        ON CONFLICT DO NOTHING;
        GET DIAGNOSTICS _ins = ROW_COUNT;
        _queued := _queued + _ins;

      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '[sms] rezervasyon % için çıkış SMS''i kuyruğa alınamadı: %',
          _r.id, SQLERRM;
      END;
    END LOOP;
  END IF;

  -- Döngülerin DIŞINDA, tek sefer: Edge Function zaten bekleyen tüm satırları
  -- toplu alıyor. Döngü içinde çağırmak her satır için bir HTTP isteği demekti.
  IF _queued > 0 THEN
    PERFORM _send_sms_async();
  END IF;

  RETURN _queued;
END;
$$;

-- -----------------------------------------------------------------------------
-- 7. _claim_sms_batch — Edge Function'ın satırları ATOMİK olarak alması
-- -----------------------------------------------------------------------------
-- Bu fonksiyonun VARLIK SEBEBİ: "önce SELECT sonra UPDATE" yapılırsa üst üste
-- binen iki tur AYNI satırları okur ve HER MİSAFİRE İKİ SMS gider. Tek bir
-- UPDATE … FOR UPDATE SKIP LOCKED ile satırlar okunduğu anda kilitlenir;
-- ikinci tur onları hiç görmez, bekleyip kuyruk da biriktirmez.
--
-- Kurtarma: SENDING'de 15 dakikadan uzun kalmış satır, gönderim ortasında ölmüş
-- bir çağrıdan kalmadır ve yeniden alınır. Ölçü claimed_at'tir (137), created_at
-- DEĞİL — bir kez yeniden denenmiş satırda ikisi saatlerce ayrışır.
--
-- FAILED BİLEREK YENİDEN DENENMEZ. Zaman aşımına uğrayıp aslında teslim edilmiş
-- olabilecek bir mesajı otomatik tekrarlamak çift gönderim riskidir; FAILED
-- satır kayıtta durur ve insana görünür. (Sağlayıcı 451 "yinelenen sipariş"
-- dönerse send-sms onu zaten SENT sayar.)
--
-- retry_count < 5: sonsuz döngüye karşı üst sınır.
CREATE OR REPLACE FUNCTION _claim_sms_batch(_limit int DEFAULT 50)
RETURNS SETOF sms_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE sms_messages m
     SET status      = 'SENDING',
         claimed_at  = now(),
         retry_count = m.retry_count + 1
   WHERE m.id IN (
           SELECT m2.id
             FROM sms_messages m2
            WHERE m2.retry_count < 5
              AND (
                    m2.status = 'PENDING'
                    OR (m2.status = 'SENDING'
                        AND m2.claimed_at < now() - interval '15 minutes')
                  )
            ORDER BY m2.created_at
            LIMIT GREATEST(COALESCE(_limit, 50), 1)
            FOR UPDATE SKIP LOCKED
         )
  RETURNING m.*;
END;
$$;

-- -----------------------------------------------------------------------------
-- 8. YETKİLER — 058 dersi: `from public` olmadan hiçbir şey kapanmaz
-- -----------------------------------------------------------------------------
-- PostgreSQL yeni fonksiyonlara EXECUTE'u PUBLIC'e verir ve `authenticated` de
-- PUBLIC üyesidir. Yalnızca `from anon, authenticated` demek bu yüzden HİÇBİR
-- ŞEYİ kapatmaz — `from public` şarttır.
--
-- is_finance benzeri bir guard EKLENEMEZ: bunları cron çalıştırır ve orada
-- auth.uid() NULL'dır, guard her gece patlardı. Tek koruma grant'tır.
REVOKE ALL ON FUNCTION _queue_reservation_sms()              FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION _send_sms_async()                     FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION _reservation_nightly_rate(uuid, date) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION _claim_sms_batch(int)                 FROM public, anon, authenticated;

-- _claim_sms_batch'i send-sms Edge Function'ı service_role ile çağırır.
-- service_role da PUBLIC üyesi olduğu için yukarıdaki REVOKE onu da kapattı;
-- AÇIK GRANT olmadan Edge Function "function does not exist" benzeri bir hatayla
-- düşer. Yalnızca bu fonksiyona veriliyor — kuyruk fonksiyonu cron'undur.
GRANT EXECUTE ON FUNCTION _claim_sms_batch(int) TO service_role;

DO $$
BEGIN
  IF has_function_privilege('authenticated', '_queue_reservation_sms()', 'EXECUTE')
     OR has_function_privilege('authenticated', '_send_sms_async()', 'EXECUTE')
     OR has_function_privilege('authenticated', '_claim_sms_batch(int)', 'EXECUTE') THEN
    RAISE EXCEPTION
      'REVOKE TUTMADI: giriş yapmış bir kullanıcı SMS kuyruğunu elle tetikleyebilir.';
  END IF;
  -- Ters yön: grant fazla daraldıysa hata gece değil ŞİMDİ çıksın.
  IF NOT has_function_privilege('service_role', '_claim_sms_batch(int)', 'EXECUTE') THEN
    RAISE EXCEPTION
      'service_role _claim_sms_batch çalıştıramıyor — send-sms hiçbir mesaj gönderemez.';
  END IF;
  RAISE NOTICE '138 OK — fonksiyonlar tanımlandı, grant''lar kapalı, CRON KURULMADI.';
END;
$$;

-- =============================================================================
-- CRON — BİLEREK KURULMADI. Doğrulama adımları geçmeden ÇALIŞTIRMAYIN.
-- =============================================================================
-- Önce şunlar sağlanmalı:
--   1. 137'nin backfill sayısı doğrulandı (migration zaten kendisi kontrol eder)
--   2. send-sms Edge Function deploy edildi (--no-verify-jwt)
--   3. Vault'ta send_sms_url + sms_secret var, SMS_SECRET function'da aynı değer
--   4. APITEST ile en az bir tur denendi
--
-- Hazır olunca SQL editöründe:
--
--   DO $cron$
--   BEGIN
--     PERFORM cron.unschedule('homeguru-sms-sweep');
--   EXCEPTION WHEN OTHERS THEN NULL;
--   END $cron$;
--
--   SELECT cron.schedule(
--     'homeguru-sms-sweep',
--     '*/15 * * * *',
--     $sms$ SELECT _queue_reservation_sms(); $sms$
--   );
--
-- ACİL DURDURMA:  SELECT cron.unschedule('homeguru-sms-sweep');
-- Kuyruktaki satırlar PENDING'de kalır, kendiliğinden gönderilmez.
-- =============================================================================
