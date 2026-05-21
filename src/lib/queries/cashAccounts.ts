import { supabase } from '@/lib/supabase';
import { softDeleteEntity } from '@/lib/queries/trash';
import type { Database } from '@/types/database';

type CashAccountRow = Database['public']['Tables']['cash_accounts']['Row'];
type CashTxRow = Database['public']['Tables']['cash_transactions']['Row'];
type CashTxInsert = Database['public']['Tables']['cash_transactions']['Insert'];

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

/** Transactions for the kasa, newest first. */
export async function listCashTransactions(accountId: string): Promise<CashTxRow[]> {
  const { data, error } = await supabase
    .from('cash_transactions')
    .select('*')
    .eq('cash_account_id', accountId)
    .order('created_at', { ascending: false });
  if (error) throw wrapErr(error);
  return data ?? [];
}

export async function createCashTransaction(input: CashTxInsert): Promise<CashTxRow> {
  const { data, error } = await supabase
    .from('cash_transactions')
    .insert(input)
    .select()
    .single();
  if (error) throw wrapErr(error);
  return data;
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
