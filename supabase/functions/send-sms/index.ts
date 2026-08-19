// HomeGuru PMS — send-sms Edge Function.
//
// POST /functions/v1/send-sms      (body ignored — it drains the queue)
//
// AUTH: deploy with `--no-verify-jwt` and gate on the `x-sms-secret` header.
//   Why --no-verify-jwt: the DB calls this through pg_net, and the only key the
//   database has is Vault's `service_role_key`, which is STALE (pre-rotation
//   HS256) and already 401s google-sync-pull. Binding SMS to that key would tie
//   a new feature to a known-broken secret. So the gateway check is turned off
//   and the shared secret becomes the real boundary.
//
//   ⚠ FAIL CLOSED. Unlike send-push — which wraps its check in `if (PUSH_SECRET)`
//   so a rollout could proceed without a gap — an unset SMS_SECRET here makes
//   every request 503. Sending real SMS to real guests is not something to leave
//   open "temporarily"; the cost of a wrong send is money and a legal exposure.
//
// FLOW
//   1. Verify x-sms-secret (constant time).
//   2. Claim a batch ATOMICALLY via _claim_sms_batch (FOR UPDATE SKIP LOCKED).
//   3. POST each message to İletiMerkezi.
//   4. Write back status / provider id / response code.
//
// SEGMENTS ARE NOT RECOMPUTED HERE. The queue function already measured the body
// with _sms_segments (138) and the body cannot change between queue and send.
// A third copy of that maths — after src/lib/sms.ts and the SQL one — would only
// create a way for the three to disagree.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const SMS_SECRET = Deno.env.get('SMS_SECRET');
const IM_KEY = Deno.env.get('ILETIMERKEZI_KEY');
const IM_HASH = Deno.env.get('ILETIMERKEZI_HASH');
// APITEST works with no başlık and no documents — recipients get a fixed test
// message. Swap to the approved başlık only after it clears (rollout step 4).
const IM_SENDER = Deno.env.get('ILETIMERKEZI_SENDER') ?? 'APITEST';
// Belt and braces for verification: claims rows and records the outcome without
// ever calling the provider. Leaving Vault unset stops the DB from calling us at
// all; this stops US from calling them even if invoked directly.
const DRY_RUN = (Deno.env.get('SMS_DRY_RUN') ?? '').toLowerCase() === 'true';

const IM_ENDPOINT = 'https://api.iletimerkezi.com/v1/send-sms/json';
const BATCH_LIMIT = 50;

/** Constant-time compare so a mismatch can't be timed out byte by byte. */
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

/**
 * Turkish/international phone → digits-only country-code form ("905551234567").
 *
 * ⚠ This MIRRORS toWhatsAppPhone in src/lib/utils.ts line for line and must keep
 * doing so. It is duplicated rather than imported because Edge Functions bundle
 * only from supabase/functions — there is no safe import path into src/. If that
 * function changes, change this one in the same commit.
 */
function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('90')) {
    // "+90 05xx" — operators sometimes type the trunk 0 after the country code.
    digits = '90' + digits.slice(2).replace(/^0+/, '');
  } else if (digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  if (digits.length === 10 && !digits.startsWith('90')) {
    digits = '90' + digits;
  }
  if (digits.length < 10 || digits.length > 15) return null;
  return digits;
}

interface SmsRow {
  id: string;
  phone: string;
  body: string;
  kind: string;
}

interface SendOutcome {
  status: 'SENT' | 'FAILED';
  code: string;
  message: string;
  providerMsgId: string | null;
  /** True for 401 — credentials are wrong, so every later message fails too. */
  fatal: boolean;
}

/**
 * İletiMerkezi send-sms/json.
 *
 * Credentials go in the BODY, not a header. `key` and `hash` are static hex
 * strings copied from the panel (Ayarlar → Güvenlik → API Erişimi) — there is no
 * runtime hashing to do, despite the field name.
 */
async function sendOne(to: string, text: string): Promise<SendOutcome> {
  const payload = {
    request: {
      authentication: { key: IM_KEY, hash: IM_HASH },
      order: {
        sender: IM_SENDER,
        // "0" = this is NOT a message requiring an İYS consent check.
        // Legal basis, verified against the regulation on mevzuat.gov.tr:
        // MADDE 6/2 exempts satın alma / teslimat notifications from consent,
        // and MADDE 6/5 excludes those paragraphs from İYS checking outright.
        // Setting "1" would apply a check that does not apply — and would
        // suppress delivery, since guests never gave marketing consent.
        // ⚠ This is ONLY valid while the message stays transactional. Add an
        // offer, a discount, a catalogue link or a good-wish phrase and it
        // becomes MADDE 5/1 content, at which point "0" is the violation and
        // the penalty under law 6563 is PER RECIPIENT.
        iys: '0',
        message: {
          text,
          // ⚠ "receipents" IS MISSPELLED IN THEIR API. Spelling it correctly
          // returns error 452. Do not "fix" this.
          receipents: { number: [to] },
        },
      },
    },
  };

  let res: Response;
  try {
    res = await fetch(IM_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    // Network failure — genuinely unknown whether it arrived. Left FAILED for a
    // human; _claim_sms_batch deliberately does not auto-retry FAILED.
    return {
      status: 'FAILED',
      code: 'NETWORK',
      message: String(e),
      providerMsgId: null,
      fatal: false,
    };
  }

  const raw = await res.text();
  let code = String(res.status);
  let message = raw.slice(0, 500);
  let providerMsgId: string | null = null;

  // Parse defensively: a gateway error page is not JSON, and the status code
  // may arrive as a number or a string depending on their serializer.
  try {
    const j = JSON.parse(raw);
    const status = j?.response?.status;
    if (status?.code !== undefined && status?.code !== null) code = String(status.code);
    if (status?.message) message = String(status.message);
    const orderId = j?.response?.order?.id;
    if (orderId !== undefined && orderId !== null) providerMsgId = String(orderId);
  } catch {
    // keep the HTTP status + raw body
  }

  switch (code) {
    case '200':
      return { status: 'SENT', code, message, providerMsgId, fatal: false };

    case '451':
      // "Duplicate order." A request that timed out on our side but actually
      // landed returns this on retry. Treating it as FAILED would hide a
      // message the guest already received — and invite a real second send.
      return {
        status: 'SENT',
        code,
        message: `${message} (451 yinelenen sipariş — gönderilmiş sayıldı)`,
        providerMsgId,
        fatal: false,
      };

    case '401':
      // Bad credentials, or API access disabled in the panel. Every remaining
      // message in this batch will fail identically, so stop the batch.
      return { status: 'FAILED', code, message, providerMsgId, fatal: true };

    case '466':
      // Invalid recipient number — retrying cannot help.
      return { status: 'FAILED', code, message, providerMsgId, fatal: false };

    default:
      return { status: 'FAILED', code, message, providerMsgId, fatal: false };
  }
}

Deno.serve(async (req) => {
  // --- Auth. Fail closed. ---------------------------------------------------
  if (!SMS_SECRET) {
    console.error('[send-sms] SMS_SECRET not set — refusing every request.');
    return Response.json(
      { error: 'SMS_SECRET is not configured on this function.' },
      { status: 503 },
    );
  }
  const presented = req.headers.get('x-sms-secret') ?? '';
  if (!safeEqual(presented, SMS_SECRET)) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!DRY_RUN && (!IM_KEY || !IM_HASH)) {
    console.error('[send-sms] ILETIMERKEZI_KEY / ILETIMERKEZI_HASH missing.');
    return Response.json({ error: 'provider credentials not configured' }, { status: 503 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // --- Claim. One statement, SKIP LOCKED, inside the DB. --------------------
  const { data: claimed, error: claimErr } = await supabase.rpc('_claim_sms_batch', {
    _limit: BATCH_LIMIT,
  });
  if (claimErr) {
    console.error('[send-sms] claim failed:', claimErr.message);
    return Response.json({ error: claimErr.message }, { status: 500 });
  }

  const rows = (claimed ?? []) as SmsRow[];
  if (rows.length === 0) {
    return Response.json({ sent: 0, failed: 0, skipped: 0, total: 0 });
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let fatalHit = false;

  await Promise.allSettled(
    rows.map(async (row) => {
      const to = normalizePhone(row.phone);

      // Unsendable number: terminal, and recorded with a reason rather than
      // being retried forever against a number that can never work.
      if (!to) {
        skipped++;
        await supabase
          .from('sms_messages')
          .update({
            status: 'SKIPPED',
            response_code: 'BAD_PHONE',
            response_body: `Numara E.164'e çevrilemedi: ${row.phone}`,
          })
          .eq('id', row.id);
        return;
      }

      if (DRY_RUN) {
        skipped++;
        await supabase
          .from('sms_messages')
          .update({
            status: 'SKIPPED',
            provider: 'iletimerkezi',
            response_code: 'DRY_RUN',
            response_body: `DRY RUN — gönderilmedi. Hedef ${to}, ${row.body.length} karakter.`,
          })
          .eq('id', row.id);
        return;
      }

      // Once credentials are rejected, stop burning the rest of the batch: put
      // the row back to PENDING so the next sweep retries it after a fix.
      if (fatalHit) {
        await supabase
          .from('sms_messages')
          .update({ status: 'PENDING', response_code: 'ABORTED' })
          .eq('id', row.id);
        return;
      }

      const out = await sendOne(to, row.body);
      if (out.fatal) fatalHit = true;
      if (out.status === 'SENT') sent++;
      else failed++;

      await supabase
        .from('sms_messages')
        .update({
          status: out.status,
          provider: 'iletimerkezi',
          provider_msg_id: out.providerMsgId,
          response_code: out.code,
          response_body: out.message,
          sent_at: out.status === 'SENT' ? new Date().toISOString() : null,
        })
        .eq('id', row.id);
    }),
  );

  if (fatalHit) {
    console.error('[send-sms] provider returned 401 — check key/hash and panel API access.');
  }

  // Unlike send-push's empty 200, return real numbers: this is the only place
  // a human can see whether a sweep actually did anything.
  return Response.json({ sent, failed, skipped, total: rows.length, dryRun: DRY_RUN });
});
