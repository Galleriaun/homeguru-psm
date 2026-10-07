import { supabase } from '@/lib/supabase';
import { fetchAllRows, type PagedQuery } from '@/lib/queries/fetchAll';
import { DEFAULT_CLEANING_STATUS, type StayForCleaning } from '@/lib/cleaningState';
import type { Database, HousekeepingStatus } from '@/types/database';

type TaskRow = Database['public']['Tables']['housekeeping_tasks']['Row'];
type TaskInsert = Database['public']['Tables']['housekeeping_tasks']['Insert'];

export type HousekeepingTask = TaskRow;

export interface TaskWithRefs extends TaskRow {
  unit: { name: string; room_type: string; property_id: string } | null;
  property: { name: string; type: string } | null;
}

const wrapErr = (e: { message: string; details?: string; hint?: string; code?: string }) =>
  new Error(
    `${e.message}${e.details ? ` — ${e.details}` : ''}${e.hint ? ` [${e.hint}]` : ''}${e.code ? ` (${e.code})` : ''}`,
  );

/**
 * Lists every housekeeping_tasks row visible to the caller (RLS-filtered to
 * the caller's branch via hk_tasks_select). Caller is expected to call
 * `latestPerUnit()` to derive each unit's current status.
 *
 * We don't aggregate server-side (no DISTINCT ON in PostgREST) — for a
 * realistic property count this is cheap.
 */
export async function listAllTasks(): Promise<TaskWithRefs[]> {
  const { data, error } = await supabase
    .from('housekeeping_tasks')
    .select(
      'id, property_id, unit_id, status, notes, updated_by, updated_at, created_at, unit:units(name, room_type, property_id), property:properties(name, type)',
    )
    .order('updated_at', { ascending: false });
  if (error) throw wrapErr(error);
  return (data as unknown as TaskWithRefs[]) ?? [];
}

/**
 * Append a new status-change event. We never UPDATE — the row history
 * doubles as an audit trail. The UI uses latestPerUnit() to compute the
 * "current" state.
 */
export async function recordTaskStatus(input: TaskInsert): Promise<TaskRow> {
  const { data, error } = await supabase
    .from('housekeeping_tasks')
    .insert(input)
    .select()
    .single();
  if (error) throw wrapErr(error);
  return data;
}

/**
 * Reduce a list of task events to the latest entry per unit_id.
 * `tasks` is expected to be ordered newest-first (as `listAllTasks()` returns).
 */
export function latestPerUnit(tasks: TaskWithRefs[]): Map<string, TaskWithRefs> {
  const out = new Map<string, TaskWithRefs>();
  for (const t of tasks) {
    if (!out.has(t.unit_id)) out.set(t.unit_id, t);
  }
  return out;
}

/** Default status for units with no recorded task history. */
export const DEFAULT_STATUS: HousekeepingStatus = DEFAULT_CLEANING_STATUS;

/** How far back the Temizlik screen looks for stays that have ended. */
export const CLEANING_LOOKBACK_DAYS = 90;

const DAY_MS = 86_400_000;

/**
 * The stays that decide which units need cleaning: every reservation whose
 * stay_end falls between `now − CLEANING_LOOKBACK_DAYS` and `now + 1 day`.
 * Feed the result to cleaningStateByUnit() together with the cleaning marks.
 *
 * - The day ahead is there on purpose: an overnight stay's stay_end is UTC
 *   midnight of its checkout date, hours before the 11:00 checkout itself, and a
 *   day-use stay may end later today. Loading them now lets an open screen turn
 *   the unit "Kirli" when the moment comes, without a reload.
 * - Status is NOT filtered here. The rule (cleaningState.ts) drops cancelled
 *   stays itself, so there is one place that decides what counts.
 * - Only the six columns below: cleaning staff load this, and it must carry no
 *   guest or money data.
 * - Paged through fetchAllRows: a row dropped by the server's Max Rows would be
 *   a room that never shows as Kirli.
 *
 * Limit, by design: a unit last stayed in more than CLEANING_LOOKBACK_DAYS ago
 * falls back to its last cleaning mark alone.
 */
export async function listStaysForCleaning(now: Date = new Date()): Promise<StayForCleaning[]> {
  const from = new Date(now.getTime() - CLEANING_LOOKBACK_DAYS * DAY_MS).toISOString();
  const to = new Date(now.getTime() + DAY_MS).toISOString();
  type Row = StayForCleaning & { id: string };
  return fetchAllRows<Row>(
    () =>
      supabase
        .from('reservations')
        .select('id, unit_id, stay_end, stay_type, late_checkout_hours, status', { count: 'exact' })
        .gte('stay_end', from)
        .lt('stay_end', to) as unknown as PagedQuery<Row>,
    wrapErr,
  );
}
