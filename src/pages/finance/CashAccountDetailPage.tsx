import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { can } from '@/lib/rbac';
import {
  getCashAccount,
  listCashTransactions,
  deleteCashAccount,
  balanceOf,
  type CashAccount,
  type CashTransaction,
} from '@/lib/queries/cashAccounts';
import { getProperty, type Property } from '@/lib/queries/properties';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CashTxModal } from './CashTxModal';
import { formatTRY, formatDate } from '@/lib/utils';
import type { AccountType, TxDirection } from '@/types/database';

const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  CASH: 'Nakit',
  BANK: 'Banka',
  CARD: 'Kredi Kartı',
};

const DIRECTION_LABEL: Record<TxDirection, string> = {
  IN: 'Gelir',
  OUT: 'Gider',
};

const timeFmt = new Intl.DateTimeFormat('tr-TR', { timeStyle: 'short' });
function formatTime(iso: string): string {
  return timeFmt.format(new Date(iso));
}

export function CashAccountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { profile, user } = useAuth();
  const navigate = useNavigate();

  const [account, setAccount] = useState<CashAccount | null>(null);
  const [property, setProperty] = useState<Property | null>(null);
  const [transactions, setTransactions] = useState<CashTransaction[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [showTxModal, setShowTxModal] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const canWrite = Boolean(profile && can(profile.role, 'finance:write'));

  useEffect(() => {
    if (!id) return;
    setError(null);
    (async () => {
      try {
        const a = await getCashAccount(id);
        if (!a) {
          setError('Kasa bulunamadı');
          return;
        }
        setAccount(a);
        const [p, txs] = await Promise.all([
          getProperty(a.property_id),
          listCashTransactions(a.id),
        ]);
        setProperty(p);
        setTransactions(txs);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Yüklenemedi');
      }
    })();
  }, [id]);

  if (error) {
    return (
      <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40">
        <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        <Link
          to="/finance/cash"
          className="mt-3 inline-block text-sm text-emerald-600 hover:underline dark:text-emerald-500"
        >
          ← Kasalara dön
        </Link>
      </Card>
    );
  }

  if (!account) {
    return <p className="text-sm text-stone-600 dark:text-stone-300">Yükleniyor…</p>;
  }

  const balance = balanceOf(transactions);

  const handleDelete = async () => {
    if (!id) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteCashAccount(id);
      navigate('/finance/cash', { replace: true });
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Silme başarısız');
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Link
        to="/finance/cash"
        className="inline-block text-sm text-emerald-600 hover:underline dark:text-emerald-500"
      >
        ← Kasalar
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
            {account.name}
          </h1>
          <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
            {property?.name} · {ACCOUNT_TYPE_LABEL[account.account_type]} · {account.currency}
          </p>
        </div>
        <div className="flex gap-2">
          {canWrite && (
            <>
              <Link to={`/finance/cash/${account.id}/edit`}>
                <Button variant="secondary" size="sm">
                  Düzenle
                </Button>
              </Link>
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  setDeleteError(null);
                  setConfirmDelete(true);
                }}
              >
                Sil
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Balance card */}
      <Card className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-stone-600 dark:text-stone-300">
            Güncel Bakiye
          </p>
          <p
            className={
              balance >= 0
                ? 'mt-1 text-3xl font-semibold text-emerald-600 dark:text-emerald-400'
                : 'mt-1 text-3xl font-semibold text-red-600 dark:text-red-400'
            }
          >
            {formatTRY(balance)}
          </p>
          <p className="mt-1 text-xs text-stone-600 dark:text-stone-300">
            {transactions.length} hareket
          </p>
        </div>
        {canWrite && (
          <Button onClick={() => setShowTxModal(true)}>+ İşlem Ekle</Button>
        )}
      </Card>

      {/* Transactions table */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
          Hareketler
        </h2>
        {transactions.length === 0 ? (
          <Card>
            <p className="text-center text-sm text-stone-600 dark:text-stone-300">
              Henüz hareket yok. Sağ üstteki “İşlem Ekle” butonu ile başlayın.
            </p>
          </Card>
        ) : (
          <Card className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-stone-300 text-xs uppercase text-stone-600 dark:border-stone-700 dark:text-stone-300">
                  <tr>
                    <th className="px-6 py-3 font-medium">Tarih</th>
                    <th className="px-6 py-3 font-medium">Yön</th>
                    <th className="px-6 py-3 font-medium">Açıklama</th>
                    <th className="px-6 py-3 text-right font-medium">Tutar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-300 dark:divide-stone-700">
                  {transactions.map((t) => {
                    const positive = t.direction === 'IN';
                    return (
                      <tr key={t.id}>
                        <td className="px-6 py-3 text-stone-700 dark:text-stone-300">
                          <div>{formatDate(t.created_at)}</div>
                          <div className="text-xs text-stone-600 dark:text-stone-300">
                            {formatTime(t.created_at)}
                          </div>
                        </td>
                        <td className="px-6 py-3">
                          <span
                            className={
                              positive
                                ? 'rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                                : 'rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950/40 dark:text-red-400'
                            }
                          >
                            {DIRECTION_LABEL[t.direction]}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-stone-700 dark:text-stone-300">
                          {t.description || '—'}
                        </td>
                        <td
                          className={
                            positive
                              ? 'px-6 py-3 text-right font-semibold text-emerald-600 dark:text-emerald-400'
                              : 'px-6 py-3 text-right font-semibold text-red-600 dark:text-red-400'
                          }
                        >
                          {positive ? '+' : '−'}
                          {formatTRY(Number(t.amount))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </section>

      {showTxModal && user && (
        <CashTxModal
          accountId={account.id}
          createdByUserId={user.id}
          onClose={() => setShowTxModal(false)}
          onCreated={(tx) => {
            setTransactions((prev) => [tx, ...prev]);
            setShowTxModal(false);
          }}
        />
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={`"${account.name}" kasası silinsin mi?`}
        description={
          <>
            <p>Bu işlem geri alınamaz.</p>
            <p className="mt-2 font-medium">
              Not: Hareket kaydı bulunan kasalar silinemez.
            </p>
          </>
        }
        confirmLabel="Sil"
        destructive
        loading={deleting}
        error={deleteError}
        onConfirm={handleDelete}
        onCancel={() => {
          setConfirmDelete(false);
          setDeleteError(null);
        }}
      />
    </div>
  );
}
