/**
 * Payment status of a reservation — how much has been collected against its
 * total — plus the colours that represent it.
 *
 * Single source for every surface that shows it (the Liste badges + filters and
 * the Takvim bar lines), so a stay can never read "Ödeme Alınmadı" in one view
 * and something else in another.
 */

export type PaymentState = 'none' | 'partial' | 'full' | 'over';

/**
 * A small epsilon absorbs float rounding so an exact-amount payment reads as
 * fully paid rather than "kısmi" or "fazladan".
 */
export function paymentState(paid: number, total: number): PaymentState {
  if (paid <= 0) return 'none';
  if (paid < total - 0.005) return 'partial';
  if (paid > total + 0.005) return 'over';
  return 'full';
}

/**
 * Label + badge colours per state. Nothing-collected is red (matching the İptal
 * status badge) while a partial payment is amber — the two used to share amber
 * and were distinguishable only by reading the text.
 */
export const PAYMENT_META: Record<PaymentState, { label: string; className: string }> = {
  none: {
    label: 'Ödeme Alınmadı',
    className:
      'rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-900/40 dark:text-red-300',
  },
  partial: {
    label: 'Kısmi Ödeme Alındı',
    className:
      'rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  },
  full: {
    label: 'Ödeme Alındı',
    className:
      'rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  },
  over: {
    label: 'Fazladan Ödeme Alındı',
    className:
      'rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  },
};

/**
 * Solid fills for the thin line drawn under a Takvim bar. Same hues as the
 * badges above, but saturated instead of pale: these sit ON a status-coloured
 * bar (amber-500 / sky-500 / emerald-600 / stone-400), so they need to carry on
 * a strong background rather than blend into it.
 *
 * The shades are chosen so a line never disappears into a bar of its own hue —
 * amber-300 on an amber-500 "Beklemede" bar and sky-300 on a sky-500 "Yakında"
 * bar both stay clearly lighter than what they sit on. Cancelled stays never
 * reach the Gantt, so red-on-red is not a case.
 */
export const PAYMENT_LINE: Record<PaymentState, string> = {
  none: 'bg-red-500',
  partial: 'bg-amber-300',
  full: 'bg-green-400',
  over: 'bg-sky-300',
};
