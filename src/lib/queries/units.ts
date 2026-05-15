import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';

type UnitRow = Database['public']['Tables']['units']['Row'];
type UnitInsert = Database['public']['Tables']['units']['Insert'];
type UnitUpdate = Database['public']['Tables']['units']['Update'];

export type Unit = UnitRow;

/** All units for a given property, ordered by name. */
export async function listUnitsForProperty(propertyId: string) {
  const { data, error } = await supabase
    .from('units')
    .select('*')
    .eq('property_id', propertyId)
    .order('name');
  if (error) throw error;
  return data;
}

/** Every unit across all properties (RLS-filtered), ordered by name. */
export async function listAllUnits(): Promise<Unit[]> {
  const { data, error } = await supabase.from('units').select('*').order('name');
  if (error) throw error;
  return data ?? [];
}

export async function getUnit(id: string) {
  const { data, error } = await supabase
    .from('units')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function createUnit(input: UnitInsert) {
  const { data, error } = await supabase
    .from('units')
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateUnit(id: string, input: UnitUpdate) {
  const { data, error } = await supabase
    .from('units')
    .update(input)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteUnit(id: string) {
  const { error } = await supabase.from('units').delete().eq('id', id);
  if (error) throw error;
}

/** How many units this property has — used to gate adding more for APARTMENT type. */
export async function countUnitsForProperty(propertyId: string) {
  const { count, error } = await supabase
    .from('units')
    .select('id', { count: 'exact', head: true })
    .eq('property_id', propertyId);
  if (error) throw error;
  return count ?? 0;
}
