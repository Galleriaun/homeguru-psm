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
  | 'payment:collect'
  | 'report:property'
  | 'report:all'
  | 'admin:*';

const BASE: Record<Role, Permission[]> = {
  SUPER_ADMIN: ['admin:*'],
  PROPERTY_MANAGER: [
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
    'payment:collect',
    'report:property',
  ],
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
  HOUSEKEEPING: ['housekeeping:read', 'housekeeping:write'],
  // Branch operator — full operations within own branch, no finance/staff/admin.
  // Payment collection is allowed; the DB RPC creates UNCONFIRMED rows that a
  // manager confirms (since YETKILI has no finance:write).
  YETKILI: [
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
    'payment:collect',
    'report:property',
  ],
};

export function can(role: Role, permission: Permission): boolean {
  if (role === 'SUPER_ADMIN') return true;
  return BASE[role].includes(permission);
}

/**
 * Property-type-conditional permissions.
 * The most important: housekeepers collect payment ONLY in APARTMENT properties.
 * Reception collects payment ONLY in HOTEL properties.
 */
export function canCollectPayment(role: Role, propertyType: PropertyType): boolean {
  if (role === 'SUPER_ADMIN' || role === 'PROPERTY_MANAGER') return true;
  if (role === 'YETKILI') return true; // both property types
  if (role === 'RECEPTION' && propertyType === 'HOTEL') return true;
  if (role === 'HOUSEKEEPING' && propertyType === 'APARTMENT') return true;
  return false;
}
