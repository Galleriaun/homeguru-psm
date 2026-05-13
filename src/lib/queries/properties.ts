import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';

type PropertyRow = Database['public']['Tables']['properties']['Row'];
type PropertyInsert = Database['public']['Tables']['properties']['Insert'];
type PropertyUpdate = Database['public']['Tables']['properties']['Update'];

export type Property = PropertyRow;

/** List all properties visible to the current user (RLS-filtered). */
export async function listProperties() {
  const { data, error } = await supabase
    .from('properties')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

/** Fetch a single property by ID. Returns null if not found / not visible. */
export async function getProperty(id: string) {
  const { data, error } = await supabase
    .from('properties')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function createProperty(input: PropertyInsert) {
  const { data, error } = await supabase
    .from('properties')
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateProperty(id: string, input: PropertyUpdate) {
  const { data, error } = await supabase
    .from('properties')
    .update(input)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteProperty(id: string) {
  const { error } = await supabase.from('properties').delete().eq('id', id);
  if (error) throw error;
}
