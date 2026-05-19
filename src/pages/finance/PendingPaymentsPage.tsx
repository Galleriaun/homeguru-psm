import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  listUnconfirmedPayments,
  confirmPayment,
  disputePayment,
  type PendingPaymentWithRefs,
} from '@/lib/queries/payments';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { FinanceTabs } from './FinanceTabs';
import { formatTRY, formatDate } from '@/lib/utils';
import type { PaymentMethod } from '@/types/database';

const METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Nakit',
  TRANSFER: 'Havale / EFT',
  CARD: 'Kart',
};

type Pending = 'confirm' | 'dispute';

export function PendingPaymentsPage() {
  const [items, setItems] = useState<PendingPaymentWithRefs[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Per-row in-flight action so the right button can show a spinner
  const [activeRow, setActiveRow] = useState<{ id: string; action: Pending } | null>(
    null,
  );

  // Single confirm-or-dispute confirmation dialog reused for both actions
  const [pending, setPending] = useState<{
    item: PendingPaymentWithRefs;
    action: Pending;
  } | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    listUnconfirmedPayments()
      .then(setItems)
      .catch((e) => setError(e?.message ?? 'Yüklenemedi'));
  }, []);

  const handleConfirm = async () => {
    if (!pending) return;
    setDialogError(null);
    setActiveRow({ id: pending.item.id, action: pending.action });
    try {
      if (pending.action === 'confirm') {
        await confirmPayment(pending.item.id);
      } else {
        await disputePayment(pending.item.id);
      }
      // Remove from queue (either resolved direction takes the row out of UNCONFIRMED)
      setItems((prev) => prev?.filter((p) => p.id !== pending.item.id) ?? prev);
      setPending(null);
    } catch (e) {
      setDialogError(e instanceof Error ? e.message : 'İşlem başarısız');
    } finally {
      setActiveRow(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
            Onay Bekleyen Tahsilatlar
          </h1>
          <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
            Temizlik personeli tarafından toplanmış, henüz onaylanmamış tahsilatlar.
          </p>
        </div>
        <FinanceTabs />
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40">
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </Card>
      )}

      {!items && !error && (
        <p className="text-sm text-stone-600 dark:text-stone-300">Yükleniyor…</p>
      )}

      {items && items.length === 0 && (
        <Card>
          <p className="text-center text-sm text-stone-600 dark:text-stone-300">
            Onay bekleyen tahsilat yok.
          </p>
        </Card>
      )}

      {items && items.length > 0 && (
        <>
          {/* Mobile: stacked cards */}
          <div className="space-y-2 sm:hidden">
            {items.map((it) => {
              const isConfirming =
                activeRow?.id === it.id && activeRow.action === 'confirm';
              const isDisputing =
                activeRow?.id === it.id && activeRow.action === 'dispute';
              const inFlight = isConfirming || isDisputing;
              return (
                <div
                  key={it.id}
                  className="rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-900"
                >
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      to={`/reservations/${it.reservation_id}`}
                      className="min-w-0 flex-1 font-semibold text-stone-900 hover:underline dark:text-stone-100"
                    >
                      {it.reservation?.guest?.full_name ?? '—'}
                    </Link>
                    <p className="shrink-0 font-semibold text-stone-900 dark:text-stone-100">
                      {formatTRY(Number(it.amount))}
                    </p>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-stone-600 dark:text-stone-300">
                    {it.property?.name ?? '—'} ·{' '}
                    {it.reservation?.unit?.name ?? ''}
                  </p>
                  <p className="mt-1 text-xs text-stone-700 dark:text-stone-300">
                    {METHOD_LABELS[it.method]} · {formatDate(it.created_at)}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1"
                      loading={isConfirming}
                      disabled={inFlight}
                      onClick={() => {
                        setDialogError(null);
                        setPending({ item: it, action: 'confirm' });
                      }}
                    >
                      Onayla
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      className="flex-1"
                      loading={isDisputing}
                      disabled={inFlight}
                      onClick={() => {
                        setDialogError(null);
                        setPending({ item: it, action: 'dispute' });
                      }}
                    >
                      İtiraz
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Tablet+ : table */}
          <Card className="hidden p-0 sm:block">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-stone-300 text-xs uppercase text-stone-600 dark:border-stone-700 dark:text-stone-300">
                  <tr>
                    <th className="px-6 py-3 font-medium">Misafir</th>
                    <th className="px-6 py-3 font-medium">Mülk / Birim</th>
                    <th className="px-6 py-3 font-medium">Yöntem</th>
                    <th className="px-6 py-3 text-right font-medium">Tutar</th>
                    <th className="px-6 py-3 font-medium">Toplandı</th>
                    <th className="px-6 py-3" aria-label="İşlemler" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-300 dark:divide-stone-700">
                  {items.map((it) => {
                    const isConfirming =
                      activeRow?.id === it.id && activeRow.action === 'confirm';
                    const isDisputing =
                      activeRow?.id === it.id && activeRow.action === 'dispute';
                    const inFlight = isConfirming || isDisputing;
                    return (
                      <tr key={it.id}>
                        <td className="px-6 py-3">
                          <Link
                            to={`/reservations/${it.reservation_id}`}
                            className="text-base font-semibold text-stone-900 hover:underline dark:text-stone-100"
                          >
                            {it.reservation?.guest?.full_name ?? '—'}
                          </Link>
                        </td>
                        <td className="px-6 py-3 text-stone-700 dark:text-stone-300">
                          <div>{it.property?.name ?? '—'}</div>
                          <div className="text-xs text-stone-600 dark:text-stone-300">
                            {it.reservation?.unit?.name ?? ''}
                          </div>
                        </td>
                        <td className="px-6 py-3 text-stone-700 dark:text-stone-300">
                          {METHOD_LABELS[it.method]}
                        </td>
                        <td className="px-6 py-3 text-right font-semibold text-stone-900 dark:text-stone-100">
                          {formatTRY(Number(it.amount))}
                        </td>
                        <td className="px-6 py-3 text-stone-700 dark:text-stone-300">
                          {formatDate(it.created_at)}
                        </td>
                        <td className="px-6 py-3">
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              loading={isConfirming}
                              disabled={inFlight}
                              onClick={() => {
                                setDialogError(null);
                                setPending({ item: it, action: 'confirm' });
                              }}
                            >
                              Onayla
                            </Button>
                            <Button
                              variant="danger"
                              size="sm"
                              loading={isDisputing}
                              disabled={inFlight}
                              onClick={() => {
                                setDialogError(null);
                                setPending({ item: it, action: 'dispute' });
                              }}
                            >
                              İtiraz
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.action === 'confirm'
            ? 'Tahsilat onaylansın mı?'
            : 'Tahsilat reddedilsin mi?'
        }
        description={
          pending && (
            <>
              <p>
                <strong>
                  {pending.item.reservation?.guest?.full_name ?? 'Misafir'}
                </strong>{' '}
                — {METHOD_LABELS[pending.item.method]}{' '}
                <strong>{formatTRY(Number(pending.item.amount))}</strong>
              </p>
              <p className="mt-2 text-sm">
                {pending.action === 'confirm'
                  ? 'Onaylandığında misafir cari hesabına ödeme kaydı ve nakit yöntemde kasaya giriş eklenir.'
                  : 'Reddedilen tahsilat kayıt olarak kalır ancak cari hesabı ve kasayı etkilemez.'}
              </p>
            </>
          )
        }
        confirmLabel={pending?.action === 'confirm' ? 'Onayla' : 'Reddet'}
        destructive={pending?.action === 'dispute'}
        loading={activeRow !== null}
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
