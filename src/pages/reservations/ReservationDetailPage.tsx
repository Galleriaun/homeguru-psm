import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { can, canCollectPayment } from '@/lib/rbac';
import {
  cancelReservation,
  deleteReservation,
  getReservation,
} from '@/lib/queries/reservations';
import { getProperty, type Property } from '@/lib/queries/properties';
import { getUnit, type Unit } from '@/lib/queries/units';
import {
  listLedgerForReservation,
  deleteLedgerEntry,
  type LedgerEntry,
} from '@/lib/queries/ledger';
import { deletePaymentCollection } from '@/lib/queries/payments';
import { supabase } from '@/lib/supabase';
import type { Database, ReservationStatus } from '@/types/database';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { LedgerEntryModal } from './LedgerEntryModal';
import { PaymentCollectModal } from './PaymentCollectModal';
import { SendWhatsAppModal } from '@/components/SendWhatsAppModal';
import { WhatsAppIcon } from '@/components/icons/WhatsAppIcon';
import { formatDate, formatTRY } from '@/lib/utils';
import { exportRowsToCsv } from '@/lib/csvExport';
import { resolveKatalogLink } from '@/lib/gallery';

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
  const [guestPhone, setGuestPhone] = useState<string | null>(null);
  const [showWhatsApp, setShowWhatsApp] = useState(false);
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
  // Bumping this re-runs the ledger fetch (used after a successful payment collection)
  const [ledgerVersion, setLedgerVersion] = useState(0);

  // Payment collection — gated to payment:collect via type-conditional canCollectPayment()
  const [showCollectModal, setShowCollectModal] = useState(false);

  // Per-row ledger deletion (SUPER_ADMIN only — see migration 017)
  const [entryToDelete, setEntryToDelete] = useState<LedgerEntry | null>(null);
  const [entryDeleteError, setEntryDeleteError] = useState<string | null>(null);
  const [entryDeleting, setEntryDeleting] = useState(false);

  const canSeeLedger = Boolean(profile && can(profile.role, 'finance:read'));
  const canWriteLedger = Boolean(profile && can(profile.role, 'finance:write'));
  const canDeleteLedger = profile?.role === 'SUPER_ADMIN';

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
          supabase
            .from('guests')
            .select('full_name, phone')
            .eq('id', r.guest_id)
            .maybeSingle(),
        ]);
        setProperty(p);
        setUnit(u);
        setGuestName(g.data?.full_name ?? '');
        setGuestPhone(g.data?.phone ?? null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Yüklenemedi');
      }
    })();
  }, [id]);

  // Load the per-reservation ledger only if the user is permitted to see it.
  // ledgerVersion bumps re-run this effect (after a payment is collected, etc.)
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
  }, [reservation?.id, canSeeLedger, ledgerVersion]);

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
  // Ödeme Topla — type-conditional: HOTEL=reception, APARTMENT=housekeeping; manager+admin everywhere.
  const canCollect = Boolean(
    profile && property && canCollectPayment(profile.role, property.type),
  );
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

  const handleDeleteEntry = async () => {
    if (!entryToDelete) return;
    setEntryDeleting(true);
    setEntryDeleteError(null);
    try {
      if (entryToDelete.payment_collection_id) {
        // Cascade path: deleting the payment_collection removes the matching
        // cash_transactions row AND this ledger entry in one shot
        // (FK ON DELETE CASCADE — migration 016).
        await deletePaymentCollection(entryToDelete.payment_collection_id);
      } else {
        // Manual ledger entry OR auto-debit row OR legacy unlinked payment —
        // delete just this row.
        await deleteLedgerEntry(entryToDelete.id);
      }
      setLedger((prev) => prev?.filter((e) => e.id !== entryToDelete.id) ?? prev);
      setEntryToDelete(null);
      setEntryDeleting(false);
    } catch (e) {
      setEntryDeleteError(e instanceof Error ? e.message : 'Silme başarısız');
      setEntryDeleting(false);
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
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowWhatsApp(true)}
          >
            <WhatsAppIcon className="h-4 w-4 text-emerald-600 dark:text-emerald-500" />
            WhatsApp
          </Button>
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
          canCollect={canCollect && !isCancelled}
          canDelete={canDeleteLedger}
          guestName={guestName}
          stayStart={reservation.stay_start}
          onCollectClick={() => setShowCollectModal(true)}
          onAddClick={() => setShowLedgerModal(true)}
          onDeleteClick={(entry) => {
            setEntryDeleteError(null);
            setEntryToDelete(entry);
          }}
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

      {showCollectModal && property && (
        <PaymentCollectModal
          reservationId={reservation.id}
          propertyId={property.id}
          canSeeCashAccounts={canSeeLedger}
          onClose={() => setShowCollectModal(false)}
          onCollected={() => {
            setShowCollectModal(false);
            // Re-fetch the ledger so the new PAYMENT entry appears
            setLedgerVersion((v) => v + 1);
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
            <p>Rezervasyon Çöp Kutusu'na taşınır ve oradan geri yüklenebilir.</p>
            <p className="mt-2">
              Rezervasyonu iptal statüsünde tutmak istiyorsanız bunun yerine “İptal Et” seçeneğini kullanın.
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

      {showWhatsApp && (
        <SendWhatsAppModal
          recipientName={guestName || 'Misafir'}
          recipientPhone={guestPhone}
          variables={{
            misafir_adi: guestName,
            giris_tarihi: formatDate(reservation.stay_start),
            cikis_tarihi: formatDate(reservation.stay_end),
            gece_sayisi: String(
              Math.max(
                1,
                Math.round(
                  (new Date(reservation.stay_end).getTime() -
                    new Date(reservation.stay_start).getTime()) /
                    (24 * 60 * 60 * 1000),
                ),
              ),
            ),
            toplam_tutar: formatTRY(Number(reservation.total_amount)),
            mulk_adi: property?.name ?? '',
            birim_adi: unit?.name ?? '',
            katalog_link: resolveKatalogLink(unit),
          }}
          onClose={() => setShowWhatsApp(false)}
        />
      )}

      <ConfirmDialog
        open={entryToDelete !== null}
        title="Cari hareketi silinsin mi?"
        description={
          entryToDelete && (
            <>
              <p>
                <strong>
                  {entryToDelete.type === 'DEBT' ? '+' : '−'}
                  {formatTRY(Number(entryToDelete.amount))}
                </strong>
                {entryToDelete.note ? ` — ${entryToDelete.note}` : ''}
              </p>
              <p className="mt-2">Kayıt Çöp Kutusu'na taşınır ve oradan geri yüklenebilir. Bakiye yeniden hesaplanır.</p>
              {entryToDelete.payment_collection_id && (
                <div className="mt-3 rounded border border-stone-300 bg-stone-50 px-3 py-2 text-sm text-stone-700 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-200">
                  <p>
                    <strong>Not:</strong> Bu kayıt bir tahsilatla bağlantılı.
                    Silindiğinde bağlı{' '}
                    <strong>tahsilat kaydı ve kasa hareketi</strong> de
                    otomatik olarak silinir.
                  </p>
                </div>
              )}
            </>
          )
        }
        confirmLabel="Sil"
        destructive
        loading={entryDeleting}
        error={entryDeleteError}
        onConfirm={handleDeleteEntry}
        onCancel={() => {
          setEntryToDelete(null);
          setEntryDeleteError(null);
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
  canCollect: boolean;
  canDelete: boolean;
  /** Used to build the CSV download filename. */
  guestName: string;
  stayStart: string;
  onCollectClick: () => void;
  onAddClick: () => void;
  onDeleteClick: (entry: LedgerEntry) => void;
}

function LedgerSection({
  ledger,
  error,
  canWrite,
  canCollect,
  canDelete,
  guestName,
  stayStart,
  onCollectClick,
  onAddClick,
  onDeleteClick,
}: LedgerSectionProps) {
  const entries = ledger ?? [];
  // Split the two totals so the user can verify the math by sight,
  // instead of trusting a single signed number.
  const totalDebt = entries.reduce(
    (s, e) => (e.type === 'DEBT' ? s + Number(e.amount) : s),
    0,
  );
  const totalPayment = entries.reduce(
    (s, e) => (e.type === 'PAYMENT' ? s + Number(e.amount) : s),
    0,
  );
  const balance = totalDebt - totalPayment;

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
    balance > 0 ? 'Misafir borçlu' : balance < 0 ? 'Misafirden Alınacak' : 'Hesap kapalı';

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
          Cari Hesap
        </h2>
        {ledger !== null && (
          <div className="flex flex-wrap gap-2">
            {entries.length > 0 && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  const rows = entries.map((e) => ({
                    Tarih: formatDate(e.created_at),
                    Tip: e.type === 'DEBT' ? 'Ücret' : 'Ödeme',
                    Tutar: Number(e.amount).toFixed(2),
                    'Para Birimi': e.currency,
                    Açıklama: e.note ?? '',
                  }));
                  const base = `cari-${guestName || 'misafir'}-${stayStart.slice(0, 10)}`;
                  exportRowsToCsv(base, rows, [
                    { key: 'Tarih', label: 'Tarih' },
                    { key: 'Tip', label: 'Tip' },
                    { key: 'Tutar', label: 'Tutar' },
                    { key: 'Para Birimi', label: 'Para Birimi' },
                    { key: 'Açıklama', label: 'Açıklama' },
                  ]);
                }}
              >
                CSV İndir
              </Button>
            )}
            {canCollect && (
              <Button size="sm" onClick={onCollectClick}>
                + Ödeme Topla
              </Button>
            )}
            {canWrite && (
              <Button
                size="sm"
                variant="secondary"
                className="border-transparent bg-stone-200 hover:bg-stone-300 dark:border-transparent dark:bg-stone-700 dark:hover:bg-stone-600"
                onClick={onAddClick}
              >
                + Ekstra Ücret
              </Button>
            )}
          </div>
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
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-stone-600 dark:text-stone-300">
                  Toplam Ücret
                </span>
                <span className="text-sm font-semibold text-amber-600 dark:text-amber-400">
                  {formatTRY(totalDebt)}
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-stone-600 dark:text-stone-300">
                  Toplam Ödeme
                </span>
                <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                  {formatTRY(totalPayment)}
                </span>
              </div>
              <div className="border-t border-stone-300 pt-2 dark:border-stone-700">
                <div className="flex items-baseline justify-between">
                  <span className="text-base font-medium text-stone-700 dark:text-stone-200">
                    Bakiye
                  </span>
                  <span className={`text-2xl font-semibold ${balanceColor}`}>
                    {balance < 0 ? '−' : ''}
                    {formatTRY(Math.abs(balance))}
                  </span>
                </div>
                <div className="mt-1 flex items-baseline justify-between">
                  <span className="text-xs text-stone-600 dark:text-stone-300">
                    {ledger.length} hareket
                  </span>
                  <span className={`text-sm font-medium ${balanceColor}`}>
                    {balanceLabel}
                  </span>
                </div>
              </div>
            </div>
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
                      {canDelete && <th className="px-6 py-3" aria-label="Sil" />}
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
                              {isDebt ? 'Ücret' : 'Ödeme'}
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
                          {canDelete && (
                            <td className="px-6 py-3 text-right">
                              <button
                                type="button"
                                onClick={() => onDeleteClick(e)}
                                aria-label="Hareketi sil"
                                className="rounded p-1 text-stone-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                              >
                                <svg
                                  className="h-4 w-4"
                                  viewBox="0 0 20 20"
                                  fill="none"
                                  aria-hidden="true"
                                >
                                  <path
                                    d="M5 6h10M8 6V4h4v2M6 6l1 10h6l1-10"
                                    stroke="currentColor"
                                    strokeWidth="1.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              </button>
                            </td>
                          )}
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
