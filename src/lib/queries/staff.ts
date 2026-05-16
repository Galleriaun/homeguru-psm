import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';

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

/** All staff visible to the caller. RLS already scopes managers to their branch. */
export async function listStaff(): Promise<StaffProfileWithProperty[]> {
  const { data, error } = await supabase
    .from('staff_profiles')
    .select(
      'user_id, full_name, role, property_id, salary, hire_date, created_at, property:properties(name, type)',
    )
    .order('full_name');
  if (error) throw wrapErr(error);
  return (data as unknown as StaffProfileWithProperty[]) ?? [];
}

export async function getStaff(userId: string): Promise<StaffProfileWithProperty | null> {
  const { data, error } = await supabase
    .from('staff_profiles')
    .select(
      'user_id, full_name, role, property_id, salary, hire_date, created_at, property:properties(name, type)',
    )
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw wrapErr(error);
  return (data as unknown as StaffProfileWithProperty | null) ?? null;
}

/**
 * Updates only the salary column. RLS limits this to SUPER_ADMIN
 * (see staff_profiles_modify policy in 003_rls.sql).
 */
export async function updateStaffSalary(userId: string, salary: number): Promise<StaffProfileRow> {
  const { data, error } = await supabase
    .from('staff_profiles')
    .update({ salary })
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
