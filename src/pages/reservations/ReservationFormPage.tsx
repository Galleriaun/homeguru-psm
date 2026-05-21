import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { listProperties, type Property } from '@/lib/queries/properties';
import { listUnitsForProperty, type Unit } from '@/lib/queries/units';
import { listGuests, type GuestSummary } from '@/lib/queries/guests';
import {
  createReservation,
  getReservation,
  updateReservation,
} from '@/lib/queries/reservations';
import type { ReservationStatus } from '@/types/database';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DateInput } from '@/components/ui/DateInput';
import { NumberInput } from '@/components/ui/NumberInput';
import { Select } from '@/components/ui/Select';
import { formatTRY, istanbulToday } from '@/lib/utils';
import { QuickAddGuestModal } from '@/components/QuickAddGuestModal';

const STATUS_OPTIONS: { value: ReservationStatus; label: string }[] = [
  { value: 'pending', label: 'Beklemede' },
  { value: 'active', label: 'Aktif' },
  { value: 'completed', label: 'Tamamlandı' },
  { value: 'cancelled', label: 'İptal' },
];

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string): number {
  const a = new Date(start + 'T00:00:00Z').getTime();
  const b = new Date(end + 'T00:00:00Z').getTime();
  return Math.max(1, Math.round((b - a) / (1000 * 60 * 60 * 24)));
}

export function ReservationFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();

  const [properties, setProperties] = useState<Property[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [guests, setGuests] = useState<GuestSummary[]>([]);

  const [propertyId, setPropertyId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [guestId, setGuestId] = useState('');
  const [checkin, setCheckin] = useState(istanbulToday());
  const [nights, setNights] = useState(1);
  const [totalAmount, setTotalAmount] = useState(0);
  // Tracks whether the operator has typed their own total. Once true, the
  // unit×nights auto-fill stops overwriting it.
  const [totalEdited, setTotalEdited] = useState(false);
  const [deposit, setDeposit] = useState(0);
  const [autoDebit, setAutoDebit] = useState(false);
  const [status, setStatus] = useState<ReservationStatus>('pending');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showGuestModal, setShowGuestModal] = useState(false);

  const checkout = useMemo(() => addDays(checkin, nights), [checkin, nights]);
  const selectedUnit = units.find((u) => u.id === unitId);
  const suggestedTotal = selectedUnit ? Number(selectedUnit.base_price) * nights : 0;

  // Where "← Geri" / "İptal" should return to. When editing, go back to the
  // reservation. When creating, honour a ?from= param (e.g. the calendar) so
  // the user lands back where they started — falling back to the list.
  const fromParam = searchParams.get('from');
  const backTo =
    isEdit && id
      ? `/reservations/${id}`
      : fromParam && fromParam.startsWith('/')
        ? fromParam
        : '/reservations';

  // Load initial data: properties + guests (+ existing reservation if editing)
  useEffect(() => {
    (async () => {
      try {
        const [props, gs] = await Promise.all([listProperties(), listGuests()]);
        setProperties(props);
        setGuests(gs);

        if (isEdit && id) {
          const r = await getReservation(id);
          if (!r) {
            setError('Rezervasyon bulunamadı');
            return;
          }
          setPropertyId(r.property_id);
          setUnitId(r.unit_id);
          setGuestId(r.guest_id);
          const start = r.stay_start.slice(0, 10);
          const end = r.stay_end.slice(0, 10);
          setCheckin(start);
          setNights(daysBetween(start, end));
          setTotalAmount(Number(r.total_amount));
          setDeposit(Number(r.deposit));
          setAutoDebit(r.auto_debit);
          setStatus(r.status);
        } else {
          // Prefill from query params (e.g. arriving from a calendar cell click)
          const qpProperty = searchParams.get('property');
          const qpUnit = searchParams.get('unit');
          const qpCheckin = searchParams.get('checkin');
          if (qpProperty && props.some((p) => p.id === qpProperty)) {
            setPropertyId(qpProperty);
            if (qpUnit) setUnitId(qpUnit);
          }
          if (qpCheckin && /^\d{4}-\d{2}-\d{2}$/.test(qpCheckin)) {
            setCheckin(qpCheckin);
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Yüklenemedi');
      } finally {
        setLoading(false);
      }
    })();
    // searchParams read once on mount — intentionally not a dep
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isEdit]);

  // Load units when property changes
  useEffect(() => {
    if (!propertyId) {
      setUnits([]);
      return;
    }
    listUnitsForProperty(propertyId)
      .then((us) => {
        setUnits(us);
        // If the selected unit isn't in this property, switch to the first
        // one — or clear it when the property has no units, so a stale id
        // can't slip through validation into a mismatched reservation.
        if (!us.find((u) => u.id === unitId)) {
          setUnitId(us.length > 0 ? us[0].id : '');
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Birimler yüklenemedi'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId]);

  // Auto-fill the suggested total as unit/nights change — but only while
  // creating and only until the operator types their own value. On edit the
  // saved total is authoritative and never auto-overwritten.
  useEffect(() => {
    if (!isEdit && !totalEdited && suggestedTotal > 0) {
      setTotalAmount(suggestedTotal);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestedTotal]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!propertyId || !unitId || !guestId) {
      setError('Mülk, birim ve misafir seçilmelidir.');
      return;
    }
    if (!user) {
      setError('Oturum bulunamadı.');
      return;
    }

    setSaving(true);
    try {
      const stay_start = new Date(checkin + 'T00:00:00Z').toISOString();
      const stay_end = new Date(checkout + 'T00:00:00Z').toISOString();

      if (isEdit && id) {
        await updateReservation(id, {
          property_id: propertyId,
          unit_id: unitId,
          guest_id: guestId,
          stay_start,
          stay_end,
          total_amount: totalAmount,
          deposit,
          auto_debit: autoDebit,
          status,
        });
        navigate(`/reservations/${id}`, { replace: true });
      } else {
        const created = await createReservation({
          property_id: propertyId,
          unit_id: unitId,
          guest_id: guestId,
          stay_start,
          stay_end,
          total_amount: totalAmount,
          deposit,
          auto_debit: autoDebit,
          status,
          created_by: user.id,
        });
        navigate(`/reservations/${created.id}`, { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kaydedilemedi');
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-stone-600 dark:text-stone-300">Yükleniyor…</p>;
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <Link
        to={backTo}
        className="inline-block text-sm text-emerald-600 hover:underline dark:text-emerald-500"
      >
        ← Geri
      </Link>
      <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
        {isEdit ? 'Rezervasyon Düzenle' : 'Yeni Rezervasyon'}
      </h1>

      {properties.length === 0 && (
        <Card className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40">
          <p className="text-sm text-amber-700 dark:text-amber-400">
            Önce bir mülk eklemelisiniz.{' '}
            <Link to="/properties/new" className="underline">
              Mülk ekle
            </Link>
          </p>
        </Card>
      )}

      {guests.length === 0 && (
        <Card className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40">
          <p className="text-sm text-amber-700 dark:text-amber-400">
            Önce bir misafir eklemelisiniz.{' '}
            <Link to="/guests/new" className="underline">
              Misafir ekle
            </Link>
          </p>
        </Card>
      )}

      {showGuestModal && (
        <QuickAddGuestModal
          onClose={() => setShowGuestModal(false)}
          onCreated={(guest) => {
            setGuests((prev) => [guest, ...prev]);
            setGuestId(guest.id);
            setShowGuestModal(false);
          }}
        />
      )}

      <Card>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <Select
            label="Mülk"
            name="property"
            required
            value={propertyId}
            onChange={setPropertyId}
            options={properties.map((p) => ({ value: p.id, label: p.name }))}
            placeholder="Mülk seçin"
          />

          <Select
            label="Birim"
            name="unit"
            required
            value={unitId}
            onChange={setUnitId}
            options={units.map((u) => ({
              value: u.id,
              label: `${u.name} (${formatTRY(Number(u.base_price))}/gece)`,
            }))}
            placeholder={propertyId ? 'Birim seçin' : 'Önce mülk seçin'}
            disabled={!propertyId}
          />

          <div>
            <div className="flex items-center justify-between">
              <label
                htmlFor="guest"
                className="block text-sm font-medium text-stone-700 dark:text-stone-300"
              >
                Misafir<span className="ml-0.5 text-red-500">*</span>
              </label>
              <button
                type="button"
                onClick={() => setShowGuestModal(true)}
                className="inline-flex items-center gap-1 rounded-md bg-sky-700 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-sky-800 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path
                    d="M10 4v12M4 10h12"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
                Yeni Misafir
              </button>
            </div>
            <Select
              name="guest"
              searchable
              required
              value={guestId}
              onChange={setGuestId}
              options={guests.map((g) => ({
                value: g.id,
                label: g.phone ? `${g.full_name} — ${g.phone}` : g.full_name,
              }))}
              placeholder="Misafir seçin"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <DateInput
              label="Giriş"
              name="checkin"
              required
              value={checkin}
              onChange={setCheckin}
            />
            <NumberInput
              label="Gece"
              name="nights"
              min={1}
              max={365}
              required
              value={nights}
              onChange={setNights}
            />
          </div>

          <p className="text-xs text-stone-600 dark:text-stone-300">
            Çıkış tarihi: <strong>{checkout}</strong>
            {selectedUnit && (
              <>
                {' · '}Önerilen tutar: <strong>{formatTRY(suggestedTotal)}</strong>
              </>
            )}
          </p>

          <NumberInput
            label="Toplam Tutar (₺)"
            name="total_amount"
            min={0}
            step={50}
            required
            value={totalAmount}
            onChange={(v) => {
              setTotalAmount(v);
              setTotalEdited(true);
            }}
          />

          <NumberInput
            label="Kapora (₺)"
            name="deposit"
            min={0}
            step={50}
            value={deposit}
            onChange={setDeposit}
          />

          <Select
            label="Durum"
            name="status"
            required
            value={status}
            onChange={(v) => setStatus(v as ReservationStatus)}
            options={STATUS_OPTIONS}
          />

          <label className="flex items-center gap-2 text-sm text-stone-700 dark:text-stone-300">
            <input
              type="checkbox"
              checked={autoDebit}
              onChange={(e) => setAutoDebit(e.target.checked)}
              className="h-4 w-4 rounded border-stone-300 text-emerald-600 focus:ring-emerald-500"
            />
            Otomatik borçlandır (her gece 00:05'te günlük ücreti carisine işler)
          </label>

          {error && (
            <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Link to={backTo}>
              <Button type="button" variant="secondary" disabled={saving}>
                İptal
              </Button>
            </Link>
            <Button type="submit" loading={saving}>
              {isEdit ? 'Kaydet' : 'Oluştur'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
