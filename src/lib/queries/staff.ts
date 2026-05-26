import { supabase } from '@/lib/supabase';
import type { AccessScope, Database, Role } from '@/types/database';

type StaffProfileRow = Database['public']['Tables']['staff_profiles']['Row'];
type AdvanceRow = Database['public']['Tables']['staff_advances']['Row'];
type AdvanceInsert = Database['public']['Tables']['staff_advances']['Insert'];

export type StaffProfile = StaffProfileRow;
export type StaffAdvance = AdvanceRow;

export interface StaffProfileWithProperty extends StaffProfileRow {
  property: { name: string; type: string } | null;
}

const wrapErr = (e: { message: string; details?: string; hint?: string; code?: string }) =>
  new Error(
    `${e.message}${e.details ? ` — ${e.details}` : ''}${e.hint ? ` [${e.hint}]` : ''}${e.code ? ` (${e.code})` : ''}`,
  );

// =============================================================================
// Staff profiles (read-only here — creation lives in admin/Supabase for now)
// =============================================================================

/**
 * All staff visible to the caller. RLS already scopes managers to their
 * branch; we add deleted_at=NULL on top so soft-deleted ex-staff don't show
 * up in the directory (migration 057).
 */
export async function listStaff(): Promise<StaffProfileWithProperty[]> {
  const { data, error } = await supabase
    .from('staff_profiles')
    .select(
      'user_id, full_name, role, property_id, access_scope, salary, salary_day, hire_date, created_at, property:properties(name, type)',
    )
    .is('deleted_at', null)
    .order('full_name');
  if (error) throw wrapErr(error);
  return (data as unknown as StaffProfileWithProperty[]) ?? [];
}

export async function getStaff(userId: string): Promise<StaffProfileWithProperty | null> {
  const { data, error } = await supabase
    .from('staff_profiles')
    .select(
      'user_id, full_name, role, property_id, access_scope, salary, salary_day, hire_date, created_at, property:properties(name, type)',
    )
    .eq('user_id', userId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw wrapErr(error);
  return (data as unknown as StaffProfileWithProperty | null) ?? null;
}

/**
 * Soft-delete a staff member via the delete_staff RPC. SUPER_ADMIN only;
 * the function refuses to delete the caller's own row to prevent self-lockout.
 */
export async function deleteStaff(userId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_staff', { _user_id: userId });
  if (error) throw wrapErr(error);
}

/**
 * Updates a staff member's payroll settings: monthly salary amount and the
 * day-of-month the auto-pay cron fires (migration 049). RLS limits this to
 * SUPER_ADMIN (staff_profiles_modify policy in 003_rls.sql). Pass
 * salary_day = null to disable auto-pay for this staff (manual only).
 */
export async function updateStaffSalary(
  userId: string,
  salary: number,
  salaryDay: number | null,
): Promise<StaffProfileRow> {
  const { data, error } = await supabase
    .from('staff_profiles')
    .update({ salary, salary_day: salaryDay })
    .eq('user_id', userId)
    .select()
    .single();
  if (error) throw wrapErr(error);
  return data;
}

/**
 * Sets which properties a staff member works across (Tüm Mülkler / Binalar /
 * Daireler). RLS gates this to SUPER_ADMIN (staff_profiles_modify). Drives
 * branch isolation via auth_sees_property() — see migration 033.
 */
export async function updateStaffScope(
  userId: string,
  scope: AccessScope,
): Promise<StaffProfileRow> {
  const { data, error } = await supabase
    .from('staff_profiles')
    .update({ access_scope: scope })
    .eq('user_id', userId)
    .select()
    .single();
  if (error) throw wrapErr(error);
  return data;
}

/**
 * Promotes / changes a staff member's role (typically PENDING → a real role).
 * RLS gates this to SUPER_ADMIN (staff_profiles_modify).
 */
export async function updateStaffRole(
  userId: string,
  role: Role,
): Promise<StaffProfileRow> {
  const { data, error } = await supabase
    .from('staff_profiles')
    .update({ role })
    .eq('user_id', userId)
    .select()
    .single();
  if (error) throw wrapErr(error);
  return data;
}

// =============================================================================
// Staff advances
// =============================================================================

/** Advances for a single staff member, newest first. */
export async function listAdvancesForStaff(userId: string): Promise<AdvanceRow[]> {
  const { data, error } = await supabase
    .from('staff_advances')
    .select('*')
    .eq('user_id', userId)
    .order('given_at', { ascending: false });
  if (error) throw wrapErr(error);
  return data ?? [];
}

export async function createAdvance(input: AdvanceInsert): Promise<AdvanceRow> {
  const { data, error } = await supabase
    .from('staff_advances')
    .insert(input)
    .select()
    .single();
  if (error) throw wrapErr(error);
  return data;
}

/** Sum of advance amounts in the supplied list. */
export function totalAdvanceAmount(rows: AdvanceRow[]): number {
  return rows.reduce((acc, r) => acc + Number(r.amount), 0);
}

// Istanbul-local month classifier: given_at is UTC, but the operator's
// "this month" is Europe/Istanbul. Slicing the UTC ISO directly would
// miscount entries made in the first few hours of a month (which sit
// in the previous UTC month).
const istanbulMonthFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Istanbul',
  year: 'numeric',
  month: '2-digit',
});

function istanbulYearMonth(iso: string): string {
  // formatToParts gives us locale-stable named parts regardless of how the
  // formatter chooses to string-join them.
  const parts = istanbulMonthFmt.formatToParts(new Date(iso));
  const y = parts.find((p) => p.type === 'year')?.value ?? '0000';
  const m = parts.find((p) => p.type === 'month')?.value ?? '00';
  return `${y}-${m}`;
}

/**
 * Sum of advances whose given_at falls in the given calendar month, measured
 * in Europe/Istanbul. `monthStr` must be 'YYYY-MM'.
 */
export function totalAdvancesInMonth(rows: AdvanceRow[], monthStr: string): number {
  if (!/^\d{4}-\d{2}$/.test(monthStr)) return 0;
  return rows.reduce((acc, r) => {
    if (istanbulYearMonth(r.given_at) === monthStr) return acc + Number(r.amount);
    return acc;
  }, 0);
}
