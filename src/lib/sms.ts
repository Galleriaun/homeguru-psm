/**
 * SMS length + segment maths for İletiMerkezi.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Turkish SMS billing is per *segment*, not per message, and the segment
 * boundary moves depending on which characters the text contains. Getting this
 * wrong does not throw — it silently doubles the bill. Every template we send
 * is measured through here before it goes anywhere.
 *
 * THREE MODES, NOT TWO
 * --------------------
 * Most international aggregators know only GSM-7 (160) and Unicode (70), which
 * is why they treat any Turkish text as Unicode and charge double. İletiMerkezi
 * supports a Turkish alphabet mode, and publishes these limits:
 *
 *   English (GSM-7 basic)  155 single / 153 multipart
 *   Turkish                150 single / 148 multipart
 *   Unicode (UCS-2)         65 single /  63 multipart
 *
 * ⚠ Turkish mode is NOT on by default. "Universal Language Support" must be
 * enabled at panel.iletimerkezi.com/settings/sms/encoding, or the account falls
 * back to English GSM-7 and every `ş` collapses the message to Unicode/65.
 *
 * THE OPERATOR CODE IS ALREADY IN THESE NUMBERS (inferred, see below)
 * ------------------------------------------------------------------
 * BTK requires carriers to append a 4-character operator code (`B001`-style) to
 * başlıklı sends — mandatory since 11.12.2016 per decision DK-YED/211 — which
 * costs 5 characters with its separating space. Twilio independently documents
 * Turkish GSM-7 as 155 rather than 160, and 160 − 5 = 155 is exactly
 * İletiMerkezi's published English figure. So the published limits appear to be
 * *net* of the operator code already, and OPERATOR_CODE_RESERVE stays 0.
 *
 * This is an inference, not a vendor statement — İletiMerkezi's own help pages
 * do not mention the code at all. It is on the list of questions for their
 * support. If they confirm a further deduction, change the one constant below;
 * nothing else in the codebase needs to move.
 *
 * WHAT THIS DELIBERATELY DOES NOT MODEL
 * ------------------------------------
 * Per-character septet costs. In 3GPP TS 23.038 a national-language character
 * costs either 1 septet (locking shift) or 2 (single shift + escape), and which
 * one İletiMerkezi uses is not documented. Modelling it wrong is worse than not
 * modelling it, so we count characters and trust the published limits — then
 * reconcile against the panel's actual credit burn after a week of live sends.
 * That reconciliation is the real validation of this file.
 */

/** Which alphabet the message will be sent in. Drives the character limit. */
export type SmsEncoding = 'GSM7' | 'TURKISH' | 'UNICODE';

export interface SmsLength {
  encoding: SmsEncoding;
  /** Billable character count (UTF-16 units for Unicode, code points otherwise). */
  chars: number;
  segments: number;
  /** The single-segment limit that applied, after any operator-code reserve. */
  limit: number;
  /** Characters left before the message tips into the next segment. */
  remaining: number;
  /** Characters outside the sendable set that forced Unicode, deduped. */
  forcedUnicodeBy: string;
}

/**
 * Extra characters to hold back for the BTK operator code. 0 because the
 * published limits already appear to account for it — see the file header.
 * Raising this is the single lever if support says otherwise.
 */
export const OPERATOR_CODE_RESERVE = 0;

const LIMITS: Record<SmsEncoding, { single: number; multi: number }> = {
  GSM7: { single: 155, multi: 153 },
  TURKISH: { single: 150, multi: 148 },
  UNICODE: { single: 65, multi: 63 },
};

/**
 * GSM 03.38 basic alphabet + its extension table. Note which accented
 * characters are already here and therefore do NOT cost Turkish mode:
 * `Ç Ö ö Ü ü` are basic. Only `ç ğ Ğ ı İ ş Ş` are not.
 */
const GSM7_BASIC = new Set(
  (
    '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
    '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà' +
    // Extension table — each of these actually costs 2 septets on the wire.
    '^{}\\[~]|€'
  ).split(''),
);

/**
 * The characters that make a message "Turkish" rather than plain GSM-7.
 * Deliberately does not include `Ç ö Ö ü Ü` — those are already basic, and
 * listing them here would misreport a message as Turkish (150) when the
 * account would in fact send it as English (155).
 */
const TURKISH_EXTRA = new Set('çğĞıİşŞ'.split(''));

/**
 * Measure a message: which alphabet it needs, how many characters that makes
 * it, and how many segments İletiMerkezi will bill.
 *
 * Counting rule differs by mode on purpose. UCS-2 addresses 16-bit units, so an
 * emoji outside the BMP genuinely costs 2 — `text.length` is correct there.
 * The GSM modes are all BMP, where code points are the honest unit.
 */
export function smsSegments(text: string): SmsLength {
  const codePoints = [...text];

  const outside = codePoints.filter((c) => !GSM7_BASIC.has(c) && !TURKISH_EXTRA.has(c));
  const encoding: SmsEncoding = outside.length
    ? 'UNICODE'
    : codePoints.some((c) => TURKISH_EXTRA.has(c))
      ? 'TURKISH'
      : 'GSM7';

  const chars = encoding === 'UNICODE' ? text.length : codePoints.length;

  const band = LIMITS[encoding];
  const single = band.single - OPERATOR_CODE_RESERVE;
  const multi = band.multi - OPERATOR_CODE_RESERVE;

  const segments = chars === 0 ? 0 : chars <= single ? 1 : Math.ceil(chars / multi);

  // Headroom to the NEXT boundary, which is the single limit while we are still
  // in one segment and the running multipart total once we are past it.
  const boundary = segments <= 1 ? single : segments * multi;

  return {
    encoding,
    chars,
    segments,
    limit: single,
    remaining: boundary - chars,
    forcedUnicodeBy: [...new Set(outside)].join(''),
  };
}

const ENCODING_LABELS: Record<SmsEncoding, string> = {
  GSM7: 'İngilizce',
  TURKISH: 'Türkçe',
  UNICODE: 'Unicode',
};

/** Turkish label for an encoding, for the template editor's live counter. */
export function encodingLabel(encoding: SmsEncoding): string {
  return ENCODING_LABELS[encoding];
}

/**
 * True when the message tipped into Unicode because of an emoji or a non-Latin
 * character. This is the expensive mistake — it cuts the limit from 150 to 65
 * and typically triples the cost — so the editor must call it out loudly rather
 * than just showing a number that went up.
 */
export function isUnicodePenalty(m: SmsLength): boolean {
  return m.encoding === 'UNICODE';
}
