import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';

type CashAccountRow = Database['public']['Tables']['cash_accounts']['Row'];
type CashAccountInsert = Database['public']['Tables']['cash_accounts']['Insert'];
type CashAccountUpdate = Database['public']['Tables']['cash_accounts']['Update'];

type CashTxRow = Database['public']['Tables']['cash_transactions']['Row'];
type CashTxInsert = Database['public']['Tables']['cash_transactions']['Insert'];

export type CashAccount = CashAccountRow;
export type CashTransaction = CashTxRow;

export interface CashAccountWithProperty extends CashAccountRow {
  property: { name: string; type: string } | null;
}

const wrapErr = (e: { message: string; details?: string; hint?: string; code?: string }) =>
  new Error(
    `${e.message}${e.details ? ` — ${e.details}` : ''}${e.hint ? ` [${e.hint}]` : ''}${e.code ? ` (${e.code})` : ''}`,
  );

// =============================================================================
// Cash accounts
// =============================================================================

/** List all visible cash accounts, joined with property name + type. */
export async function listCashAccounts(): Promise<CashAccountWithProperty[]> {
  const { data, error } = await supabase
    .from('cash_accounts')
    .select(
      'id, property_id, name, account_type, currency, created_at, property:properties(name, type)',
    )
    .order('created_at', { ascending: true });
  if (error) throw wrapErr(error);
  return (data as unknown as CashAccountWithProperty[]) ?? [];
}

export async function getCashAccount(id: string): Promise<CashAccountRow | null> {
  const { data, error } = await supabase
    .from('cash_accounts')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw wrapErr(error);
  return data;
}

export async function createCashAccount(input: CashAccountInsert): Promise<CashAccountRow> {
  const { data, error } = await supabase
    .from('cash_accounts')
    .insert(input)
    .select()
    .single();
  if (error) throw wrapErr(error);
  return data;
}

export async function updateCashAccount(
  id: string,
  input: CashAccountUpdate,
): Promise<CashAccountRow> {
  const { data, error } = await supabase
    .from('cash_accounts')
    .update(input)
    .eq('id', id)
    .select()
    .single();
  if (error) throw wrapErr(error);
  return data;
}

/** Deletes a cash account. Fails (23503) if it has any transactions — surfaced as a friendly message. */
export async function deleteCashAccount(id: string): Promise<void> {
  const { error } = await supabase.from('cash_accounts').delete().eq('id', id);
  if (error) {
    if (error.code === '23503') {
      throw new Error(
        'Bu kasaya bağlı işlemler bulunduğu için silinemez. Önce kasanın hareketlerini sıfırlayın.',
      );
    }
    throw wrapErr(error);
  }
}

// =============================================================================
// Cash transactions
// =============================================================================

/** Transactions for a single account, newest first. */
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

/** Sum of IN minus sum of OUT. Pure client-side reduction. */
export function balanceOf(txs: CashTxRow[]): number {
  return txs.reduce(
    (acc, t) => acc + (t.direction === 'IN' ? Number(t.amount) : -Number(t.amount)),
    0,
  );
}

/**
 * Fetch balances for many accounts in one round-trip.
 * Returns a Map<accountId, balance>. Accounts with no transactions are absent
 * from the map (callers should treat missing as 0).
 */
export async function balancesByAccount(): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from('cash_transactions')
    .select('cash_account_id, amount, direction');
  if (error) throw wrapErr(error);
  const out = new Map<string, number>();
  for (const t of data ?? []) {
    const delta = t.direction === 'IN' ? Number(t.amount) : -Number(t.amount);
    out.set(t.cash_account_id, (out.get(t.cash_account_id) ?? 0) + delta);
  }
  return out;
}
