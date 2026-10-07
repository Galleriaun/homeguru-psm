import type { LedgerEntryType, PaymentMethod } from '@/types/database';
import { tPaymentMethods } from '@/lib/utils';

/**
 * What the Cari Hesap section of a reservation shows — its rows and its totals.
 *
 * The database knows two things about a reservation's money:
 *   - ledger rows: charges, and payments a manager has APPROVED
 *   - pending payments: collected, still waiting for approval. They have no
 *     ledger row yet — confirm_payment writes it.
 *
 * Who is looking decides how the two are put together (owner rules, 2026-10-06):
 *
 *   showApproval = true   Yönetici, Alt Yönetici, Yönetici Bornova
 *     Pending payments are listed and marked. They are summed on their own line
 *     and stay OUT of Toplam Ödeme and Bakiye, so Bakiye keeps matching the kasa
 *     and the Hesabı Kilitle rule (both of which only know approved money).
 *
 *   showApproval = false  Personel, Personel Bornova, Teknik Personel
 *     Pending and approved payments are listed and look identical, and both
 *     count in Toplam Ödeme and Bakiye. Nothing may say or imply which is which:
 *     the "(onaylandı)" wording is removed, a payment is dated by when it was
 *     COLLECTED (the ledger date is the approval moment), and its row key is the
 *     collection id — so when a manager approves it, not one thing on this
 *     viewer's screen changes. tests/cariHesap.check.mjs pins exactly that.
 *
 * This is display logic only. The API still returns the status to anyone who may
 * read the rows; the server does not hide it.
 */

/** The part of a ledger_entries row this view reads. */
export interface CariLedgerRow {
  id: string;
  type: LedgerEntryType;
  amount: number | string;
  note: string | null;
  created_at: string;
  created_by: string | null;
  payment_collection_id?: string | null;
  payment_collection?: { method: PaymentMethod; created_at?: string | null } | null;
}

/** A payment_collections row with status UNCONFIRMED. */
export interface CariPendingPayment {
  id: string;
  amount: number | string;
  method: PaymentMethod;
  created_at: string;
}

export interface CariRow<L extends CariLedgerRow = CariLedgerRow> {
  key: string;
  kind: LedgerEntryType;
  /** In TL. */
  amount: number;
  /** The instant shown in the Tarih column. */
  at: string;
  description: string;
  /** Waiting for approval. Always false when the viewer may not see approval. */
  pending: boolean;
  /** Posted by the system (auto-debit): shown with the "Sistem" chip. */
  system: boolean;
  /** The ledger row behind this line; null for a pending payment, which has none yet. */
  entry: L | null;
}

export interface CariView<L extends CariLedgerRow = CariLedgerRow> {
  /** Newest first. */
  rows: CariRow<L>[];
  totalDebt: number;
  totalPayment: number;
  /** Payments waiting for approval, in TL. Always 0 when the viewer may not see approval. */
  pendingTotal: number;
  /** totalDebt − totalPayment. Positive: the guest owes. */
  balance: number;
  /** Distinct methods of the payments counted in totalPayment, in row order. */
  methods: PaymentMethod[];
}

/**
 * Amounts are numeric(10,2) and may arrive as a number or as a string. Sums are
 * kept in whole kuruş so that 0.10 + 0.20 − 0.30 is exactly zero — in floating
 * point it is not, and a settled account would read "Misafir borçlu".
 *
 * Anything that is not a readable number throws: on this screen it would
 * otherwise become part of a total. null and '' are refused explicitly —
 * Number() turns both into 0.
 */
function toKurus(raw: unknown): number {
  const n =
    typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  if (!Number.isFinite(n)) {
    throw new Error('Cari hesap gösterilemiyor: okunamayan bir tutar var.');
  }
  return Math.round(n * 100);
}

// "(onaylandı)" is what confirm_payment appends to the note; the other two are
// covered so no spelling of the status can reach a viewer who must not see it.
// ı / İ are listed by hand: JavaScript's case-insensitive matching does not
// fold the Turkish dotted and dotless i.
const APPROVAL_WORDING = /\s*\(\s*(?:onayland[ıiİ]|onaylanmad[ıiİ]|onay\s+bekl[iİı]yor)\s*\)/giu;

function hideApprovalWording(text: string): string {
  return text.replace(APPROVAL_WORDING, '').trim() || '—';
}

export function buildCariView<L extends CariLedgerRow>(
  ledger: readonly L[],
  pending: readonly CariPendingPayment[],
  showApproval: boolean,
): CariView<L> {
  interface Line {
    row: CariRow<L>;
    at: number;
    method: PaymentMethod | null;
    /** Part of totalPayment for this viewer. */
    counted: boolean;
  }

  let debtKurus = 0;
  let approvedKurus = 0;
  let pendingKurus = 0;
  const lines: Line[] = [];
  const keys = new Set<string>();
  /** Collections that already have a ledger row, i.e. are approved. */
  const approvedCollections = new Set<string>();

  for (const entry of ledger) {
    const kurus = toKurus(entry.amount);

    if (entry.type === 'DEBT') {
      debtKurus += kurus;
      const key = `le:${entry.id}`;
      keys.add(key);
      lines.push({
        row: {
          key,
          kind: 'DEBT',
          amount: kurus / 100,
          at: entry.created_at,
          // A charge is never rewritten: its note is what a person typed.
          description: tPaymentMethods(entry.note),
          pending: false,
          system: entry.created_by === null,
          entry,
        },
        at: Date.parse(entry.created_at),
        method: null,
        counted: false,
      });
      continue;
    }

    approvedKurus += kurus;
    const collectionId = entry.payment_collection_id ?? null;
    if (collectionId) approvedCollections.add(collectionId);

    // Keyed by the collection so the row keeps its identity across approval;
    // the ledger id is the fallback for rows that predate collections, and for
    // the (unexpected) case of two ledger rows sharing one collection.
    let key = collectionId ? `pc:${collectionId}` : `le:${entry.id}`;
    if (keys.has(key)) key = `le:${entry.id}`;
    keys.add(key);

    const collectedAt = entry.payment_collection?.created_at;
    const at = !showApproval && collectedAt ? collectedAt : entry.created_at;
    const text = tPaymentMethods(entry.note);
    lines.push({
      row: {
        key,
        kind: 'PAYMENT',
        amount: kurus / 100,
        at,
        description: showApproval ? text : hideApprovalWording(text),
        pending: false,
        system: entry.created_by === null,
        entry,
      },
      at: Date.parse(at),
      method: entry.payment_collection?.method ?? null,
      counted: true,
    });
  }

  for (const payment of pending) {
    // The two lists come from two requests. A payment approved in between can
    // arrive in both: the ledger row wins, so it is listed and counted once.
    const key = `pc:${payment.id}`;
    if (approvedCollections.has(payment.id) || keys.has(key)) continue;
    keys.add(key);

    const kurus = toKurus(payment.amount);
    pendingKurus += kurus;
    lines.push({
      row: {
        key,
        kind: 'PAYMENT',
        amount: kurus / 100,
        at: payment.created_at,
        description: tPaymentMethods(`Ödeme — ${payment.method}`),
        pending: showApproval,
        system: false,
        entry: null,
      },
      at: Date.parse(payment.created_at),
      method: payment.method,
      counted: !showApproval,
    });
  }

  // Newest first. An unreadable date sorts last; equal instants fall back to
  // the key, so the order is total and never shuffles between renders.
  lines.sort((a, b) => {
    const aBad = Number.isNaN(a.at);
    const bBad = Number.isNaN(b.at);
    if (aBad !== bBad) return aBad ? 1 : -1;
    if (!aBad && a.at !== b.at) return b.at - a.at;
    return a.row.key < b.row.key ? -1 : a.row.key > b.row.key ? 1 : 0;
  });

  const methods: PaymentMethod[] = [];
  for (const line of lines) {
    if (line.counted && line.method && !methods.includes(line.method)) methods.push(line.method);
  }

  const paidKurus = showApproval ? approvedKurus : approvedKurus + pendingKurus;
  return {
    rows: lines.map((line) => line.row),
    totalDebt: debtKurus / 100,
    totalPayment: paidKurus / 100,
    pendingTotal: showApproval ? pendingKurus / 100 : 0,
    balance: (debtKurus - paidKurus) / 100,
    methods,
  };
}
