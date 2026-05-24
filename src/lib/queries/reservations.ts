import { supabase } from '@/lib/supabase';
import { softDeleteEntity } from '@/lib/queries/trash';
import type { Database, ReservationStatus } from '@/types/database';

type ReservationRow = Database['public']['Tables']['reservations']['Row'];
type ReservationInsert = Database['public']['Tables']['reservations']['Insert'];

export type Reservation = ReservationRow;

export interface ReservationWithRefs extends ReservationRow {
  guest: { full_name: string; phone: string | null } | null;
  unit: { name: string; property_id: string } | null;
  property: { name: string; type: string } | null;
}

const wrapErr = (e: { message: string; details?: string; hint?: string; code?: string }) => {
  // Friendly translation for the most common DB error in this module
  if (e.code === '23P01') {
    return new Error('Bu birim seçilen tarihler arasında başka bir rezervasyonla çakışıyor.');
  }
  return new Error(
    `${e.message}${e.details ? ` — ${e.details}` : ''}${e.hint ? ` [${e.hint}]` : ''}${e.code ? ` (${e.code})` : ''}`,
  );
};

/**
 * List reservations with joined guest/unit/property names. Capped at the
 * 1000 most recent by stay_start so the query stays bounded as history grows
 * — far beyond any realistic working set for this operation.
 */
export async function listReservations(): Promise<ReservationWithRefs[]> {
  const { data, error } = await supabase
    .from('reservations')
    .select(
      'id, property_id, unit_id, guest_id, stay_start, stay_end, status, stay_type, total_amount, deposit, auto_debit, created_by, created_at, guest:guests(full_name, phone), unit:units(name, property_id), property:properties(name, type)',
    )
    .order('stay_start', { ascending: false })
    .limit(1000);
  if (error) throw wrapErr(error);
  return (data as unknown as ReservationWithRefs[]) ?? [];
}

/**
 * Currently-active reservations — drives the Panel's "Sorun Bildir" quick
 * modal: housekeeping picks the unit they're cleaning from this list and
 * files an issue against it. Order by most-recent stay_start so the typical
 * "just-checked-in" guest sits at the top.
 */
export async function listActiveReservations(): Promise<ReservationWithRefs[]> {
  const { data, error } = await supabase
    .from('reservations')
    .select(
      'id, property_id, unit_id, guest_id, stay_start, stay_end, status, stay_type, total_amount, deposit, auto_debit, created_by, created_at, guest:guests(full_name, phone), unit:units(name, property_id), property:properties(name, type)',
    )
    .eq('status', 'active')
    .order('stay_start', { ascending: false });
  if (error) throw wrapErr(error);
  return (data as unknown as ReservationWithRefs[]) ?? [];
}

/**
 * Reservations overlapping the window [startISO, endISO).
 * A stay overlaps when it starts before the window ends and ends after the window starts.
 */
export async function listReservationsInRange(
  startISO: string,
  endISO: string,
): Promise<ReservationWithRefs[]> {
  const { data, error } = await supabase
    .from('reservations')
    .select(
      'id, property_id, unit_id, guest_id, stay_start, stay_end, status, stay_type, total_amount, deposit, auto_debit, created_by, created_at, guest:guests(full_name, phone), unit:units(name, property_id), property:properties(name, type)',
    )
    .lt('stay_start', endISO)
    .gt('stay_end', startISO)
    .order('stay_start', { ascending: true });
  if (error) throw wrapErr(error);
  return (data as unknown as ReservationWithRefs[]) ?? [];
}

export async function getReservation(id: string): Promise<ReservationRow | null> {
  const { data, error } = await supabase
    .from('reservations')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw wrapErr(error);
  return data;
}

export async function createReservation(input: ReservationInsert): Promise<ReservationRow> {
  const { data, error } = await supabase.from('reservations').insert(input).select().single();
  if (error) throw wrapErr(error);
  return data;
}

export async function updateReservation(
  id: string,
  input: Database['public']['Tables']['reservations']['Update'],
): Promise<ReservationRow> {
  const { data, error } = await supabase
    .from('reservations')
    .update(input)
    .eq('id', id)
    .select()
    .single();
  if (error) throw wrapErr(error);
  return data;
}

export async function cancelReservation(id: string): Promise<void> {
  const { error } = await supabase
    .from('reservations')
    .update({ status: 'cancelled' satisfies ReservationStatus })
    .eq('id', id);
  if (error) throw wrapErr(error);
}

/**
 * Soft-delete a reservation → lands in Çöp Kutusu. RLS gates the underlying
 * delete to SUPER_ADMIN / PROPERTY_MANAGER / RECEPTION. If downstream rows
 * (ledger entries, KBS, payments) reference it, the snapshot is rolled back
 * by the RPC and an FK-flavored error surfaces.
 */
export async function deleteReservation(id: string): Promise<void> {
  try {
    await softDeleteEntity('reservations', id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (msg.includes('23503') || msg.toLowerCase().includes('foreign key')) {
      throw new Error(
        'Bu rezervasyon başka kayıtlara (ödeme, KBS, temizlik vb.) bağlı olduğu için silinemez. Önce ilgili kayıtları kaldırın.',
      );
    }
    throw e;
  }
}
