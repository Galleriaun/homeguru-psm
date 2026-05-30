import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  listUnconfirmedPayments,
  confirmPayment,
  disputePayment,
  type PendingPaymentWithRefs,
} from '@/lib/queries/payments';
import {
  approveCashTransaction,
  approveExpense,
  listPendingCashTransactions,
  listPendingExpenses,
  rejectCashTransaction,
  rejectExpense,
  type PendingCashTx,
  type PendingExpense,
} from '@/lib/queries/pendingApprovals';
import { loadStaffDirectory } from '@/lib/queries/staff_directory';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { FinanceTabs } from './FinanceTabs';
import { cn, formatTRY, formatDate } from '@/lib/utils';
import type { PaymentMethod } from '@/types/database';

const METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Nakit',
  TRANSFER: 'Havale / EFT',
  CARD: 'Kart',
};

type Tab = 'payments' | 'expenses' | 'cash_tx';

/** Per-action state used to spin the right button + drive the confirm dialog. */
type PendingAction =
  | { type: 'confirm-payment'; item: PendingPaymentWithRefs }
  | { type: 'dispute-payment'; item: PendingPaymentWithRefs }
  | { type: 'approve-expense'; item: PendingExpense }
  | { type: 'reject-expense'; item: PendingExpense }
  | { type: 'approve-cash'; item: PendingCashTx }
  | { type: 'reject-cash'; item: PendingCashTx };

/**
 * Three-in-one approval queue. PROPERTY_MANAGER submissions land in the
 * relevant sub-list as 'pending'; SUPER_ADMIN approves or rejects. The
 * payment confirmations tab continues to drive the existing UNCONFIRMED →
 * confirmed flow; expenses + manual kasa entries are new in migration 055.
 */
export function PendingPaymentsPage() {
  const [tab, setTab] = useState<Tab>('payments');

  const [payments, setPayments] = useState<PendingPaymentWithRefs[] | null>(null);
  const [expenses, setExpenses] = useState<PendingExpense[] | null>(null);
  const [cashTxs, setCashTxs] = useState<PendingCashTx[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [pending, setPending] = useState<PendingAction | null>(null);
  const [inFlight, setInFlight] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [staffMap, setStaffMap] = useState<Map<string, string>>(() => new Map());

  const refreshAll = useCallback(() => {
    setLoadError(null);
    Promise.allSettled([
      listUnconfirmedPayments(),
      listPendingExpenses(),
      listPendingCashTransactions(),
    ]).then(([p, e, c]) => {
      if (p.status === 'fulfilled') setPayments(p.value);
      else setLoadError(p.reason?.message ?? 'Tahsilatlar yüklenemedi');
      if (e.status === 'fulfilled') setExpenses(e.value);
      else setLoadError(e.reason?.message ?? 'Giderler yüklenemedi');
      if (c.status === 'fulfilled') setCashTxs(c.value);
      else setLoadError(c.reason?.message ?? 'Kasa hareketleri yüklenemedi');
    });
  }, []);

  useEffect(() => {
    refreshAll();
    // Best-effort: powers the "Oluşturan: X" line on each Tahsilat box.
    loadStaffDirectory().then(setStaffMap).catch(() => {});
  }, [refreshAll]);

  const handleConfirm = async () => {
    if (!pending) return;
    setDialogError(null);
    setInFlight(true);
    try {
      switch (pending.type) {
        case 'confirm-payment':
          await confirmPayment(pending.item.id);
          setPayments((prev) => prev?.filter((p) => p.id !== pending.item.id) ?? prev);
          break;
        case 'dispute-payment':
          await disputePayment(pending.item.id);
          setPayments((prev) => prev?.filter((p) => p.id !== pending.item.id) ?? prev);
          break;
        case 'approve-expense':
          await approveExpense(pending.item.id);
          setExpenses((prev) => prev?.filter((e) => e.id !== pending.item.id) ?? prev);
          break;
        case 'reject-expense':
          await rejectExpense(pending.item.id);
          setExpenses((prev) => prev?.filter((e) => e.id !== pending.item.id) ?? prev);
          break;
        case 'approve-cash':
          await approveCashTransaction(pending.item.id);
          setCashTxs((prev) => prev?.filter((t) => t.id !== pending.item.id) ?? prev);
          break;
        case 'reject-cash':
          await rejectCashTransaction(pending.item.id);
          setCashTxs((prev) => prev?.filter((t) => t.id !== pending.item.id) ?? prev);
          break;
      }
      setPending(null);
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : 'İşlem başarısız');
    } finally {
      setInFlight(false);
    }
  };

  const counts = {
    payments: payments?.length ?? 0,
    expenses: expenses?.length ?? 0,
    cash_tx: cashTxs?.length ?? 0,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
            Onay Bekleyen İşlemler
          </h1>
          <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
            Yönetici onayı bekleyen tahsilatlar, giderler ve kasa hareketleri.
          </p>
        </div>
        <FinanceTabs />
      </div>

      {loadError && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40">
          <p className="text-sm text-red-700 dark:text-red-400">{loadError}</p>
        </Card>
      )}

      <SubTabs tab={tab} setTab={setTab} counts={counts} />

      {tab === 'payments' && (
        <PaymentsList
          items={payments}
          staffMap={staffMap}
          onConfirm={(it) => {
            setDialogError(null);
            setPending({ type: 'confirm-payment', item: it });
          }}
          onDispute={(it) => {
            setDialogError(null);
            setPending({ type: 'dispute-payment', item: it });
          }}
        />
      )}

      {tab === 'expenses' && (
        <ExpensesList
          items={expenses}
          onApprove={(it) => {
            setDialogError(null);
            setPending({ type: 'approve-expense', item: it });
          }}
          onReject={(it) => {
            setDialogError(null);
            setPending({ type: 'reject-expense', item: it });
          }}
        />
      )}

      {tab === 'cash_tx' && (
        <CashTxList
          items={cashTxs}
          onApprove={(it) => {
            setDialogError(null);
            setPending({ type: 'approve-cash', item: it });
          }}
          onReject={(it) => {
            setDialogError(null);
            setPending({ type: 'reject-cash', item: it });
          }}
        />
      )}

      <ConfirmDialog
        open={pending !== null}
        title={pending ? actionTitle(pending) : ''}
        description={pending ? actionDescription(pending) : null}
        confirmLabel={pending ? actionConfirmLabel(pending) : 'Onayla'}
        destructive={pending ? isDestructive(pending) : false}
        loading={inFlight}
        error={dialogError}
        onConfirm={handleConfirm}
        onCancel={() => {
          setPending(null);
          setDialogError(null);
        }}
      />
    </div>
  );
}

// ----------------------------------------------------------------------------
// Sub-tabs strip — picks between the three queues.
// ----------------------------------------------------------------------------
function SubTabs({
  tab,
  setTab,
  counts,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  counts: Record<Tab, number>;
}) {
  const entries: { value: Tab; label: string }[] = [
    { value: 'payments', label: 'Tahsilat' },
    { value: 'expenses', label: 'Gider' },
    { value: 'cash_tx', label: 'Kasa Hareketi' },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {entries.map((e) => (
        <button
          key={e.value}
          type="button"
          onClick={() => setTab(e.value)}
          className={cn(
            'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            tab === e.value
              ? 'bg-emerald-600 text-white'
              : 'border border-stone-300 text-stone-700 hover:bg-stone-100 dark:border-stone-600 dark:text-stone-300 dark:hover:bg-stone-800',
          )}
        >
          {e.label}
          {counts[e.value] > 0 && (
            <span
              className={cn(
                'rounded-full px-1.5 text-xs font-semibold',
                tab === e.value
                  ? 'bg-white/20 text-white'
                  : 'bg-stone-200 text-stone-700 dark:bg-stone-700 dark:text-stone-200',
              )}
            >
              {counts[e.value]}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Tahsilat list — wraps the existing UNCONFIRMED → confirm/dispute flow.
// ----------------------------------------------------------------------------
function PaymentsList({
  items,
  staffMap,
  onConfirm,
  onDispute,
}: {
  items: PendingPaymentWithRefs[] | null;
  staffMap: Map<string, string>;
  onConfirm: (it: PendingPaymentWithRefs) => void;
  onDispute: (it: PendingPaymentWithRefs) => void;
}) {
  if (items === null) {
    return <p className="text-sm text-stone-600 dark:text-stone-300">Yükleniyor…</p>;
  }
  if (items.length === 0) {
    return (
      <Card>
        <p className="text-center text-sm text-stone-600 dark:text-stone-300">
          Onay bekleyen tahsilat yok.
        </p>
      </Card>
    );
  }
  return (
    <div className="space-y-2">
      {items.map((it) => (
        <div
          key={it.id}
          className="rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-900"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <Link
                to={`/reservations/${it.reservation_id}`}
                className="font-semibold text-stone-900 hover:underline dark:text-stone-100"
              >
                {it.reservation?.guest?.full_name ?? '—'}
              </Link>
              <p className="mt-0.5 truncate text-xs text-stone-600 dark:text-stone-300">
                {it.property?.name ?? '—'} · {it.reservation?.unit?.name ?? ''}
              </p>
              <p className="mt-1 text-xs text-stone-700 dark:text-stone-300">
                {METHOD_LABELS[it.method]} · {formatDate(it.created_at)}
              </p>
              {staffMap.get(it.collected_by_user_id) && (
                <p className="mt-1 text-[11px] text-stone-500 dark:text-stone-400">
                  Oluşturan: {staffMap.get(it.collected_by_user_id)}
                </p>
              )}
            </div>
            <p className="font-semibold text-stone-900 dark:text-stone-100">
              {formatTRY(Number(it.amount))}
            </p>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" onClick={() => onConfirm(it)}>
              Onayla
            </Button>
            <Button variant="danger" size="sm" onClick={() => onDispute(it)}>
              İtiraz
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Gider list — new in migration 055.
// ----------------------------------------------------------------------------
function ExpensesList({
  items,
  onApprove,
  onReject,
}: {
  items: PendingExpense[] | null;
  onApprove: (it: PendingExpense) => void;
  onReject: (it: PendingExpense) => void;
}) {
  if (items === null) {
    return <p className="text-sm text-stone-600 dark:text-stone-300">Yükleniyor…</p>;
  }
  if (items.length === 0) {
    return (
      <Card>
        <p className="text-center text-sm text-stone-600 dark:text-stone-300">
          Onay bekleyen gider yok.
        </p>
      </Card>
    );
  }
  return (
    <div className="space-y-2">
      {items.map((it) => (
        <div
          key={it.id}
          className="rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-900"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-stone-900 dark:text-stone-100">
                {it.category}
              </p>
              <p className="mt-0.5 truncate text-xs text-stone-600 dark:text-stone-300">
                {it.property?.name ?? 'Genel'} · {formatDate(it.expense_date)}
              </p>
              {it.description && (
                <p className="mt-1 text-xs text-stone-700 dark:text-stone-300">
                  {it.description}
                </p>
              )}
              {it.paid_from_kasa && (
                <p className="mt-1 inline-block rounded bg-stone-100 px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-stone-700 dark:bg-stone-800 dark:text-stone-300">
                  Kasadan düşülür
                </p>
              )}
            </div>
            <p className="font-semibold text-stone-900 dark:text-stone-100">
              {formatTRY(Number(it.amount))}
            </p>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" onClick={() => onApprove(it)}>
              Onayla
            </Button>
            <Button variant="danger" size="sm" onClick={() => onReject(it)}>
              Reddet
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Kasa hareketi list — manual cash entries awaiting review.
// ----------------------------------------------------------------------------
function CashTxList({
  items,
  onApprove,
  onReject,
}: {
  items: PendingCashTx[] | null;
  onApprove: (it: PendingCashTx) => void;
  onReject: (it: PendingCashTx) => void;
}) {
  if (items === null) {
    return <p className="text-sm text-stone-600 dark:text-stone-300">Yükleniyor…</p>;
  }
  if (items.length === 0) {
    return (
      <Card>
        <p className="text-center text-sm text-stone-600 dark:text-stone-300">
          Onay bekleyen kasa hareketi yok.
        </p>
      </Card>
    );
  }
  return (
    <div className="space-y-2">
      {items.map((it) => (
        <div
          key={it.id}
          className="rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-900"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-stone-900 dark:text-stone-100">
                {it.direction === 'IN' ? '↓ Gelir' : '↑ Gider'}
              </p>
              <p className="mt-0.5 truncate text-xs text-stone-600 dark:text-stone-300">
                {formatDate(it.created_at)}
              </p>
              {it.description && (
                <p className="mt-1 text-xs text-stone-700 dark:text-stone-300">
                  {it.description}
                </p>
              )}
            </div>
            <p
              className={cn(
                'font-semibold',
                it.direction === 'IN'
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-red-700 dark:text-red-400',
              )}
            >
              {it.direction === 'IN' ? '+' : '−'}
              {formatTRY(Number(it.amount))}
            </p>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" onClick={() => onApprove(it)}>
              Onayla
            </Button>
            <Button variant="danger" size="sm" onClick={() => onReject(it)}>
              Reddet
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------------------
// ConfirmDialog copy helpers — keeps the JSX above tidy.
// ----------------------------------------------------------------------------
function actionTitle(a: PendingAction): string {
  switch (a.type) {
    case 'confirm-payment':
      return 'Tahsilat onaylansın mı?';
    case 'dispute-payment':
      return 'Tahsilat reddedilsin mi?';
    case 'approve-expense':
      return 'Gider onaylansın mı?';
    case 'reject-expense':
      return 'Gider reddedilsin mi?';
    case 'approve-cash':
      return 'Kasa hareketi onaylansın mı?';
    case 'reject-cash':
      return 'Kasa hareketi reddedilsin mi?';
  }
}

function actionConfirmLabel(a: PendingAction): string {
  return isDestructive(a) ? 'Reddet' : 'Onayla';
}

function isDestructive(a: PendingAction): boolean {
  return a.type.startsWith('dispute-') || a.type.startsWith('reject-');
}

function actionDescription(a: PendingAction): ReactNode {
  switch (a.type) {
    case 'confirm-payment':
      return (
        <p className="text-sm">
          <strong>{a.item.reservation?.guest?.full_name ?? 'Misafir'}</strong> —{' '}
          {METHOD_LABELS[a.item.method]}{' '}
          <strong>{formatTRY(Number(a.item.amount))}</strong>. Onaylandığında
          cari hesap ve nakitse kasa güncellenir.
        </p>
      );
    case 'dispute-payment':
      return (
        <p className="text-sm">
          <strong>{a.item.reservation?.guest?.full_name ?? 'Misafir'}</strong> —{' '}
          {METHOD_LABELS[a.item.method]}{' '}
          <strong>{formatTRY(Number(a.item.amount))}</strong>. Reddedilen
          tahsilat cari hesabı ve kasayı etkilemez.
        </p>
      );
    case 'approve-expense':
      return (
        <p className="text-sm">
          <strong>{a.item.category}</strong> ·{' '}
          <strong>{formatTRY(Number(a.item.amount))}</strong>
          {a.item.paid_from_kasa && ' — onaylandığında kasadan düşülür.'}
        </p>
      );
    case 'reject-expense':
      return (
        <p className="text-sm">
          <strong>{a.item.category}</strong> ·{' '}
          <strong>{formatTRY(Number(a.item.amount))}</strong>. Reddedilen gider
          kasayı etkilemez.
        </p>
      );
    case 'approve-cash':
      return (
        <p className="text-sm">
          {a.item.direction === 'IN' ? 'Gelir' : 'Gider'}:{' '}
          <strong>{formatTRY(Number(a.item.amount))}</strong>. Onaylandığında
          kasa bakiyesine yansır.
        </p>
      );
    case 'reject-cash':
      return (
        <p className="text-sm">
          {a.item.direction === 'IN' ? 'Gelir' : 'Gider'}:{' '}
          <strong>{formatTRY(Number(a.item.amount))}</strong>. Reddedilen
          hareket kasa bakiyesini etkilemez.
        </p>
      );
  }
}
