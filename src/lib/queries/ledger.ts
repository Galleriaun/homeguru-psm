import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';

type LedgerRow = Database['public']['Tables']['ledger_entries']['Row'];
type LedgerInsert = Database['public']['Tables']['ledger_entries']['Insert'];

export type LedgerEntry = LedgerRow;

const wrapErr = (e: { message: string; details?: string; hint?: string; code?: string }) =>
  new Error(
    `${e.message}${e.details ? ` — ${e.details}` : ''}${e.hint ? ` [${e.hint}]` : ''}${e.code ? ` (${e.code})` : ''}`,
  );

/**
 * Entries for a single reservation, newest first.
 * Filters strictly by reservation_id — does NOT include guest-scoped entries
 * (reservation_id IS NULL) that may also belong to this guest.
 */
export async function listLedgerForReservation(reservationId: string): Promise<LedgerRow[]> {
  const { data, error } = await supabase
    .from('ledger_entries')
    .select('*')
    .eq('reservation_id', reservationId)
    .order('created_at', { ascending: false });
  if (error) throw wrapErr(error);
  return data ?? [];
}

/** All entries for a guest, newest first — useful for a future guest-level cari view. */
export async function listLedgerForGuest(guestId: string): Promise<LedgerRow[]> {
  const { data, error } = await supabase
    .from('ledger_entries')
    .select('*')
    .eq('guest_id', guestId)
    .order('created_at', { ascending: false });
  if (error) throw wrapErr(error);
  return data ?? [];
}

export async function createLedgerEntry(input: LedgerInsert): Promise<LedgerRow> {
  const { data, error } = await supabase
    .from('ledger_entries')
    .insert(input)
    .select()
    .single();
  if (error) throw wrapErr(error);
  return data;
}

/**
 * Deletes a single ledger entry. RLS allows this only for SUPER_ADMIN
 * (see migration 017). `.select()` ensures a silent zero-row outcome
 * surfaces as a thrown error instead of looking like success.
 *
 * Callers should prefer `deletePaymentCollection` for entries that have
 * a payment_collection_id set — that path cascades and keeps the cash
 * drawer in sync.
 */
export async function deleteLedgerEntry(id: string): Promise<void> {
  const { data, error } = await supabase
    .from('ledger_entries')
    .delete()
    .eq('id', id)
    .select();
  if (error) throw wrapErr(error);
  if (!data || data.length === 0) {
    throw new Error(
      'Kayıt silinemedi. Yetkiniz olmayabilir veya migration 017 henüz uygulanmamış olabilir.',
    );
  }
}

/** Balance = SUM(DEBT) − SUM(PAYMENT). Positive means the guest still owes. */
export function balanceFor(entries: LedgerRow[]): number {
  return entries.reduce(
    (acc, e) => acc + (e.type === 'DEBT' ? Number(e.amount) : -Number(e.amount)),
    0,
  );
}
