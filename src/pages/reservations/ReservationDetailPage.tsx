import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { can } from '@/lib/rbac';
import {
  cancelReservation,
  deleteReservation,
  getReservation,
} from '@/lib/queries/reservations';
import { getProperty, type Property } from '@/lib/queries/properties';
import { getUnit, type Unit } from '@/lib/queries/units';
import {
  listLedgerForReservation,
  balanceFor,
  type LedgerEntry,
} from '@/lib/queries/ledger';
import { supabase } from '@/lib/supabase';
import type { Database, ReservationStatus } from '@/types/database';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { LedgerEntryModal } from './LedgerEntryModal';
import { formatDate, formatTRY } from '@/lib/utils';

type Reservation = Database['public']['Tables']['reservations']['Row'];

const STATUS_LABELS: Record<ReservationStatus, string> = {
  pending: 'Beklemede',
  active: 'Aktif',
  completed: 'Tamamlandı',
  cancelled: 'İptal',
};

const timeFmt = new Intl.DateTimeFormat('tr-TR', { timeStyle: 'short' });
function formatTime(iso: string): string {
  return timeFmt.format(new Date(iso));
}

export function ReservationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { profile, user } = useAuth();
  const navigate = useNavigate();

  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [property, setProperty] = useState<Property | null>(null);
  const [unit, setUnit] = useState<Unit | null>(null);
  const [guestName, setGuestName] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Cari hesap (ledger) — gated to finance:read
  const [ledger, setLedger] = useState<LedgerEntry[] | null>(null);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [showLedgerModal, setShowLedgerModal] = useState(false);

  const canSeeLedger = Boolean(profile && can(profile.role, 'finance:read'));
  const canWriteLedger = Boolean(profile && can(profile.role, 'finance:write'));

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const r = await getReservation(id);
        if (!r) {
          setError('Rezervasyon bulunamadı');
          return;
        }
        setReservation(r);
        const [p, u, g] = await Promise.all([
          getProperty(r.property_id),
          getUnit(r.unit_id),
          supabase.from('guests').select('full_name').eq('id', r.guest_id).maybeSingle(),
        ]);
        setProperty(p);
        setUnit(u);
        setGuestName(g.data?.full_name ?? '');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Yüklenemedi');
      }
    })();
  }, [id]);

  // Load the per-reservation ledger only if the user is permitted to see it
  useEffect(() => {
    const rid = reservation?.id;
    if (!rid || !canSeeLedger) {
      setLedger(null);
      return;
    }
    setLedgerError(null);
    listLedgerForReservation(rid)
      .then(setLedger)
      .catch((e) => setLedgerError(e?.message ?? 'Cari yüklenemedi'));
  }, [reservation?.id, canSeeLedger]);

  if (error) {
    return (
      <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40">
        <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        <Link
          to="/reservations"
          className="mt-3 inline-block text-sm text-emerald-600 hover:underline dark:text-emerald-500"
        >
          ← Rezervasyonlara dön
        </Link>
      </Card>
    );
  }

  if (!reservation) {
    return <p className="text-sm text-stone-600 dark:text-stone-300">Yükleniyor…</p>;
  }

  const canEdit = profile && can(profile.role, 'reservation:update');
  const canCancel = profile && can(profile.role, 'reservation:cancel');
  const canDelete = profile && can(profile.role, 'reservation:delete');
  const isCancelled = reservation.status === 'cancelled';

  const handleCancel = async () => {
    if (!id) return;
    setBusy(true);
    try {
      await cancelReservation(id);
      const r = await getReservation(id);
      setReservation(r);
      setConfirmCancel(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'İptal başarısız');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteReservation(id);
      navigate('/reservations', { replace: true });
    } catch (e) {
      // Keep the dialog open and show the reason inside it
      setDeleteError(e instanceof Error ? e.message : 'Silme başarısız');
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Link
        to="/reservations"
        className="inline-block text-sm text-emerald-600 hover:underline dark:text-emerald-500"
      >
        ← Rezervasyonlar
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
            {guestName || '—'}
          </h1>
          <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
            {property?.name} · {unit?.name}
          </p>
        </div>
        <div className="flex gap-2">
          {canEdit && !isCancelled && (
            <Link to={`/reservations/${reservation.id}/edit`}>
              <Button variant="secondary" size="sm">
                Düzenle
              </Button>
            </Link>
          )}
          {canCancel && !isCancelled && (
            <Button
              variant="danger"
              size="sm"
              className="border border-red-300 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-red-950 dark:text-red-400 dark:hover:bg-red-900"
              onClick={() => setConfirmCancel(true)}
            >
              İptal Et
            </Button>
          )}
          {canDelete && (
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
          )}
        </div>
      </div>

      <Card>
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          <Field label="Giriş" value={formatDate(reservation.stay_start)} />
          <Field label="Çıkış" value={formatDate(reservation.stay_end)} />
          <Field label="Toplam Tutar" value={formatTRY(Number(reservation.total_amount))} />
          <Field label="Kapora" value={formatTRY(Number(reservation.deposit))} />
          <Field
            label="Otomatik Borçlandır"
            value={reservation.auto_debit ? 'Evet' : 'Hayır'}
          />
          <Field label="Durum" value={STATUS_LABELS[reservation.status]} />
        </dl>
      </Card>

      {canSeeLedger && (
        <LedgerSection
          ledger={ledger}
          error={ledgerError}
          canWrite={canWriteLedger}
          onAddClick={() => setShowLedgerModal(true)}
        />
      )}

      {showLedgerModal && user && (
        <LedgerEntryModal
          guestId={reservation.guest_id}
          reservationId={reservation.id}
          createdByUserId={user.id}
          onClose={() => setShowLedgerModal(false)}
          onCreated={(entry) => {
            setLedger((prev) => (prev ? [entry, ...prev] : [entry]));
            setShowLedgerModal(false);
          }}
        />
      )}

      <ConfirmDialog
        open={confirmCancel}
        title="Rezervasyon iptal edilsin mi?"
        description="İptal edilen rezervasyonlar tekrar aktif edilemez."
        confirmLabel="İptal Et"
        destructive
        loading={busy}
        onConfirm={handleCancel}
        onCancel={() => setConfirmCancel(false)}
      />

      <ConfirmDialog
        open={confirmDelete}
        title={`"${guestName || 'Rezervasyon'}" kaydı silinsin mi?`}
        description={
          <>
            <p>Bu işlem geri alınamaz ve rezervasyon kalıcı olarak silinir.</p>
            <p className="mt-2">
              Kaydı saklamak istiyorsanız bunun yerine “İptal Et” seçeneğini kullanın.
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

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-stone-600 dark:text-stone-300">
        {label}
      </dt>
      <dd className="mt-1 text-stone-900 dark:text-stone-100">{value || '—'}</dd>
    </div>
  );
}

interface LedgerSectionProps {
  ledger: LedgerEntry[] | null;
  error: string | null;
  canWrite: boolean;
  onAddClick: () => void;
}

function LedgerSection({ ledger, error, canWrite, onAddClick }: LedgerSectionProps) {
  const balance = balanceFor(ledger ?? []);

  // Color the balance by who is "in the red":
  //   positive  → guest owes us       (amber)
  //   negative  → guest has credit    (indigo)
  //   zero      → settled             (emerald)
  const balanceColor =
    balance > 0
      ? 'text-amber-600 dark:text-amber-400'
      : balance < 0
        ? 'text-indigo-600 dark:text-indigo-400'
        : 'text-emerald-600 dark:text-emerald-400';
  const balanceLabel =
    balance > 0 ? 'Misafir borçlu' : balance < 0 ? 'Misafir alacaklı' : 'Hesap kapalı';

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
          Cari Hesap
        </h2>
        {canWrite && ledger !== null && (
          <Button size="sm" onClick={onAddClick}>
            + Manuel Hareket
          </Button>
        )}
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40">
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </Card>
      )}

      {!error && ledger === null && (
        <p className="text-sm text-stone-600 dark:text-stone-300">Yükleniyor…</p>
      )}

      {!error && ledger !== null && (
        <>
          <Card>
            <p className="text-xs uppercase tracking-wide text-stone-600 dark:text-stone-300">
              Güncel Bakiye
            </p>
            <p className={`mt-1 text-2xl font-semibold ${balanceColor}`}>
              {formatTRY(balance)}
            </p>
            <p className={`mt-1 text-base font-semibold ${balanceColor}`}>
              {balanceLabel}
            </p>
            <p className="mt-0.5 text-xs text-stone-600 dark:text-stone-300">
              {ledger.length} hareket
            </p>
          </Card>

          {ledger.length === 0 ? (
            <Card>
              <p className="text-center text-sm text-stone-600 dark:text-stone-300">
                Henüz hareket yok.
              </p>
            </Card>
          ) : (
            <Card className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-stone-300 text-xs uppercase text-stone-600 dark:border-stone-700 dark:text-stone-300">
                    <tr>
                      <th className="px-6 py-3 font-medium">Tarih</th>
                      <th className="px-6 py-3 font-medium">Tür</th>
                      <th className="px-6 py-3 font-medium">Açıklama</th>
                      <th className="px-6 py-3 text-right font-medium">Tutar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-300 dark:divide-stone-700">
                    {ledger.map((e) => {
                      const isDebt = e.type === 'DEBT';
                      return (
                        <tr key={e.id}>
                          <td className="px-6 py-3 text-stone-700 dark:text-stone-300">
                            <div>{formatDate(e.created_at)}</div>
                            <div className="text-xs text-stone-600 dark:text-stone-300">
                              {formatTime(e.created_at)}
                            </div>
                          </td>
                          <td className="px-6 py-3">
                            <span
                              className={
                                isDebt
                                  ? 'rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                                  : 'rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                              }
                            >
                              {isDebt ? 'Borç' : 'Ödeme'}
                            </span>
                          </td>
                          <td className="px-6 py-3 text-stone-700 dark:text-stone-300">
                            <span>{e.note || '—'}</span>
                            {e.created_by === null && (
                              <span className="ml-2 rounded bg-stone-200 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-stone-600 dark:bg-stone-700 dark:text-stone-300">
                                Sistem
                              </span>
                            )}
                          </td>
                          <td
                            className={
                              isDebt
                                ? 'px-6 py-3 text-right font-semibold text-amber-600 dark:text-amber-400'
                                : 'px-6 py-3 text-right font-semibold text-emerald-600 dark:text-emerald-400'
                            }
                          >
                            {isDebt ? '+' : '−'}
                            {formatTRY(Number(e.amount))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </section>
  );
}
