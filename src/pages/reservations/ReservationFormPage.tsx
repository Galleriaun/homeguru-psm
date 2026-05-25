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
import { listPricesInRange } from '@/lib/queries/property_nightly_prices';
import type { ReservationStatus, StayType } from '@/types/database';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DateInput } from '@/components/ui/DateInput';
import { NumberInput } from '@/components/ui/NumberInput';
import { Select } from '@/components/ui/Select';
import { formatTRY, istanbulToday } from '@/lib/utils';
import { QuickAddGuestModal } from '@/components/QuickAddGuestModal';
import { CompanionModal } from '@/pages/guests/CompanionModal';

const STATUS_OPTIONS: { value: ReservationStatus; label: string }[] = [
  { value: 'pending', label: 'Beklemede' },
  { value: 'upcoming', label: 'Yakında' },
  { value: 'active', label: 'Aktif' },
  { value: 'completed', label: 'Tamamlandı' },
  { value: 'cancelled', label: 'İptal' },
];

function addDays(dateStr: string, days: number): string {
  // Guard empty / malformed input — `new Date('T00:00:00Z').toISOString()`
  // throws RangeError on an invalid date, which used to crash the whole page
  // when the operator cleared the giriş field.
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string): number {
  if (!start || !end) return 1;
  const a = new Date(start + 'T00:00:00Z').getTime();
  const b = new Date(end + 'T00:00:00Z').getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 1;
  return Math.max(1, Math.round((b - a) / (1000 * 60 * 60 * 24)));
}

/**
 * Convert a UTC ISO timestamp to Istanbul-local YYYY-MM-DD + HH:MM. Used to
 * surface day-use start/end times back into the form when editing — Istanbul
 * is fixed UTC+3, no DST since 2016 (see CLAUDE.md).
 */
function toIstanbulDateAndTime(iso: string): { date: string; time: string } {
  const shifted = new Date(new Date(iso).getTime() + 3 * 60 * 60 * 1000);
  const s = shifted.toISOString();
  return { date: s.slice(0, 10), time: s.slice(11, 16) };
}

/**
 * Mask raw input into HH:MM as the user types. Strips non-digits, caps at
 * 4 digits, and auto-inserts the colon after two. Always 24-hour — we use a
 * masked text input instead of <input type="time"> because the latter falls
 * back to OS-locale AM/PM on Chrome/Windows even when lang="tr".
 */
function maskTime(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return digits.slice(0, 2) + ':' + digits.slice(2);
}

const TIME_HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Default status for a new reservation, from its dates: a future stay is
 * 'upcoming', one in progress 'active', a fully-past one 'completed'.
 * (A daily cron later promotes 'upcoming' → 'active' on the check-in day.)
 *
 * Day-use stays are single-day, so checkout-date equals checkin-date: the
 * overnight rule "checkoutStr <= today → completed" would wrongly mark a
 * day-use booking on today as already finished. Treat day-use as active for
 * its single day and let the operator flip it to completed manually.
 */
function deriveStatus(
  checkinStr: string,
  checkoutStr: string,
  stayType: StayType,
): ReservationStatus {
  const today = istanbulToday();
  if (stayType === 'DAYUSE') {
    if (checkinStr > today) return 'upcoming';
    if (checkinStr < today) return 'completed';
    return 'active';
  }
  if (checkinStr > today) return 'upcoming';
  if (checkoutStr <= today) return 'completed';
  return 'active';
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
  /** OVERNIGHT (default) | DAYUSE — drives whether we collect nights or HH:MM. */
  const [stayType, setStayType] = useState<StayType>('OVERNIGHT');
  /** Istanbul-local start/end times — only used when stayType === 'DAYUSE'. */
  const [startTime, setStartTime] = useState('14:00');
  const [endTime, setEndTime] = useState('16:00');
  const [totalAmount, setTotalAmount] = useState(0);
  // Tracks whether the operator has typed their own total. Once true, the
  // unit×nights auto-fill stops overwriting it.
  const [totalEdited, setTotalEdited] = useState(false);
  const [deposit, setDeposit] = useState(0);
  const [autoDebit, setAutoDebit] = useState(false);
  const [status, setStatus] = useState<ReservationStatus>('active');
  // Once the operator picks a status by hand, stop auto-deriving it from dates.
  const [statusEdited, setStatusEdited] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showGuestModal, setShowGuestModal] = useState(false);
  const [showCompanionModal, setShowCompanionModal] = useState(false);

  // For overnight: checkout = checkin + nights. For day-use, the stay starts
  // and ends on the same calendar date.
  const checkout = useMemo(
    () => (stayType === 'DAYUSE' ? checkin : addDays(checkin, nights)),
    [checkin, nights, stayType],
  );
  const selectedUnit = units.find((u) => u.id === unitId);
  /**
   * Recommended total — the sum of each night's price, where any night that
   * has a per-date override (migration 047) uses its override and every other
   * night falls back to unit.base_price. Day-use uses 0 (operator types the
   * total manually because nightly pricing doesn't apply).
   *
   * Updated asynchronously by the effect below; reset to a synchronous
   * baseline (base_price × nights) before the fetch lands so the field
   * never reads stale on a unit/date change.
   */
  const [suggestedTotal, setSuggestedTotal] = useState(0);
  /** How many of the booked nights pulled a custom override price — drives
      the "(N gece özel fiyat)" hint next to the total. */
  const [overrideNightsCount, setOverrideNightsCount] = useState(0);

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
          setStayType(r.stay_type);
          if (r.stay_type === 'DAYUSE') {
            // Day-use: surface the Istanbul-local times back into the form
            // so editing a 14:00-17:00 stay shows 14:00 and 17:00.
            const startLocal = toIstanbulDateAndTime(r.stay_start);
            const endLocal = toIstanbulDateAndTime(r.stay_end);
            setCheckin(startLocal.date);
            setStartTime(startLocal.time);
            setEndTime(endLocal.time);
            setNights(1);
          } else {
            const start = r.stay_start.slice(0, 10);
            const end = r.stay_end.slice(0, 10);
            setCheckin(start);
            setNights(daysBetween(start, end));
          }
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

  // Recompute the suggested total when the unit / dates / stay-type change.
  // Sets a synchronous baseline (base × nights) immediately so the field
  // never reads stale; then fetches per-date overrides for the stay window
  // and refines the total. Cancellation flag protects against stale-fetch
  // races when the user spins the nights counter quickly.
  useEffect(() => {
    if (stayType === 'DAYUSE' || !selectedUnit) {
      setSuggestedTotal(0);
      setOverrideNightsCount(0);
      return;
    }
    const base = Number(selectedUnit.base_price);
    setSuggestedTotal(base * nights);
    setOverrideNightsCount(0);

    let cancelled = false;
    const endDateExclusive = addDays(checkin, nights);
    listPricesInRange(checkin, endDateExclusive)
      .then((rows) => {
        if (cancelled) return;
        // listPricesInRange returns every visible unit in the window — filter
        // to our selected unit before building the lookup map.
        const byDate = new Map(
          rows
            .filter((r) => r.unit_id === selectedUnit.id)
            .map((r) => [r.price_date, Number(r.price)] as const),
        );
        let sum = 0;
        let used = 0;
        for (let i = 0; i < nights; i++) {
          const d = addDays(checkin, i);
          const override = byDate.get(d);
          const nightly = override !== undefined ? override : base;
          sum += nightly;
          // Only count it as "özel fiyat" when the override actually differs
          // from the unit's baseline — an override that equals the base is a
          // no-op from the operator's perspective.
          if (override !== undefined && override !== base) used++;
        }
        setSuggestedTotal(sum);
        setOverrideNightsCount(used);
      })
      .catch(() => {
        // Network / RLS failure: keep the synchronous baseline so the form
        // still functions even if the price-override fetch breaks.
      });
    return () => {
      cancelled = true;
    };
  }, [stayType, selectedUnit, checkin, nights]);

  // Auto-fill the suggested total as unit/nights change — but only while
  // creating and only until the operator types their own value. On edit the
  // saved total is authoritative and never auto-overwritten.
  useEffect(() => {
    if (!isEdit && !totalEdited && suggestedTotal > 0) {
      setTotalAmount(suggestedTotal);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestedTotal]);

  // New reservations take their status from the check-in date — future stay
  // 'upcoming', current one 'active', past one 'completed' — until the
  // operator picks a status by hand. Editing never auto-changes the status.
  useEffect(() => {
    if (!isEdit && !statusEdited) {
      setStatus(deriveStatus(checkin, checkout, stayType));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkin, checkout, stayType]);

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

    // Day-use sanity. Two checks: (1) both times are well-formed HH:MM in
    // 24-hour range, (2) end is strictly after start (the DB CHECK reasserts
    // this, but a friendlier message here saves a round-trip).
    if (stayType === 'DAYUSE') {
      if (!TIME_HHMM_RE.test(startTime) || !TIME_HHMM_RE.test(endTime)) {
        setError('Saat formatı HH:MM olmalıdır (örn: 14:30).');
        return;
      }
      if (endTime <= startTime) {
        setError('Günübirlik konaklamada çıkış saati, giriş saatinden sonra olmalıdır.');
        return;
      }
    }

    setSaving(true);
    try {
      let stay_start: string;
      let stay_end: string;
      if (stayType === 'DAYUSE') {
        // Istanbul-local times → UTC ISO. Istanbul is fixed UTC+3.
        stay_start = new Date(`${checkin}T${startTime}:00+03:00`).toISOString();
        stay_end = new Date(`${checkin}T${endTime}:00+03:00`).toISOString();
      } else {
        stay_start = new Date(checkin + 'T00:00:00Z').toISOString();
        stay_end = new Date(checkout + 'T00:00:00Z').toISOString();
      }

      // Day-use stays don't get the nightly auto-debit cron; force off so a
      // checkbox toggled before flipping to day-use doesn't leak through.
      const effectiveAutoDebit = stayType === 'DAYUSE' ? false : autoDebit;

      if (isEdit && id) {
        await updateReservation(id, {
          property_id: propertyId,
          unit_id: unitId,
          guest_id: guestId,
          stay_start,
          stay_end,
          stay_type: stayType,
          total_amount: totalAmount,
          deposit,
          auto_debit: effectiveAutoDebit,
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
          stay_type: stayType,
          total_amount: totalAmount,
          deposit,
          auto_debit: effectiveAutoDebit,
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

      {showCompanionModal && guestId && (
        <CompanionModal
          guestId={guestId}
          companion={null}
          onClose={() => setShowCompanionModal(false)}
          onSaved={() => setShowCompanionModal(false)}
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label
                htmlFor="guest"
                className="block text-sm font-medium text-stone-700 dark:text-stone-300"
              >
                Misafir<span className="ml-0.5 text-red-500">*</span>
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowCompanionModal(true)}
                  disabled={!guestId}
                  className="inline-flex items-center gap-1 rounded-md border border-stone-300 px-2.5 py-1 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-stone-600 dark:text-stone-300 dark:hover:bg-stone-800"
                >
                  + Ek Misafir
                </button>
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

          {/* Günübirlik (day-use) toggle. When on, replace nights with start/end
              times on a single calendar date. Stays under ~4 hours typical. */}
          <label className="flex items-center gap-2 rounded-md border border-stone-200 px-3 py-2 text-sm text-stone-700 dark:border-stone-700 dark:text-stone-300">
            <input
              type="checkbox"
              checked={stayType === 'DAYUSE'}
              onChange={(e) => setStayType(e.target.checked ? 'DAYUSE' : 'OVERNIGHT')}
              className="h-4 w-4 rounded border-stone-300 text-amber-600 focus:ring-amber-500"
            />
            Günübirlik konaklama (saatlik)
          </label>

          {stayType === 'OVERNIGHT' ? (
            <>
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
                    {overrideNightsCount > 0 && (
                      <>
                        {' '}
                        <span className="text-emerald-700 dark:text-emerald-400">
                          ({overrideNightsCount} gece özel fiyat)
                        </span>
                      </>
                    )}
                  </>
                )}
              </p>
            </>
          ) : (
            <>
              <DateInput
                label="Tarih"
                name="dayuse_date"
                required
                value={checkin}
                onChange={setCheckin}
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="start_time"
                    className="block text-sm font-medium text-stone-700 dark:text-stone-300"
                  >
                    Başlangıç saati<span className="ml-0.5 text-red-500">*</span>
                  </label>
                  <input
                    id="start_time"
                    name="start_time"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-2][0-9]:[0-5][0-9]"
                    maxLength={5}
                    placeholder="14:00"
                    required
                    value={startTime}
                    onChange={(e) => setStartTime(maskTime(e.target.value))}
                    className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder-stone-400 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:placeholder-stone-500"
                  />
                </div>
                <div>
                  <label
                    htmlFor="end_time"
                    className="block text-sm font-medium text-stone-700 dark:text-stone-300"
                  >
                    Bitiş saati<span className="ml-0.5 text-red-500">*</span>
                  </label>
                  <input
                    id="end_time"
                    name="end_time"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-2][0-9]:[0-5][0-9]"
                    maxLength={5}
                    placeholder="16:00"
                    required
                    value={endTime}
                    onChange={(e) => setEndTime(maskTime(e.target.value))}
                    className="mt-1 block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder-stone-400 shadow-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:placeholder-stone-500"
                  />
                </div>
              </div>
              <p className="text-xs text-stone-600 dark:text-stone-300">
                Süre: <strong>{startTime}–{endTime}</strong>{' '}
                <span className="text-stone-500 dark:text-stone-400">
                  · Tutarı manuel giriniz.
                </span>
              </p>
            </>
          )}

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
            onChange={(v) => {
              setStatus(v as ReservationStatus);
              setStatusEdited(true);
            }}
            options={STATUS_OPTIONS}
          />

          {/* Auto-debit charges the nightly fee at 00:05 — day-use stays
              aren't nightly so the checkbox is hidden in that mode. */}
          {stayType === 'OVERNIGHT' && (
            <label className="flex items-center gap-2 text-sm text-stone-700 dark:text-stone-300">
              <input
                type="checkbox"
                checked={autoDebit}
                onChange={(e) => setAutoDebit(e.target.checked)}
                className="h-4 w-4 rounded border-stone-300 text-emerald-600 focus:ring-emerald-500"
              />
              Otomatik borçlandır (her gece 00:05'te günlük ücreti carisine işler)
            </label>
          )}

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
