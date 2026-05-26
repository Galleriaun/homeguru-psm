import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';

type ExpenseRow = Database['public']['Tables']['expenses']['Row'];
type CashTxRow = Database['public']['Tables']['cash_transactions']['Row'];

const wrapErr = (e: { message: string; details?: string; hint?: string; code?: string }) =>
  new Error(
    `${e.message}${e.details ? ` — ${e.details}` : ''}${e.hint ? ` [${e.hint}]` : ''}${e.code ? ` (${e.code})` : ''}`,
  );

// =============================================================================
// Pending expense submissions — created with status='pending' by record_expense
// when the caller isn't SUPER_ADMIN (migration 055). The /finance/pending page
// shows them under the "Gider" tab so admin can approve or reject.
// =============================================================================

export interface PendingExpense extends ExpenseRow {
  property: { name: string; type: string } | null;
}

export async function listPendingExpenses(): Promise<PendingExpense[]> {
  const { data, error } = await supabase
    .from('expenses')
    .select('*, property:properties(name, type)')
    .eq('approval_status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw wrapErr(error);
  return (data as unknown as PendingExpense[]) ?? [];
}

export async function approveExpense(expenseId: string): Promise<ExpenseRow> {
  const { data, error } = await supabase.rpc('approve_expense', { _expense_id: expenseId });
  if (error) throw wrapErr(error);
  return data as ExpenseRow;
}

export async function rejectExpense(
  expenseId: string,
  reason: string | null = null,
): Promise<ExpenseRow> {
  const { data, error } = await supabase.rpc('reject_expense', {
    _expense_id: expenseId,
    _reason: reason,
  });
  if (error) throw wrapErr(error);
  return data as ExpenseRow;
}

// =============================================================================
// Pending manual cash_transactions submissions — inserted with status='pending'
// by submit_cash_tx for non-admin callers. Approval flips status='approved',
// at which point cash_account_balances() starts counting the row.
// =============================================================================

export type PendingCashTx = CashTxRow;

export async function listPendingCashTransactions(): Promise<PendingCashTx[]> {
  const { data, error } = await supabase
    .from('cash_transactions')
    .select('*')
    .eq('approval_status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw wrapErr(error);
  return (data as unknown as PendingCashTx[]) ?? [];
}

export async function approveCashTransaction(id: string): Promise<CashTxRow> {
  const { data, error } = await supabase.rpc('approve_cash_tx', { _cash_tx_id: id });
  if (error) throw wrapErr(error);
  return data as CashTxRow;
}

export async function rejectCashTransaction(
  id: string,
  reason: string | null = null,
): Promise<CashTxRow> {
  const { data, error } = await supabase.rpc('reject_cash_tx', {
    _cash_tx_id: id,
    _reason: reason,
  });
  if (error) throw wrapErr(error);
  return data as CashTxRow;
}
