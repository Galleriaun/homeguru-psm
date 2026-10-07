// Fixture for src/lib/paymentStatus.ts — imports the REAL module.
// Run: node tests/paymentStatus.check.mjs
import { createHarness } from './support/harness.mjs';

const { paymentState, PAYMENT_META, PAYMENT_LINE } = await import(
  new URL('../src/lib/paymentStatus.ts', import.meta.url).href
);
const { eq, ok, done } = createHarness('paymentStatus');

const show = (v) => (typeof v === 'string' ? `'${v}'` : String(v));

// [paid, total, expected]
const cases = [
  // nothing collected
  [0, 12000, 'none'],
  [-5, 12000, 'none'],
  [null, 12000, 'none'], // Number(null) is 0
  ['0', '12000', 'none'],
  [0, 0, 'none'],

  // partial, and the epsilon boundary below the total
  [1, 12000, 'partial'],
  [11999.99, 12000, 'partial'],
  [11999.996, 12000, 'full'],

  // exact, and the epsilon boundary above the total
  [12000, 12000, 'full'],
  [12000.004, 12000, 'full'],
  [12000.01, 12000, 'over'],
  [15000, 12000, 'over'],

  // total_amount as PostgREST may deliver a numeric: a STRING. Uncoerced,
  // '12000' + 0.005 concatenates and an overpayment reads as 'full'.
  [6000, '12000', 'partial'],
  [12000, '12000', 'full'],
  [12000, '12000.00', 'full'],
  [15000, '12000', 'over'],
  [15000, '12000.00', 'over'],
  [12000.01, '12000.00', 'over'],
  ['15000', 12000, 'over'],
  ['6000', '12000', 'partial'],

  // a zero / missing total with money collected is an overpayment
  [100, 0, 'over'],
  [100, null, 'over'],

  // UNREADABLE figures must never read as "Ödeme Alındı" (or anything else):
  // the state is unknown, so no badge is drawn.
  [NaN, 12000, null],
  [undefined, 12000, null],
  [100, undefined, null],
  [100, NaN, null],
  [100, '12.000,00', null],
  ['abc', 12000, null],
  [Infinity, 12000, null],
  [100, Infinity, null],
  [0, NaN, null], // even "nothing paid" is not claimed against an unreadable total
];

for (const [paid, total, expected] of cases) {
  eq(paymentState(paid, total), expected, `paymentState(${show(paid)}, ${show(total)})`);
}

// Every state the function can return has a badge and a calendar line.
for (const state of ['none', 'partial', 'full', 'over']) {
  ok(PAYMENT_META[state] && PAYMENT_META[state].label, `PAYMENT_META has ${state}`);
  ok(PAYMENT_LINE[state], `PAYMENT_LINE has ${state}`);
}

done();
