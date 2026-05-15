import { supabase } from '@/lib/supabase';
import type { PaymentMethod } from '@/types/database';

export interface CollectPaymentInput {
  reservationId: string;
  amount: number;
  method: PaymentMethod;
  /** Required when method = CASH and caller can see cash_accounts. Otherwise the RPC auto-picks the property's CASH account. */
  cashAccountId?: string | null;
  note?: string | null;
}

const wrapErr = (e: { message: string; details?: string; hint?: string; code?: string }) =>
  new Error(
    `${e.message}${e.details ? ` — ${e.details}` : ''}${e.hint ? ` [${e.hint}]` : ''}${e.code ? ` (${e.code})` : ''}`,
  );

/**
 * Records a payment atomically — payment_collections + ledger PAYMENT entry +
 * (if CASH) cash_transactions IN. Server-side SECURITY DEFINER function enforces
 * the role × property-type rules; any rule violation surfaces as a thrown Error
 * with the Turkish message from the RPC.
 *
 * Returns the new payment_collections.id.
 */
export async function collectPayment(input: CollectPaymentInput): Promise<string> {
  const { data, error } = await supabase.rpc('collect_payment', {
    _reservation_id: input.reservationId,
    _amount: input.amount,
    _method: input.method,
    _cash_account_id: input.cashAccountId ?? null,
    _note: input.note ?? null,
  });
  if (error) throw wrapErr(error);
  if (!data) throw new Error('Ödeme kaydı oluşturulamadı');
  return data as string;
}
