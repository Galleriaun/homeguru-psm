import { supabase } from '@/lib/supabase';
import { fetchAllRows } from '@/lib/queries/fetchAll';
import type { Database, PaymentMethod, PaymentStatus } from '@/types/database';

type PaymentCollectionRow = Database['public']['Tables']['payment_collections']['Row'];

export type PaymentCollection = PaymentCollectionRow;

/**
 * payment_collections row enriched with reservation + guest + property/unit names
 * for the pending-approvals queue.
 */
export interface PendingPaymentWithRefs extends PaymentCollectionRow {
  reservation: {
    guest: { full_name: string } | null;
    unit: { name: string } | null;
  } | null;
  property: { name: string; type: string; region: string | null } | null;
}

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

/**
 * Deletes a payment_collections row. Migration 016 wired ON DELETE CASCADE
 * to ledger_entries and cash_transactions via payment_collection_id, so this
 * single call removes the cari PAYMENT entry and the cash drawer IN entry
 * in lockstep. RLS limits this to SUPER_ADMIN.
 *
 * `.select()` ensures we detect silent zero-row outcomes (RLS deny or
 * pre-migration data) instead of optimistically reporting success.
 */
export async function deletePaymentCollection(id: string): Promise<void> {
  const { data, error } = await supabase
    .from('payment_collections')
    .delete()
    .eq('id', id)
    .select();
  if (error) throw wrapErr(error);
  if (!data || data.length === 0) {
    throw new Error(
      'Tahsilat silinemedi. Yetkiniz olmayabilir veya migration 016 henüz uygulanmamış olabilir.',
    );
  }
}

/**
 * Lists every payment_collections row currently waiting for manager approval
 * (status = UNCONFIRMED). RLS scopes managers to their branch.
 */
export async function listUnconfirmedPayments(): Promise<PendingPaymentWithRefs[]> {
  const { data, error } = await supabase
    .from('payment_collections')
    .select(
      'id, reservation_id, property_id, collected_by_user_id, amount, method, receipt_photo_path, status, confirmed_by, confirmed_at, created_at, reservation:reservations(guest:guests(full_name), unit:units(name)), property:properties(name, type, region)',
    )
    .eq('status', 'UNCONFIRMED' satisfies PaymentStatus)
    .order('created_at', { ascending: false });
  if (error) throw wrapErr(error);
  return (data as unknown as PendingPaymentWithRefs[]) ?? [];
}

/**
 * Manager approves a pending payment (Phase 3C). The RPC creates the
 * previously-deferred ledger PAYMENT entry and (if CASH) the cash_transactions
 * IN row, then stamps the audit row CONFIRMED.
 */
export async function confirmPayment(paymentId: string): Promise<PaymentCollectionRow> {
  const { data, error } = await supabase.rpc('confirm_payment', { _payment_id: paymentId });
  if (error) throw wrapErr(error);
  return data as unknown as PaymentCollectionRow;
}

/**
 * Counts payment_collections rows that represent money the operator has
 * already attempted to collect for this reservation — UNCONFIRMED + CONFIRMED.
 * DISPUTED rows are excluded (those were rejected and never moved money).
 * Used by the detail page to warn before a second Ödeme Topla.
 */
export async function countActivePaymentsForReservation(
  reservationId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('payment_collections')
    .select('id', { count: 'exact', head: true })
    .eq('reservation_id', reservationId)
    .in('status', ['UNCONFIRMED', 'CONFIRMED'] satisfies PaymentStatus[]);
  if (error) throw wrapErr(error);
  return count ?? 0;
}

/** A payment that was collected and is still waiting for a manager's approval. */
export interface PendingPayment {
  id: string;
  amount: number;
  method: PaymentMethod;
  /** When it was collected. */
  created_at: string;
}

/**
 * The payments of one reservation still waiting for approval (UNCONFIRMED),
 * newest first — the Cari Hesap section lists them next to the ledger rows.
 *
 * Deliberately UNCONFIRMED only: a CONFIRMED payment already has its ledger
 * row, so returning it here would count it twice; a DISPUTED one was rejected
 * and never moved money.
 *
 * Not paged: this is one reservation's handful of rows, nowhere near Max Rows.
 * An amount that is not a readable number throws instead of reaching a sum.
 */
export async function listPendingPaymentsForReservation(
  reservationId: string,
): Promise<PendingPayment[]> {
  const { data, error } = await supabase
    .from('payment_collections')
    .select('id, amount, method, created_at')
    .eq('reservation_id', reservationId)
    .eq('status', 'UNCONFIRMED' satisfies PaymentStatus)
    .order('created_at', { ascending: false });
  if (error) throw wrapErr(error);

  const rows = (data ?? []) as { id: string; amount: unknown; method: PaymentMethod; created_at: string }[];
  return rows.map((row) => {
    // null and '' are refused explicitly: Number() turns both into 0.
    const amount =
      typeof row.amount === 'number'
        ? row.amount
        : typeof row.amount === 'string' && row.amount.trim() !== ''
          ? Number(row.amount)
          : NaN;
    if (!Number.isFinite(amount)) {
      throw new Error('Ödemeler yüklenemedi: okunamayan bir tutar var.');
    }
    return { id: row.id, amount, method: row.method, created_at: row.created_at };
  });
}

/**
 * Returns a Map of reservation_id → total collected amount across active
 * (UNCONFIRMED or CONFIRMED) payment_collections rows. Lets the reservation
 * list render a "Kısmi / tam / fazladan Ödeme Alındı" badge per card by
 * comparing the collected sum against the reservation total, without an N+1
 * query loop. DISPUTED payments are excluded — those were rejected.
 *
 * Goes through fetchAllRows: a single request is silently cut at the server's
 * Max Rows, and a dropped payment row makes a paid stay read as unpaid or
 * partial. A failed request throws, so callers never see an understated sum —
 * and so does an amount that is not a number: added into a sum it would turn
 * the whole sum into NaN, which compares false to everything and would let
 * that stay drop off the Borçlular list as if it were settled.
 */
export async function loadReservationsWithPayments(): Promise<Map<string, number>> {
  const data = await fetchAllRows<{ id: string; reservation_id: string; amount: number }>(
    () =>
      supabase
        .from('payment_collections')
        .select('id, reservation_id, amount', { count: 'exact' })
        .in('status', ['UNCONFIRMED', 'CONFIRMED'] satisfies PaymentStatus[]),
    wrapErr,
  );
  const map = new Map<string, number>();
  for (const row of data) {
    if (!row.reservation_id) continue;
    const amount = Number(row.amount);
    if (!Number.isFinite(amount)) {
      throw new Error('Ödemeler yüklenemedi: okunamayan bir tutar var.');
    }
    map.set(row.reservation_id, (map.get(row.reservation_id) ?? 0) + amount);
  }
  return map;
}

/**
 * Manager rejects a pending payment. Row is marked DISPUTED; no ledger/cash
 * entries are ever created. The row stays as an audit record.
 */
export async function disputePayment(paymentId: string): Promise<PaymentCollectionRow> {
  const { data, error } = await supabase.rpc('dispute_payment', { _payment_id: paymentId });
  if (error) throw wrapErr(error);
  return data as unknown as PaymentCollectionRow;
}
