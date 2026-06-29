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
  // Region technical staff — deliberately narrow: read-only reservation Liste +
  // issue reporting only. No cleaning-status write (housekeeping:write), no
  // finance / guest / property / staff. Region scoping is server-side
  // (auth_role() → HOUSEKEEPING, auth_region() → 'bornova'). Migration 114.
  TEKNIK_PERSONEL_BORNOVA: ['housekeeping:read', 'issue:write', 'reservation:read'],
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
  return role;
}

export function can(role: Role, permission: Permission): boolean {
  if (role === 'SUPER_ADMIN') return true;
  return BASE[role].includes(permission);
}

/**
 * Teknik Personel Bornova is a deliberately narrow role (read-only reservation
 * Liste + issue reporting). This flags it so the few UI surfaces it must NOT
 * see — guest/property nav, availability/calendar tools, the Kirli Daireler
 * tile — can hide them without each re-listing the role literal.
 */
export function isTeknikPersonel(role: Role | undefined): boolean {
  return role === 'TEKNIK_PERSONEL_BORNOVA';
}

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
