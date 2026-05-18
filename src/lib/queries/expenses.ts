import { supabase } from '@/lib/supabase';
import { softDeleteEntity } from '@/lib/queries/trash';
import type { Database } from '@/types/database';

type ExpenseRow = Database['public']['Tables']['expenses']['Row'];
type ExpenseInsert = Database['public']['Tables']['expenses']['Insert'];
type ExpenseUpdate = Database['public']['Tables']['expenses']['Update'];

export type Expense = ExpenseRow;

export interface ExpenseWithProperty extends ExpenseRow {
  property: { name: string; type: string } | null;
}

/** Common expense categories — kept in code because the schema is free-form (no CHECK). */
export const EXPENSE_CATEGORIES = [
  'Kira',
  'Elektrik',
  'Su',
  'Doğalgaz',
  'İnternet',
  'Bakım & Onarım',
  'Temizlik Malzemesi',
  'Personel',
  'Vergi',
  'Sigorta',
  'Aidat',
  'Diğer',
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

const wrapErr = (e: { message: string; details?: string; hint?: string; code?: string }) =>
  new Error(
    `${e.message}${e.details ? ` — ${e.details}` : ''}${e.hint ? ` [${e.hint}]` : ''}${e.code ? ` (${e.code})` : ''}`,
  );

/**
 * List expenses, newest first. Optional filters narrow the result server-side.
 * - propertyId: exact match
 * - month: 'YYYY-MM' → restricts to expense_date in that month
 * - category: exact category match
 */
export interface ListExpenseFilters {
  propertyId?: string;
  month?: string; // 'YYYY-MM'
  category?: string;
}

export async function listExpenses(
  filters: ListExpenseFilters = {},
): Promise<ExpenseWithProperty[]> {
  let q = supabase
    .from('expenses')
    .select(
      'id, property_id, category, amount, description, expense_date, is_recurring, created_by, created_at, property:properties(name, type)',
    )
    .order('expense_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (filters.propertyId) {
    q = q.eq('property_id', filters.propertyId);
  }
  if (filters.category) {
    q = q.eq('category', filters.category);
  }
  if (filters.month && /^\d{4}-\d{2}$/.test(filters.month)) {
    // 'YYYY-MM' → first day of this month inclusive, first day of next month exclusive
    const [yearStr, monthStr] = filters.month.split('-');
    const year = Number(yearStr);
    const month = Number(monthStr); // 1..12
    const start = `${yearStr}-${monthStr}-01`;
    const nextYear = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    const end = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
    q = q.gte('expense_date', start).lt('expense_date', end);
  }

  const { data, error } = await q;
  if (error) throw wrapErr(error);
  return (data as unknown as ExpenseWithProperty[]) ?? [];
}

export async function getExpense(id: string): Promise<ExpenseRow | null> {
  const { data, error } = await supabase
    .from('expenses')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw wrapErr(error);
  return data;
}

export async function createExpense(input: ExpenseInsert): Promise<ExpenseRow> {
  const { data, error } = await supabase
    .from('expenses')
    .insert(input)
    .select()
    .single();
  if (error) throw wrapErr(error);
  return data;
}

export async function updateExpense(
  id: string,
  input: ExpenseUpdate,
): Promise<ExpenseRow> {
  const { data, error } = await supabase
    .from('expenses')
    .update(input)
    .eq('id', id)
    .select()
    .single();
  if (error) throw wrapErr(error);
  return data;
}

/** Soft-delete an expense → lands in Çöp Kutusu (admin-restorable). */
export async function deleteExpense(id: string): Promise<void> {
  await softDeleteEntity('expenses', id);
}

/** Sum of amounts in the supplied list. Pure client-side reduction. */
export function totalAmount(rows: ExpenseRow[]): number {
  return rows.reduce((acc, r) => acc + Number(r.amount), 0);
}
