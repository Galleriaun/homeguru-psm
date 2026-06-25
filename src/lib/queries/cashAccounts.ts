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
// General kasa — there is one kasa per region (migration 094): the main/HQ
// "Genel Kasa" (region NULL) plus a kasa per region (e.g. Bornova). RLS scopes
// what each user sees — a region manager sees only their own kasa, while a
// SUPER_ADMIN sees all of them. We order region NULLS FIRST so the default pick
// is always the main Genel Kasa for an admin; a region manager only ever sees
// their single kasa anyway.
// =============================================================================

/** The default kasa for the current user — the main Genel Kasa for an admin,
 *  or the region's own kasa for a region-scoped manager. Null if unseeded. */
export async function getGeneralKasa(): Promise<CashAccountRow | null> {
  const { data, error } = await supabase
    .from('cash_accounts')
    .select('*')
    .order('region', { ascending: true, nullsFirst: true })
    .limit(1)
    .maybeSingle();
  if (error) throw wrapErr(error);
  return data;
}

/** Every kasa the current user can see — Genel Kasa first, then region kasas
 *  (Bornova). A SUPER_ADMIN sees all; a region manager sees only their own.
 *  Drives the kasa switcher on the Kasa page. */
export async function listCashAccounts(): Promise<CashAccountRow[]> {
  const { data, error } = await supabase
    .from('cash_accounts')
    .select('*')
    .order('region', { ascending: true, nullsFirst: true });
  if (error) throw wrapErr(error);
  return data ?? [];
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
