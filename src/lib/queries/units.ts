import { supabase } from '@/lib/supabase';
import { softDeleteEntity } from '@/lib/queries/trash';
import type { Database } from '@/types/database';

type UnitRow = Database['public']['Tables']['units']['Row'];
type UnitInsert = Database['public']['Tables']['units']['Insert'];
type UnitUpdate = Database['public']['Tables']['units']['Update'];

export type Unit = UnitRow;

/**
 * Wrap a Supabase PostgrestError into a real Error so `err instanceof Error`
 * checks in callers (e.g. UnitFormPage) work and the user sees the actual
 * server message instead of a generic "Kaydedilemedi" fallback.
 */
const wrapErr = (e: { message: string; details?: string; hint?: string; code?: string }) =>
  new Error(
    `${e.message}${e.details ? ` — ${e.details}` : ''}${e.hint ? ` [${e.hint}]` : ''}${e.code ? ` (${e.code})` : ''}`,
  );

/** All units for a given property, ordered by name. */
export async function listUnitsForProperty(propertyId: string) {
  const { data, error } = await supabase
    .from('units')
    .select('*')
    .eq('property_id', propertyId)
    .order('name');
  if (error) throw wrapErr(error);
  return data;
}

/** Every unit across all properties (RLS-filtered), ordered by name. */
export async function listAllUnits(): Promise<Unit[]> {
  const { data, error } = await supabase.from('units').select('*').order('name');
  if (error) throw wrapErr(error);
  return data ?? [];
}

export async function getUnit(id: string) {
  const { data, error } = await supabase
    .from('units')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw wrapErr(error);
  return data;
}

export async function createUnit(input: UnitInsert) {
  const { data, error } = await supabase
    .from('units')
    .insert(input)
    .select()
    .single();
  if (error) throw wrapErr(error);
  return data;
}

export async function updateUnit(id: string, input: UnitUpdate) {
  const { data, error } = await supabase
    .from('units')
    .update(input)
    .eq('id', id)
    .select()
    .single();
  if (error) throw wrapErr(error);
  return data;
}

/** Soft-delete a unit → lands in Çöp Kutusu (admin-restorable). */
export async function deleteUnit(id: string) {
  await softDeleteEntity('units', id);
}

/** How many units this property has — used to gate adding more for APARTMENT type. */
export async function countUnitsForProperty(propertyId: string) {
  const { count, error } = await supabase
    .from('units')
    .select('id', { count: 'exact', head: true })
    .eq('property_id', propertyId);
  if (error) throw wrapErr(error);
  return count ?? 0;
}
