import { supabase } from '@/lib/supabase';
import { deleteIssuePhotos } from '@/lib/photos';
import type { Database } from '@/types/database';

type IssueRow = Database['public']['Tables']['housekeeping_issues']['Row'];
type IssueInsert = Database['public']['Tables']['housekeeping_issues']['Insert'];
type IssueUpdate = Database['public']['Tables']['housekeeping_issues']['Update'];

export type HousekeepingIssue = IssueRow;
export type IssueStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';

const wrapErr = (e: { message: string; details?: string; hint?: string; code?: string }) =>
  new Error(
    `${e.message}${e.details ? ` — ${e.details}` : ''}${e.hint ? ` [${e.hint}]` : ''}${e.code ? ` (${e.code})` : ''}`,
  );

/** All issues recorded against a single unit, newest first. */
export async function listIssuesForUnit(unitId: string): Promise<IssueRow[]> {
  const { data, error } = await supabase
    .from('housekeeping_issues')
    .select('*')
    .eq('unit_id', unitId)
    .order('created_at', { ascending: false });
  if (error) throw wrapErr(error);
  return data ?? [];
}

/**
 * One-shot fetch that returns a Map<unit_id, open-issue-count>, used to
 * render the small alert badge on each unit card. "Open" excludes RESOLVED.
 */
export async function listOpenIssueCountsByUnit(): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from('housekeeping_issues')
    .select('unit_id, status')
    .neq('status', 'RESOLVED');
  if (error) throw wrapErr(error);
  const map = new Map<string, number>();
  for (const row of data ?? []) {
    map.set(row.unit_id, (map.get(row.unit_id) ?? 0) + 1);
  }
  return map;
}

export async function createIssue(input: IssueInsert): Promise<IssueRow> {
  const { data, error } = await supabase
    .from('housekeeping_issues')
    .insert(input)
    .select()
    .single();
  if (error) throw wrapErr(error);
  return data;
}

/**
 * Updates an issue's status. Setting it to RESOLVED also stamps resolved_at
 * so the resolution timestamp is preserved. Other transitions leave it null.
 */
export async function updateIssueStatus(
  id: string,
  status: IssueStatus,
): Promise<IssueRow> {
  const updates: IssueUpdate = { status };
  if (status === 'RESOLVED') updates.resolved_at = new Date().toISOString();
  const { data, error } = await supabase
    .from('housekeeping_issues')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw wrapErr(error);
  return data;
}

/**
 * Hard-delete an issue and best-effort remove its photos from storage.
 * RLS gates who can actually delete (SUPER_ADMIN or branch members per
 * `hk_issues_modify`); the UI gates this further to SUPER_ADMIN only.
 * Throws if RLS blocks the delete (no row returned).
 */
export async function deleteIssue(id: string, photoPaths: string[]): Promise<void> {
  const { data, error } = await supabase
    .from('housekeeping_issues')
    .delete()
    .eq('id', id)
    .select();
  if (error) throw wrapErr(error);
  if (!data || data.length === 0) {
    throw new Error('Sorun silinemedi. Yetkiniz olmayabilir.');
  }
  // Photo cleanup is best-effort — row delete already succeeded.
  await deleteIssuePhotos(photoPaths);
}
