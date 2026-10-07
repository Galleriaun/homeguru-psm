// Fixture for src/lib/cariHesap.ts — imports the REAL module.
// Run: node tests/cariHesap.check.mjs
//
// What the Cari Hesap section of a reservation shows, for the two kinds of
// viewer (owner rules, 2026-10-06):
//
//   showApproval = true   Yönetici, Alt Yönetici, Yönetici Bornova.
//       Pending payments are listed and marked; they are summed on their own
//       line and stay OUT of Toplam Ödeme and Bakiye.
//
//   showApproval = false  Personel, Personel Bornova, Teknik Personel.
//       Pending and approved payments are listed and look identical. Both count
//       in Toplam Ödeme and Bakiye. Nothing may say or imply which is which.
import './support/alias.mjs';
import { createHarness, id } from './support/harness.mjs';

const { buildCariView } = await import(new URL('../src/lib/cariHesap.ts', import.meta.url).href);
const { ok, eq, done } = createHarness('cariHesap');

const T = (minutes) => new Date(Date.parse('2026-10-06T08:00:00Z') + minutes * 60000).toISOString();
const MANAGER = true;
const PERSONEL = false;

/** What a viewer can actually see of a row (everything except internals). */
const visible = (row) => ({
  kind: row.kind,
  amount: row.amount,
  at: row.at,
  description: row.description,
  pending: row.pending,
  system: row.system,
});
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const saysApproval = (text) => /onay/i.test(text);

// ── The owner's example ──────────────────────────────────────────────────────
// ₺7.500 charge, ₺2.000 cash already approved, ₺3.000 transfer still waiting.
const debt = {
  id: id(1),
  type: 'DEBT',
  amount: 7500,
  note: 'Otomatik borçlandırma (giriş)',
  created_at: T(0),
  created_by: null,
  payment_collection_id: null,
  payment_collection: null,
};
const cashApproved = {
  id: id(2),
  type: 'PAYMENT',
  amount: 2000,
  note: 'Ödeme — CASH (onaylandı)',
  created_at: T(30), // the moment a manager approved it
  created_by: id(900),
  payment_collection_id: id(102),
  payment_collection: { method: 'CASH', created_at: T(10) }, // the moment it was collected
};
const transferPending = { id: id(103), amount: 3000, method: 'TRANSFER', created_at: T(40) };

// ── 1. Manager view ──────────────────────────────────────────────────────────
{
  const v = buildCariView([cashApproved, debt], [transferPending], MANAGER);

  eq(v.totalDebt, 7500, 'manager: Toplam Ücret');
  eq(v.totalPayment, 2000, 'manager: Toplam Ödeme counts approved payments only');
  eq(v.pendingTotal, 3000, 'manager: Onay bekleyen is the pending sum');
  eq(v.balance, 5500, 'manager: Bakiye ignores the pending payment');
  eq(v.methods.join(','), 'CASH', 'manager: method chips come from approved payments only');

  eq(v.rows.length, 3, 'manager: three rows');
  const [first, second, third] = v.rows;

  eq(first.kind, 'PAYMENT', 'manager: newest row is the pending transfer');
  eq(first.pending, true, 'manager: the pending transfer is marked pending');
  eq(first.amount, 3000, 'manager: pending amount');
  eq(first.at, T(40), 'manager: pending row is dated when it was collected');
  eq(first.description, 'Ödeme — Havale/EFT', 'manager: pending description, method in Turkish');
  eq(first.entry, null, 'manager: a pending payment has no ledger row behind it (nothing to delete)');
  eq(first.system, false, 'manager: a pending payment is not a system row');

  eq(second.pending, false, 'manager: the approved payment is not pending');
  eq(second.description, 'Ödeme — Nakit (onaylandı)', 'manager: approved wording is kept as today');
  eq(second.at, T(30), 'manager: approved row keeps its ledger date (unchanged from today)');
  eq(second.entry, cashApproved, 'manager: approved row carries its ledger entry (for delete)');

  eq(third.kind, 'DEBT', 'manager: the charge is last');
  eq(third.amount, 7500, 'manager: charge amount');
  eq(third.system, true, 'manager: a charge with no author is a system row');
  eq(third.pending, false, 'manager: a charge is never pending');
  eq(third.description, 'Otomatik borçlandırma (giriş)', 'manager: charge description untouched');
}

// ── 2. Personel view ─────────────────────────────────────────────────────────
{
  const v = buildCariView([cashApproved, debt], [transferPending], PERSONEL);

  eq(v.totalDebt, 7500, 'personel: Toplam Ücret');
  eq(v.totalPayment, 5000, 'personel: Toplam Ödeme counts approved AND pending');
  eq(v.pendingTotal, 0, 'personel: there is no separate pending sum to show');
  eq(v.balance, 2500, 'personel: Bakiye counts the pending payment');
  eq(v.methods.join(','), 'TRANSFER,CASH', 'personel: method chips cover every listed payment');

  eq(v.rows.length, 3, 'personel: three rows');
  const [first, second, third] = v.rows;

  eq(first.description, 'Ödeme — Havale/EFT', 'personel: the pending transfer reads as a plain payment');
  eq(first.at, T(40), 'personel: pending row dated when collected');
  eq(second.description, 'Ödeme — Nakit', 'personel: "(onaylandı)" is removed from the approved payment');
  eq(second.at, T(10), 'personel: approved row is dated when COLLECTED, not when approved');
  eq(third.description, 'Otomatik borçlandırma (giriş)', 'personel: charge description untouched');

  ok(v.rows.every((r) => r.pending === false), 'personel: no row is ever marked pending');
  ok(v.rows.every((r) => !saysApproval(r.description)), 'personel: no description mentions approval');
  // Same shape for both payments: nothing structural tells them apart either.
  eq(
    Object.keys(visible(first)).join(','),
    Object.keys(visible(second)).join(','),
    'personel: the two payment rows have the same visible fields',
  );
}

// ── 3. THE rule: approving a payment changes nothing a Personel can see ──────
// Before: the transfer is pending. After: a manager approved it, so it is now a
// ledger row with the "(onaylandı)" note and the approval timestamp, and the
// pending list is empty. Rejecting is different — see section 4.
{
  const transferApproved = {
    id: id(3),
    type: 'PAYMENT',
    amount: 3000,
    note: 'Ödeme — TRANSFER (onaylandı)',
    created_at: T(90), // approved 50 minutes after it was collected
    created_by: id(900),
    payment_collection_id: transferPending.id,
    payment_collection: { method: 'TRANSFER', created_at: transferPending.created_at },
  };
  const before = buildCariView([cashApproved, debt], [transferPending], PERSONEL);
  const after = buildCariView([transferApproved, cashApproved, debt], [], PERSONEL);

  ok(same(before.rows.map(visible), after.rows.map(visible)), 'invisible approval: rows read the same before and after');
  ok(same(before.rows.map((r) => r.key), after.rows.map((r) => r.key)), 'invisible approval: row keys are stable too (no flicker / reorder)');
  eq(after.totalDebt, before.totalDebt, 'invisible approval: Toplam Ücret unchanged');
  eq(after.totalPayment, before.totalPayment, 'invisible approval: Toplam Ödeme unchanged');
  eq(after.balance, before.balance, 'invisible approval: Bakiye unchanged');
  eq(after.pendingTotal, 0, 'invisible approval: still no pending sum');
  eq(after.methods.join(','), before.methods.join(','), 'invisible approval: method chips unchanged');

  // The manager, by contrast, must see exactly that change.
  const mBefore = buildCariView([cashApproved, debt], [transferPending], MANAGER);
  const mAfter = buildCariView([transferApproved, cashApproved, debt], [], MANAGER);
  eq(mBefore.totalPayment, 2000, 'manager before approval: Toplam Ödeme 2.000');
  eq(mAfter.totalPayment, 5000, 'manager after approval: Toplam Ödeme 5.000');
  eq(mBefore.pendingTotal, 3000, 'manager before approval: 3.000 waiting');
  eq(mAfter.pendingTotal, 0, 'manager after approval: nothing waiting');
  eq(mAfter.balance, 2500, 'manager after approval: Bakiye 2.500');
  ok(mAfter.rows.every((r) => r.pending === false), 'manager after approval: no pending mark left');

  // The two views agree on the money once nothing is waiting.
  eq(mAfter.totalPayment, after.totalPayment, 'both views agree once everything is approved');
  eq(mAfter.balance, after.balance, 'both views agree on Bakiye once everything is approved');
}

// ── 4. A rejected payment is in neither list, so it is simply not there ──────
{
  const m = buildCariView([cashApproved, debt], [], MANAGER);
  const p = buildCariView([cashApproved, debt], [], PERSONEL);
  eq(m.rows.length, 2, 'rejected: manager sees two rows');
  eq(p.rows.length, 2, 'rejected: personel sees two rows');
  eq(p.totalPayment, 2000, 'rejected: personel total drops back to the approved 2.000');
  eq(p.balance, 5500, 'rejected: personel Bakiye is the full remaining debt');
}

// ── 5. Never count a payment twice ───────────────────────────────────────────
// The two lists are loaded by two requests. If a manager approves in between,
// the same payment can arrive BOTH as a ledger row and still as "pending".
{
  const approved = {
    id: id(3),
    type: 'PAYMENT',
    amount: 3000,
    note: 'Ödeme — TRANSFER (onaylandı)',
    created_at: T(90),
    created_by: id(900),
    payment_collection_id: transferPending.id,
    payment_collection: { method: 'TRANSFER', created_at: T(40) },
  };
  for (const [name, flag] of [['manager', MANAGER], ['personel', PERSONEL]]) {
    const v = buildCariView([approved, debt], [transferPending], flag);
    eq(v.rows.filter((r) => r.kind === 'PAYMENT').length, 1, `${name}: a payment seen in both lists is listed once`);
    eq(v.totalPayment, 3000, `${name}: …and counted once`);
    eq(v.pendingTotal, 0, `${name}: …as approved, not as pending`);
    eq(v.balance, 4500, `${name}: Bakiye after the single count`);
  }
  // A pending payment listed twice by mistake is also counted once.
  const twice = buildCariView([debt], [transferPending, { ...transferPending }], PERSONEL);
  eq(twice.totalPayment, 3000, 'a pending payment repeated in the list is counted once');
  eq(twice.rows.length, 2, 'a pending payment repeated in the list is shown once');
}

// ── 6. Money is exact ────────────────────────────────────────────────────────
{
  // 0.1 + 0.2 - 0.3 is 5.5e-17 in floating point; the screen would then call a
  // settled account "Misafir borçlu".
  const rows = [
    { id: id(1), type: 'DEBT', amount: 0.1, note: 'a', created_at: T(0), created_by: id(900) },
    { id: id(2), type: 'DEBT', amount: 0.2, note: 'b', created_at: T(1), created_by: id(900) },
    { id: id(3), type: 'PAYMENT', amount: 0.3, note: 'Ödeme — CASH (onaylandı)', created_at: T(2), created_by: id(900) },
  ];
  const v = buildCariView(rows, [], MANAGER);
  eq(v.totalDebt, 0.3, 'exact: 0.10 + 0.20 is 0.30');
  eq(v.balance, 0, 'exact: a settled account is exactly zero');

  // PostgREST may hand a numeric over as a string.
  const s = buildCariView(
    [{ ...debt, amount: '7500.00' }, { ...cashApproved, amount: '2000.00' }],
    [{ ...transferPending, amount: '3000.00' }],
    PERSONEL,
  );
  eq(s.totalDebt, 7500, 'string amounts: Toplam Ücret');
  eq(s.totalPayment, 5000, 'string amounts: Toplam Ödeme');
  eq(s.balance, 2500, 'string amounts: Bakiye');
  eq(s.rows[0].amount, 3000, 'string amounts: row amount is a number');

  // Overpaid: Bakiye goes negative (the screen shows "Misafirden Alındı").
  const over = buildCariView([{ ...debt, amount: 1000 }], [transferPending], PERSONEL);
  eq(over.balance, -2000, 'overpaid: negative Bakiye');
  const overM = buildCariView([{ ...debt, amount: 1000 }], [transferPending], MANAGER);
  eq(overM.balance, 1000, 'manager: an unapproved payment cannot settle or overpay the account');

  // An unreadable amount must never become a number on a money screen.
  for (const bad of [null, undefined, 'abc', NaN, Infinity, '']) {
    let threw = '';
    try {
      buildCariView([{ ...debt, amount: bad }], [], MANAGER);
    } catch (e) {
      threw = String(e && e.message);
    }
    ok(/tutar/i.test(threw), `unreadable ledger amount (${String(bad)}) throws instead of showing a number`);
    threw = '';
    try {
      buildCariView([debt], [{ ...transferPending, amount: bad }], PERSONEL);
    } catch (e) {
      threw = String(e && e.message);
    }
    ok(/tutar/i.test(threw), `unreadable pending amount (${String(bad)}) throws instead of showing a number`);
  }
}

// ── 7. Descriptions ──────────────────────────────────────────────────────────
{
  const row = (note, extra = {}) => ({
    id: id(50),
    type: 'PAYMENT',
    amount: 100,
    note,
    created_at: T(5),
    created_by: id(900),
    payment_collection_id: null,
    payment_collection: null,
    ...extra,
  });
  const describe = (note, flag) => buildCariView([row(note)], [], flag).rows[0].description;

  // Older rows (before approvals existed) carry no marker, or a hand-written note.
  eq(describe('Ödeme — CARD', PERSONEL), 'Ödeme — Kart', 'personel: legacy note without a marker');
  eq(describe('Ödeme — CARD', MANAGER), 'Ödeme — Kart', 'manager: legacy note without a marker');
  eq(describe('Kapora elden alındı', PERSONEL), 'Kapora elden alındı', 'personel: a hand-written note is left alone');
  eq(describe('Kapora elden alındı', MANAGER), 'Kapora elden alındı', 'manager: a hand-written note is left alone');
  eq(describe(null, PERSONEL), '—', 'personel: a missing note shows a dash');
  eq(describe(null, MANAGER), '—', 'manager: a missing note shows a dash');

  // Every spelling of the marker is removed for a Personel, wherever it sits.
  for (const note of [
    'Ödeme — TRANSFER (onaylandı)',
    'Ödeme — TRANSFER (Onaylandı)',
    'Ödeme — TRANSFER (ONAYLANDI)',
    'Ödeme — TRANSFER (onaylandi)',
    'Ödeme — TRANSFER(onaylandı)',
    'Ödeme — TRANSFER  (onaylandı)  ',
    'Ödeme — TRANSFER (onaylanmadı)',
    'Ödeme — TRANSFER (onay bekliyor)',
    'Ödeme — TRANSFER (Onay Bekliyor)',
  ]) {
    eq(describe(note, PERSONEL), 'Ödeme — Havale/EFT', `personel: marker removed from "${note}"`);
  }
  eq(
    describe('Ödeme — CASH (onaylandı) — ön ödeme', PERSONEL),
    'Ödeme — Nakit — ön ödeme',
    'personel: marker removed from the middle, the rest kept',
  );
  // A charge is not a payment: its text is never rewritten.
  const charge = buildCariView(
    [{ ...row('Ekstra: minibar (onaylandı)'), type: 'DEBT' }],
    [],
    PERSONEL,
  ).rows[0];
  eq(charge.description, 'Ekstra: minibar (onaylandı)', 'personel: a charge keeps its text verbatim');
}

// ── 8. Dates, order and odd rows ─────────────────────────────────────────────
{
  // An approved payment with no linked collection (very old rows): the ledger
  // date is all there is, for both viewers.
  const old = {
    id: id(7),
    type: 'PAYMENT',
    amount: 500,
    note: 'Ödeme — CASH',
    created_at: T(20),
    created_by: id(900),
    payment_collection_id: null,
    payment_collection: null,
  };
  eq(buildCariView([old], [], PERSONEL).rows[0].at, T(20), 'personel: no collection → ledger date');
  eq(buildCariView([old], [], MANAGER).rows[0].at, T(20), 'manager: no collection → ledger date');
  // A linked collection whose date did not come along: fall back, never blank.
  const noDate = { ...cashApproved, payment_collection: { method: 'CASH' } };
  eq(buildCariView([noDate], [], PERSONEL).rows[0].at, T(30), 'personel: collection without a date → ledger date');

  // Newest first, whatever order the two lists arrive in.
  const a = { ...transferPending, id: id(201), created_at: T(5) };
  const b = { ...transferPending, id: id(202), created_at: T(100) };
  const v = buildCariView([debt, cashApproved], [a, b], MANAGER);
  eq(v.rows.map((r) => r.at).join('|'), [T(100), T(30), T(5), T(0)].join('|'), 'rows are newest first across both lists');
  // Same instant: a fixed order, so the list never shuffles between renders.
  const tieA = { ...transferPending, id: id(301), created_at: T(50) };
  const tieB = { ...transferPending, id: id(302), created_at: T(50) };
  const order1 = buildCariView([], [tieA, tieB], PERSONEL).rows.map((r) => r.key).join('|');
  const order2 = buildCariView([], [tieB, tieA], PERSONEL).rows.map((r) => r.key).join('|');
  eq(order1, order2, 'rows at the same instant keep one fixed order');
  eq(new Set(v.rows.map((r) => r.key)).size, v.rows.length, 'row keys are unique');

  // Nothing at all.
  const empty = buildCariView([], [], MANAGER);
  eq(empty.rows.length, 0, 'empty: no rows');
  eq(empty.totalDebt + empty.totalPayment + empty.pendingTotal + empty.balance, 0, 'empty: every figure is zero');

  // Only a pending payment, no charge yet.
  const onlyPendingM = buildCariView([], [transferPending], MANAGER);
  eq(onlyPendingM.balance, 0, 'manager: a pending payment alone leaves Bakiye at zero');
  eq(onlyPendingM.pendingTotal, 3000, 'manager: …and shows as waiting');
  const onlyPendingP = buildCariView([], [transferPending], PERSONEL);
  eq(onlyPendingP.balance, -3000, 'personel: a payment alone reads as "Misafirden Alındı"');

  // The inputs are not modified.
  const ledgerIn = [cashApproved, debt];
  const pendingIn = [transferPending];
  const snapshot = JSON.stringify([ledgerIn, pendingIn]);
  buildCariView(ledgerIn, pendingIn, PERSONEL);
  buildCariView(ledgerIn, pendingIn, MANAGER);
  eq(JSON.stringify([ledgerIn, pendingIn]), snapshot, 'inputs are left untouched');
  eq(ledgerIn[0], cashApproved, 'input order is left untouched');
}

done();
