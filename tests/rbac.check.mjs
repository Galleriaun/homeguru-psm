// Fixture for src/lib/rbac.ts — imports the REAL module.
// Run: node tests/rbac.check.mjs
import { createHarness } from './support/harness.mjs';

const { can, canCollectPayment, ledgerAccess, paymentCollectUi } = await import(
  new URL('../src/lib/rbac.ts', import.meta.url).href
);
const { eq, ok, done } = createHarness('rbac');

const ROLES = [
  'SUPER_ADMIN',
  'PROPERTY_MANAGER',
  'YONETICI_BORNOVA',
  'RECEPTION',
  'HOUSEKEEPING',
  'PENDING',
  'YETKILI',
  'PERSONEL_BORNOVA',
  'TEKNIK_PERSONEL',
];

const PERMISSIONS = [
  'reservation:create',
  'reservation:read',
  'reservation:update',
  'reservation:cancel',
  'reservation:delete',
  'guest:read',
  'guest:create',
  'guest:update',
  'guest:delete',
  'finance:read',
  'finance:write',
  'staff:read',
  'staff:write',
  'housekeeping:read',
  'housekeeping:write',
  'issue:write',
  'payment:collect',
  'report:property',
  'report:all',
  'ledger:read',
  'admin:*',
];

// ── 1. The whole permission table ────────────────────────────────────────────
// Every cell is pinned, not only the new one: adding 'ledger:read' must not
// move anything else. The three Personel roles in particular must stay out of
// finance:* — that is what keeps Kasa, CSV İndir and + Ekstra Ücret closed.

const RESERVATIONS_AND_GUESTS = [
  'reservation:create',
  'reservation:read',
  'reservation:update',
  'reservation:cancel',
  'reservation:delete',
  'guest:read',
  'guest:create',
  'guest:update',
];
const OPERATIONS = [
  'housekeeping:read',
  'housekeeping:write',
  'issue:write',
  'payment:collect',
  'report:property',
];
const MANAGER = [
  ...RESERVATIONS_AND_GUESTS,
  ...OPERATIONS,
  'finance:read',
  'finance:write',
  'staff:read',
  'staff:write',
  'ledger:read',
];
const PERSONEL = [...RESERVATIONS_AND_GUESTS, ...OPERATIONS, 'ledger:read'];

const GRANTED = {
  SUPER_ADMIN: PERMISSIONS, // can() short-circuits to true for everything
  PROPERTY_MANAGER: MANAGER,
  YONETICI_BORNOVA: MANAGER,
  RECEPTION: RESERVATIONS_AND_GUESTS,
  HOUSEKEEPING: ['housekeeping:read', 'housekeeping:write', 'issue:write'],
  PENDING: [],
  YETKILI: PERSONEL,
  PERSONEL_BORNOVA: PERSONEL,
  TEKNIK_PERSONEL: PERSONEL,
};

for (const role of ROLES) {
  for (const permission of PERMISSIONS) {
    eq(can(role, permission), GRANTED[role].includes(permission), `can(${role}, ${permission})`);
  }
}

// ── 2. Cari Hesap on the reservation screen ─────────────────────────────────
// view        → the section itself (totals, balance, movements)
// exportCsv   → CSV İndir
// addCharge   → + Ekstra Ücret
// lock           → Hesabı Kilitle / Kilidi Aç
// deleteEntry    → the per-row delete
// approvalStatus → whether a payment is approved or still waiting: the
//                  "(onaylandı)" wording, the "Onay bekliyor" mark and the
//                  separate "Onay bekleyen" total
const access = (view, exportCsv, addCharge, lock, deleteEntry, approvalStatus) => ({
  view,
  exportCsv,
  addCharge,
  lock,
  deleteEntry,
  approvalStatus,
});
const Y = true;
const N = false;

const LEDGER = {
  SUPER_ADMIN: access(Y, Y, Y, Y, Y, Y),
  PROPERTY_MANAGER: access(Y, Y, Y, N, N, Y),
  YONETICI_BORNOVA: access(Y, Y, Y, N, N, Y),
  // Read-only: the section is visible, none of its controls are — and they see
  // every payment the same way, approved or not (owner rule, 2026-10-06).
  YETKILI: access(Y, N, N, N, N, N),
  PERSONEL_BORNOVA: access(Y, N, N, N, N, N),
  TEKNIK_PERSONEL: access(Y, N, N, N, N, N),
  RECEPTION: access(N, N, N, N, N, N),
  HOUSEKEEPING: access(N, N, N, N, N, N),
  PENDING: access(N, N, N, N, N, N),
};

ok(typeof ledgerAccess === 'function', 'ledgerAccess is exported from rbac.ts');

for (const role of ROLES) {
  const actual = typeof ledgerAccess === 'function' ? ledgerAccess(role) : {};
  const expected = LEDGER[role];
  for (const key of Object.keys(expected)) {
    eq(actual[key], expected[key], `ledgerAccess(${role}).${key}`);
  }
  // No extra switches: a key the screen does not know about would be dead weight,
  // and a renamed one would leave the screen reading undefined (= hidden).
  eq(
    Object.keys(actual).sort().join(','),
    Object.keys(expected).sort().join(','),
    `ledgerAccess(${role}) keys`,
  );
}

// ── 3. Ödeme Topla — untouched by this change, pinned so it stays that way ───
const COLLECT = {
  SUPER_ADMIN: [Y, Y],
  PROPERTY_MANAGER: [Y, Y],
  YONETICI_BORNOVA: [Y, Y],
  YETKILI: [Y, Y],
  PERSONEL_BORNOVA: [Y, Y],
  TEKNIK_PERSONEL: [Y, Y],
  RECEPTION: [Y, N], // hotels only
  HOUSEKEEPING: [N, Y], // apartments only
  PENDING: [N, N],
};

for (const role of ROLES) {
  const [hotel, apartment] = COLLECT[role];
  eq(canCollectPayment(role, 'HOTEL'), hotel, `canCollectPayment(${role}, HOTEL)`);
  eq(canCollectPayment(role, 'APARTMENT'), apartment, `canCollectPayment(${role}, APARTMENT)`);
}

// ── 4. The Ödeme Topla dialog ────────────────────────────────────────────────
// approvalNotice → the amber note "Onaylar bölümünde … beklemede kalacak.
//                  Onaylanana kadar kasa ve cari hesaba işlenmez."
// confirmFirst   → ask "Tahsilat yapılsın mı?" before the payment is sent
//
// Owner rule (2026-10-07): the three Personel roles are not told about approval
// — for them the note would also contradict the Cari Hesap they see, where the
// payment appears at once. They get the confirmation question instead. Every
// other role keeps the dialog exactly as it was: the note, and no question.
const DIALOG = {
  SUPER_ADMIN: { approvalNotice: Y, confirmFirst: N },
  PROPERTY_MANAGER: { approvalNotice: Y, confirmFirst: N },
  YONETICI_BORNOVA: { approvalNotice: Y, confirmFirst: N },
  YETKILI: { approvalNotice: N, confirmFirst: Y },
  PERSONEL_BORNOVA: { approvalNotice: N, confirmFirst: Y },
  TEKNIK_PERSONEL: { approvalNotice: N, confirmFirst: Y },
  RECEPTION: { approvalNotice: Y, confirmFirst: N },
  HOUSEKEEPING: { approvalNotice: Y, confirmFirst: N },
  PENDING: { approvalNotice: Y, confirmFirst: N },
};

ok(typeof paymentCollectUi === 'function', 'paymentCollectUi is exported from rbac.ts');

for (const role of ROLES) {
  const actual = typeof paymentCollectUi === 'function' ? paymentCollectUi(role) : {};
  const expected = DIALOG[role];
  eq(actual.approvalNotice, expected.approvalNotice, `paymentCollectUi(${role}).approvalNotice`);
  eq(actual.confirmFirst, expected.confirmFirst, `paymentCollectUi(${role}).confirmFirst`);
  eq(Object.keys(actual).sort().join(','), 'approvalNotice,confirmFirst', `paymentCollectUi(${role}) keys`);
  // Never both and never neither: a role is either told about approval, or is
  // asked to confirm. Both would repeat the question; neither would send the
  // payment on a single tap with no explanation.
  ok(
    actual.approvalNotice !== actual.confirmFirst,
    `paymentCollectUi(${role}): exactly one of the note and the question`,
  );
  // The dialog and the Cari Hesap section must agree: whoever reads the cari
  // without approval status is never shown the approval note either.
  const cari = typeof ledgerAccess === 'function' ? ledgerAccess(role) : {};
  if (cari.view && !cari.approvalStatus) {
    eq(actual.approvalNotice, false, `${role}: reads the cari without approval status → no approval note in the dialog`);
  }
}

done();
