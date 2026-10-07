import type { Role, PropertyType } from '@/types/database';

/**
 * RBAC permission checks. These MUST be mirrored on the server side
 * (RLS policies + Edge Function checks). The client side checks here
 * are for UX only — they hide UI but cannot enforce security.
 */

export type Permission =
  | 'reservation:create'
  | 'reservation:read'
  | 'reservation:update'
  | 'reservation:cancel'
  | 'reservation:delete'
  | 'guest:read'
  | 'guest:create'
  | 'guest:update'
  | 'guest:delete'
  | 'finance:read'
  | 'finance:write'
  // Read a reservation's cari hesap (totals, balance, movements). Split from
  // finance:read so a Personel can see what a guest owes WITHOUT getting the
  // kasa, the CSV export or any way to change the account. Server side this is
  // the ledger_select policy (migration 144).
  | 'ledger:read'
  | 'staff:read'
  | 'staff:write'
  | 'housekeeping:read'
  | 'housekeeping:write'
  // Report / resolve housekeeping issues. Split from housekeeping:write so a
  // technical role can file issues WITHOUT being able to change cleaning status.
  | 'issue:write'
  | 'payment:collect'
  | 'report:property'
  | 'report:all'
  | 'admin:*';

// A (property) manager's permission set. Shared by PROPERTY_MANAGER and the
// region yönetici YONETICI_BORNOVA so the two can never drift apart.
const MANAGER_PERMS: Permission[] = [
  'reservation:create',
  'reservation:read',
  'reservation:update',
  'reservation:cancel',
  'reservation:delete',
  'guest:read',
  'guest:create',
  'guest:update',
  'finance:read',
  'finance:write',
  'ledger:read',
  'staff:read',
  'staff:write',
  'housekeeping:read',
  'housekeeping:write',
  'issue:write',
  'payment:collect',
  'report:property',
];

// A branch operator's permission set. Shared by YETKILI and the region personel
// PERSONEL_BORNOVA so the two can never drift apart.
const PERSONEL_PERMS: Permission[] = [
  'reservation:create',
  'reservation:read',
  'reservation:update',
  'reservation:cancel',
  'reservation:delete',
  'guest:read',
  'guest:create',
  'guest:update',
  'ledger:read',
  'housekeeping:read',
  'housekeeping:write',
  'issue:write',
  'payment:collect',
  'report:property',
];

const BASE: Record<Role, Permission[]> = {
  SUPER_ADMIN: ['admin:*'],
  PROPERTY_MANAGER: MANAGER_PERMS,
  YONETICI_BORNOVA: MANAGER_PERMS,
  RECEPTION: [
    'reservation:create',
    'reservation:read',
    'reservation:update',
    'reservation:cancel',
    'reservation:delete',
    'guest:read',
    'guest:create',
    'guest:update',
  ],
  HOUSEKEEPING: ['housekeeping:read', 'housekeeping:write', 'issue:write'],
  // New-signup holding role. Zero permissions and in no RLS allow-list — the
  // account is inert until a SUPER_ADMIN promotes it to a real role.
  PENDING: [],
  // Branch operator — full operations within own branch, no finance/staff/admin.
  // Payment collection is allowed; the DB RPC creates UNCONFIRMED rows that a
  // manager confirms (since YETKILI has no finance:write).
  YETKILI: PERSONEL_PERMS,
  // Region personel — a Personel scoped to the Bornova region (region scoping is
  // enforced server-side via auth_region()). Same permission set as YETKILI.
  PERSONEL_BORNOVA: PERSONEL_PERMS,
  // Technical staff. As of migration 139 this is a FULL Personel — identical
  // permissions to YETKILI. It was deliberately narrow before (read-only Liste +
  // issue reporting); the owner widened it on 2026-08-19.
  //
  // Two things that are NOT permissions still make it special, and both are
  // enforced server-side on the RAW role, so they survive this:
  //   * it sees every property in EVERY region (auth_sees_property bypass, 117)
  //   * its maaş/avans come out of the Bornova kasa (staff_region, 120)
  TEKNIK_PERSONEL: PERSONEL_PERMS,
};

/**
 * The base role a region-scoped role acts as for permission checks. The Bornova
 * variants behave exactly as their base role; region scoping is enforced on the
 * server (auth_region() + RLS), so client permission gates treat them as the
 * base role. Use this anywhere a role is compared for permissions.
 */
export function baseRole(role: Role | undefined): Role | undefined {
  if (role === 'YONETICI_BORNOVA') return 'PROPERTY_MANAGER';
  if (role === 'PERSONEL_BORNOVA') return 'YETKILI';
  // Mirrors auth_role() in migration 139 exactly. Teknik is not region-scoped —
  // it sees every region — but for permission purposes it acts as a Personel.
  // Keeping this in step with the server matters: if the two ever disagree, the
  // UI offers actions RLS then refuses, or hides ones the user is entitled to.
  if (role === 'TEKNIK_PERSONEL') return 'YETKILI';
  return role;
}

export function can(role: Role, permission: Permission): boolean {
  if (role === 'SUPER_ADMIN') return true;
  return BASE[role].includes(permission);
}

// isTeknikPersonel() was removed in migration 139. It existed to hide the UI
// surfaces the narrow technical role must not see — guest/property nav,
// availability/calendar tools, payment amounts, the cleaning-status chips. Teknik
// is a full Personel now, so there is nothing left to hide and every call site's
// condition was vacuous. Gate on a permission via can(), never on a role literal.

/**
 * Property-type-conditional permissions.
 * The most important: housekeepers collect payment ONLY in APARTMENT properties.
 * Reception collects payment ONLY in HOTEL properties.
 */
export function canCollectPayment(role: Role, propertyType: PropertyType): boolean {
  const r = baseRole(role);
  if (r === 'SUPER_ADMIN' || r === 'PROPERTY_MANAGER') return true;
  if (r === 'YETKILI') return true; // both property types
  if (r === 'RECEPTION' && propertyType === 'HOTEL') return true;
  if (r === 'HOUSEKEEPING' && propertyType === 'APARTMENT') return true;
  return false;
}

/**
 * What a role may do with the Cari Hesap section of a reservation.
 *
 *   view           → the section itself (totals, balance, movements)
 *   exportCsv      → CSV İndir
 *   addCharge      → + Ekstra Ücret
 *   lock           → Hesabı Kilitle / Kilidi Aç
 *   deleteEntry    → the per-row delete
 *   approvalStatus → whether a payment is approved or still waiting: the
 *                    "(onaylandı)" wording, the "Onay bekliyor" mark and the
 *                    separate "Onay bekleyen" total
 *
 * The Personel roles get `view` and nothing else: they read the account but
 * cannot export or change it, and they are shown every payment the same way,
 * approved or not (see buildCariView in cariHesap.ts). lock / deleteEntry
 * compare the raw role on purpose — the server gates both on SUPER_ADMIN alone
 * (migrations 078, 017).
 */
export function ledgerAccess(role: Role) {
  return {
    view: can(role, 'ledger:read'),
    exportCsv: can(role, 'finance:read'),
    addCharge: can(role, 'finance:write'),
    lock: role === 'SUPER_ADMIN',
    deleteEntry: role === 'SUPER_ADMIN',
    approvalStatus: can(role, 'finance:read'),
  };
}

/**
 * How the Ödeme Topla dialog behaves for a role.
 *
 *   approvalNotice → the amber note that the payment waits in Onaylar and is
 *                    not posted to the kasa / cari until approved
 *   confirmFirst   → ask "Tahsilat yapılsın mı?" before the payment is sent
 *
 * A role that reads the Cari Hesap without approval status (the Personel roles)
 * is not told about approval here either — the note would also contradict what
 * that role sees, where the payment appears at once. It is asked to confirm
 * instead. Derived from ledgerAccess() so the dialog and the section cannot
 * disagree; every other role keeps the note and no question, as before.
 */
export function paymentCollectUi(role: Role) {
  const cari = ledgerAccess(role);
  const approvalHidden = cari.view && !cari.approvalStatus;
  return {
    approvalNotice: !approvalHidden,
    confirmFirst: approvalHidden,
  };
}
