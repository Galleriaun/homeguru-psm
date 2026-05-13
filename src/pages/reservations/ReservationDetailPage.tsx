import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { can } from '@/lib/rbac';
import {
  cancelReservation,
  getReservation,
} from '@/lib/queries/reservations';
import { getProperty, type Property } from '@/lib/queries/properties';
import { getUnit, type Unit } from '@/lib/queries/units';
import { supabase } from '@/lib/supabase';
import type { Database, ReservationStatus } from '@/types/database';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { formatDate, formatTRY } from '@/lib/utils';

type Reservation = Database['public']['Tables']['reservations']['Row'];

const STATUS_LABELS: Record<ReservationStatus, string> = {
  pending: 'Beklemede',
  active: 'Aktif',
  completed: 'Tamamlandı',
  cancelled: 'İptal',
};

export function ReservationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { profile } = useAuth();

  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [property, setProperty] = useState<Property | null>(null);
  const [unit, setUnit] = useState<Unit | null>(null);
  const [guestName, setGuestName] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);

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
    return <p className="text-sm text-stone-600 dark:text-stone-400">Yükleniyor…</p>;
  }

  const canEdit = profile && can(profile.role, 'reservation:update');
  const canCancel = profile && can(profile.role, 'reservation:cancel');
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
          <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
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
            <Button variant="danger" size="sm" onClick={() => setConfirmCancel(true)}>
              İptal Et
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
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-stone-600 dark:text-stone-400">
        {label}
      </dt>
      <dd className="mt-1 text-stone-900 dark:text-stone-100">{value || '—'}</dd>
    </div>
  );
}
