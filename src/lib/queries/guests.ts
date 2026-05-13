import { supabase } from '@/lib/supabase';
import type { GuestRow, DecryptedGuest } from '@/types/database';

/** Lightweight guest summary for list pages (no encrypted fields, no decryption). */
export interface GuestSummary {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  nationality: string | null;
  created_at: string;
}

export interface GuestInput {
  full_name: string;
  tc_kimlik?: string | null;
  passport?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  nationality?: string | null;
}

/**
 * Lists guests visible to the current user (RLS-filtered).
 * Selects only non-sensitive fields — no decryption, no audit log entry.
 */
export async function listGuests(): Promise<GuestSummary[]> {
  const { data, error } = await supabase
    .from('guests')
    .select('id, full_name, phone, email, nationality, created_at')
    .order('full_name');
  if (error) throw new Error(`${error.message}${error.details ? ` — ${error.details}` : ''}${error.hint ? ` [${error.hint}]` : ''}${error.code ? ` (${error.code})` : ''}`);
  return data ?? [];
}

/**
 * Fetches a guest with TC/passport decrypted server-side.
 * Each call writes an entry to audit_log (KVKK requirement).
 */
export async function getGuestDecrypted(id: string): Promise<DecryptedGuest | null> {
  const { data, error } = await supabase.rpc('get_guest_decrypted', { _id: id });
  if (error) throw new Error(`${error.message}${error.details ? ` — ${error.details}` : ''}${error.hint ? ` [${error.hint}]` : ''}${error.code ? ` (${error.code})` : ''}`);
  return data?.[0] ?? null;
}

/** Creates a guest. Sensitive fields are encrypted server-side. */
export async function createGuest(input: GuestInput): Promise<GuestRow> {
  const { data, error } = await supabase.rpc('create_guest', {
    _full_name: input.full_name,
    _tc_kimlik: input.tc_kimlik ?? null,
    _passport: input.passport ?? null,
    _phone: input.phone ?? null,
    _email: input.email ?? null,
    _address: input.address ?? null,
    _nationality: input.nationality ?? null,
  });
  if (error) throw new Error(`${error.message}${error.details ? ` — ${error.details}` : ''}${error.hint ? ` [${error.hint}]` : ''}${error.code ? ` (${error.code})` : ''}`);
  return data;
}

/** Updates a guest. Passing NULL for TC/passport clears that field. */
export async function updateGuest(id: string, input: GuestInput): Promise<GuestRow> {
  const { data, error } = await supabase.rpc('update_guest', {
    _id: id,
    _full_name: input.full_name,
    _tc_kimlik: input.tc_kimlik ?? null,
    _passport: input.passport ?? null,
    _phone: input.phone ?? null,
    _email: input.email ?? null,
    _address: input.address ?? null,
    _nationality: input.nationality ?? null,
  });
  if (error) throw new Error(`${error.message}${error.details ? ` — ${error.details}` : ''}${error.hint ? ` [${error.hint}]` : ''}${error.code ? ` (${error.code})` : ''}`);
  return data;
}

/** Deletes a guest. Only SUPER_ADMIN is permitted per RLS. */
export async function deleteGuest(id: string): Promise<void> {
  const { error } = await supabase.from('guests').delete().eq('id', id);
  if (error) throw new Error(`${error.message}${error.details ? ` — ${error.details}` : ''}${error.hint ? ` [${error.hint}]` : ''}${error.code ? ` (${error.code})` : ''}`);
}
