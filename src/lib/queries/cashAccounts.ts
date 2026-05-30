import { supabase } from '@/lib/supabase';
import { softDeleteEntity } from '@/lib/queries/trash';
import type { Database, TxDirection } from '@/types/database';

type CashAccountRow = Database['public']['Tables']['cash_accounts']['Row'];
type CashTxRow = Database['public']['Tables']['cash_transactions']['Row'];

export type CashAccount = CashAccountRow;
export type CashTransaction = CashTxRow;

const wrapErr = (e: { message: string; details?: string; hint?: string; code?: string }) =>
  new Error(
    `${e.message}${e.details ? ` — ${e.details}` : ''}${e.hint ? ` [${e.hint}]` : ''}${e.code ? ` (${e.code})` : ''}`,
  );

// =============================================================================
// General kasa — since migration 036 there is exactly one cash_accounts row
// (a DB trigger enforces the singleton); it belongs to no property.
// =============================================================================

/** The single general kasa, or null if migration 036 hasn't seeded it yet. */
export async function getGeneralKasa(): Promise<CashAccountRow | null> {
  const { data, error } = await supabase
    .from('cash_accounts')
    .select('*')
    .limit(1)
    .maybeSingle();
  if (error) throw wrapErr(error);
  return data;
}

// =============================================================================
// Cash transactions
// =============================================================================

/**
 * A kasa transaction enriched with its source reservation + guest, for
 * movements that came from a guest payment. Manual entries and expense
 * movements have no payment_collection.
 */
export interface CashTransactionWithRefs extends CashTxRow {
  payment_collection?: {
    created_at: string;
    reservation: {
      id: string;
      stay_start: string;
      guest: { full_name: string } | null;
      unit: { name: string } | null;
    } | null;
  } | null;
}

/**
 * Transactions for the kasa, newest first. Filters to approved rows only —
 * pending and rejected movements live in the /finance/pending queue and
 * shouldn't pollute the main kasa view (or its visible balance).
 */
export async function listCashTransactions(
  accountId: string,
): Promise<CashTransactionWithRefs[]> {
  const { data, error } = await supabase
    .from('cash_transactions')
    .select(
      '*, payment_collection:payment_collections(created_at, reservation:reservations(id, stay_start, guest:guests(full_name), unit:units(name)))',
    )
    .eq('cash_account_id', accountId)
    .eq('approval_status', 'approved')
    .order('created_at', { ascending: false });
  if (error) throw wrapErr(error);
  return (data as unknown as CashTransactionWithRefs[]) ?? [];
}

/**
 * Submit a manual kasa entry via the submit_cash_tx RPC. Since migration 067
 * EVERY caller's entry (SUPER_ADMIN included) lands as approval_status='pending'
 * and waits for yönetici onay at /finance/pending — it only posts to the kasa
 * balance once approved.
 */
export async function submitCashTransaction(input: {
  cash_account_id: string;
  amount: number;
  direction: TxDirection;
  description: string | null;
}): Promise<CashTxRow> {
  const { data, error } = await supabase.rpc('submit_cash_tx', {
    _cash_account_id: input.cash_account_id,
    _amount: input.amount,
    _direction: input.direction,
    _description: input.description,
  });
  if (error) throw wrapErr(error);
  return data as CashTxRow;
}

/**
 * Soft-delete a cash transaction → lands in Çöp Kutusu. RLS gates the
 * underlying delete to SUPER_ADMIN (migration 015).
 */
export async function deleteCashTransaction(id: string): Promise<void> {
  await softDeleteEntity('cash_transactions', id);
}

/** Sum of IN minus sum of OUT. Pure client-side reduction. */
export function balanceOf(txs: CashTxRow[]): number {
  return txs.reduce(
    (acc, t) => acc + (t.direction === 'IN' ? Number(t.amount) : -Number(t.amount)),
    0,
  );
}
