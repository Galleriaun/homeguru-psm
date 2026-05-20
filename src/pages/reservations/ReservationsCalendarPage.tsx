import { Fragment, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { can } from '@/lib/rbac';
import { listProperties, type Property } from '@/lib/queries/properties';
import { listAllUnits, type Unit } from '@/lib/queries/units';
import {
  listReservationsInRange,
  type ReservationWithRefs,
} from '@/lib/queries/reservations';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ReservationsViewTabs } from './ViewTabs';
import { cn, formatDate } from '@/lib/utils';
import type { ReservationStatus } from '@/types/database';

const WINDOW_DAYS = 28;
const DAY_W = 44; // px per day column
// The sticky unit-name column is fixed-width. 180px is comfortable on a
// tablet/desktop but swallows half a phone viewport, so it collapses below sm.
const LABEL_W_MOBILE = 104;
const LABEL_W_DESKTOP = 180;
const ROW_H = 36; // px per unit row
const DAY_MS = 24 * 60 * 60 * 1000;

const STATUS_BAR: Record<ReservationStatus, string> = {
  pending: 'bg-amber-500 hover:bg-amber-600',
  active: 'bg-emerald-600 hover:bg-emerald-700',
  completed: 'bg-stone-400 hover:bg-stone-500 dark:bg-stone-600 dark:hover:bg-stone-500',
  cancelled: 'bg-red-400',
};

const STATUS_LABELS: Record<ReservationStatus, string> = {
  pending: 'Beklemede',
  active: 'Aktif',
  completed: 'Tamamlandı',
  cancelled: 'İptal',
};

// --- date helpers: work purely in YYYY-MM-DD UTC-day space, matching how
// stay_start / stay_end are stored (UTC midnight) ---
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}
function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function mondayOf(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}
function dayIndex(fromStr: string, toStr: string): number {
  const a = new Date(fromStr + 'T00:00:00Z').getTime();
  const b = new Date(toStr + 'T00:00:00Z').getTime();
  return Math.round((b - a) / DAY_MS);
}

const weekdayFmt = new Intl.DateTimeFormat('tr-TR', { weekday: 'short', timeZone: 'UTC' });
const monthFmt = new Intl.DateTimeFormat('tr-TR', { month: 'short', timeZone: 'UTC' });
const monthLongFmt = new Intl.DateTimeFormat('tr-TR', { month: 'long', timeZone: 'UTC' });
const yearFmt = new Intl.DateTimeFormat('tr-TR', { year: 'numeric', timeZone: 'UTC' });

// Human label for the visible window, which can straddle two months / years.
function monthSpanLabel(startStr: string, endStr: string): string {
  const s = new Date(startStr + 'T00:00:00Z');
  const e = new Date(endStr + 'T00:00:00Z');
  const sM = monthLongFmt.format(s);
  const eM = monthLongFmt.format(e);
  const sY = yearFmt.format(s);
  const eY = yearFmt.format(e);
  if (sM === eM && sY === eY) return `${sM} ${sY}`;
  if (sY === eY) return `${sM} – ${eM} ${eY}`;
  return `${sM} ${sY} – ${eM} ${eY}`;
}

export function ReservationsCalendarPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [windowStart, setWindowStart] = useState(() => mondayOf(todayStr()));
  const [properties, setProperties] = useState<Property[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [reservations, setReservations] = useState<ReservationWithRefs[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Width of the sticky unit-name column — collapses on phones (see consts).
  const [labelW, setLabelW] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < 640
      ? LABEL_W_MOBILE
      : LABEL_W_DESKTOP,
  );
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 640px)');
    const sync = () => setLabelW(mq.matches ? LABEL_W_DESKTOP : LABEL_W_MOBILE);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const today = todayStr();
  const canCreate = Boolean(profile && can(profile.role, 'reservation:create'));

  // Properties + units load once
  useEffect(() => {
    Promise.all([listProperties(), listAllUnits()])
      .then(([p, u]) => {
        setProperties(p);
        setUnits(u);
      })
      .catch((e) => setError(e?.message ?? 'Yüklenemedi'));
  }, []);

  // Reservations reload whenever the window shifts
  useEffect(() => {
    const startISO = new Date(windowStart + 'T00:00:00Z').toISOString();
    const endISO = new Date(addDaysStr(windowStart, WINDOW_DAYS) + 'T00:00:00Z').toISOString();
    setLoading(true);
    listReservationsInRange(startISO, endISO)
      .then(setReservations)
      .catch((e) => setError(e?.message ?? 'Rezervasyonlar yüklenemedi'))
      .finally(() => setLoading(false));
  }, [windowStart]);

  const days = useMemo(
    () =>
      Array.from({ length: WINDOW_DAYS }, (_, i) => {
        const dateStr = addDaysStr(windowStart, i);
        const d = new Date(dateStr + 'T00:00:00Z');
        const dow = d.getUTCDay();
        return {
          dateStr,
          dayNum: d.getUTCDate(),
          weekday: weekdayFmt.format(d),
          month: monthFmt.format(d),
          isWeekend: dow === 0 || dow === 6,
          isToday: dateStr === today,
          showMonth: d.getUTCDate() === 1 || i === 0,
        };
      }),
    [windowStart, today],
  );

  const unitsByProperty = useMemo(() => {
    const map = new Map<string, Unit[]>();
    for (const u of units) {
      const arr = map.get(u.property_id) ?? [];
      arr.push(u);
      map.set(u.property_id, arr);
    }
    return map;
  }, [units]);

  const reservationsByUnit = useMemo(() => {
    const map = new Map<string, ReservationWithRefs[]>();
    for (const r of reservations) {
      if (r.status === 'cancelled') continue;
      const arr = map.get(r.unit_id) ?? [];
      arr.push(r);
      map.set(r.unit_id, arr);
    }
    return map;
  }, [reservations]);

  const trackWidth = WINDOW_DAYS * DAY_W;
  const windowEndLabel = addDaysStr(windowStart, WINDOW_DAYS - 1);

  const handleCellClick = (propertyId: string, unitId: string, dateStr: string) => {
    if (!canCreate) return;
    // ?from= lets the reservation form's "← Geri" / "İptal" return here
    navigate(
      `/reservations/new?property=${propertyId}&unit=${unitId}&checkin=${dateStr}&from=/reservations/calendar`,
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
            Rezervasyon Takvimi
          </h1>
          <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
            {formatDate(windowStart)} – {formatDate(windowEndLabel)}
          </p>
        </div>
        <ReservationsViewTabs />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => setWindowStart((w) => addDaysStr(w, -7))}
          >
            ‹ Önceki
          </Button>
          <Button variant="secondary" onClick={() => setWindowStart(mondayOf(today))}>
            Bugün
          </Button>
          <Button
            variant="secondary"
            onClick={() => setWindowStart((w) => addDaysStr(w, 7))}
          >
            Sonraki ›
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-stone-600 dark:text-stone-300">
          {(['pending', 'active', 'completed'] as const).map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className={cn('h-3 w-3 rounded-sm', STATUS_BAR[s].split(' ')[0])} />
              {STATUS_LABELS[s]}
            </span>
          ))}
        </div>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40">
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </Card>
      )}

      {!error && properties.length === 0 && (
        <Card>
          <p className="text-center text-sm text-stone-600 dark:text-stone-300">
            Henüz mülk eklenmemiş.
          </p>
        </Card>
      )}

      {/* Gantt timeline — scrolls horizontally inside its own container on
          small screens (a contained scroll region, not page-level scroll). */}
      {!error && properties.length > 0 && (
        <Card className="p-0">
          {/* Month label for the visible window — sits outside the scroll
              region so it stays put while the grid scrolls horizontally. */}
          <div className="border-b border-stone-300 bg-stone-50 px-3 py-2 text-center text-sm font-semibold text-stone-700 dark:border-stone-600 dark:bg-stone-800/40 dark:text-stone-200">
            {monthSpanLabel(windowStart, windowEndLabel)}
          </div>
          <div className="overflow-x-auto">
            <div style={{ width: labelW + trackWidth }}>
              {/* Header row */}
              <div className="flex border-b border-stone-300 dark:border-stone-600">
                <div
                  className="sticky left-0 z-30 shrink-0 bg-white px-3 py-2 text-xs font-medium uppercase text-stone-600 dark:bg-stone-900 dark:text-stone-300"
                  style={{ width: labelW }}
                >
                  Birim
                </div>
                {days.map((d) => (
                  <div
                    key={d.dateStr}
                    className={cn(
                      'shrink-0 border-l border-stone-200 py-1 text-center dark:border-stone-700',
                      d.isWeekend && 'bg-stone-100/70 dark:bg-stone-800/50',
                      d.isToday && 'bg-emerald-50 dark:bg-emerald-950/40',
                    )}
                    style={{ width: DAY_W }}
                  >
                    <div className="text-[10px] uppercase leading-tight text-stone-500 dark:text-stone-400">
                      {d.showMonth ? d.month : d.weekday}
                    </div>
                    <div
                      className={cn(
                        'text-sm leading-tight',
                        d.isToday
                          ? 'font-bold text-emerald-700 dark:text-emerald-400'
                          : 'text-stone-700 dark:text-stone-300',
                      )}
                    >
                      {d.dayNum}
                    </div>
                  </div>
                ))}
              </div>

              {/* Body: properties → units */}
              {properties.map((p) => {
                const propUnits = unitsByProperty.get(p.id) ?? [];
                return (
                  <Fragment key={p.id}>
                    <div className="flex border-b border-stone-200 bg-stone-50 dark:border-stone-700 dark:bg-stone-800/40">
                      <div
                        className="sticky left-0 z-20 shrink-0 truncate bg-stone-50 px-3 py-1.5 text-sm font-semibold text-stone-800 dark:bg-stone-800/40 dark:text-stone-200"
                        style={{ width: labelW }}
                      >
                        {p.name}
                      </div>
                      <div
                        className="flex items-center py-1.5"
                        style={{ width: trackWidth }}
                      >
                        <span className="ml-3 rounded bg-stone-200 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-stone-700 dark:bg-stone-700 dark:text-stone-200">
                          {p.type === 'HOTEL' ? 'Otel' : 'Apart'}
                        </span>
                      </div>
                    </div>

                    {propUnits.length === 0 && (
                      <div className="flex border-b border-stone-200 dark:border-stone-700">
                        <div
                          className="sticky left-0 z-10 shrink-0 bg-white px-3 py-2 text-xs italic text-stone-400 dark:bg-stone-900"
                          style={{ width: labelW }}
                        >
                          birim yok
                        </div>
                        <div style={{ width: trackWidth }} />
                      </div>
                    )}

                    {propUnits.map((u) => {
                      const unitRes = reservationsByUnit.get(u.id) ?? [];
                      return (
                        <div
                          key={u.id}
                          className="flex border-b border-stone-200 dark:border-stone-700"
                        >
                          <div
                            className="sticky left-0 z-10 flex shrink-0 items-center bg-white px-3 text-sm text-stone-800 dark:bg-stone-900 dark:text-stone-200"
                            style={{ width: labelW, height: ROW_H }}
                          >
                            <span className="truncate">{u.name}</span>
                          </div>
                          <div
                            className="relative"
                            style={{ width: trackWidth, height: ROW_H }}
                          >
                            {/* Clickable day-cell background */}
                            <div className="absolute inset-0 flex">
                              {days.map((d) => (
                                <button
                                  key={d.dateStr}
                                  type="button"
                                  disabled={!canCreate}
                                  onClick={() => handleCellClick(p.id, u.id, d.dateStr)}
                                  aria-label={`${u.name} ${d.dateStr} yeni rezervasyon`}
                                  className={cn(
                                    'shrink-0 border-l border-stone-200 dark:border-stone-700',
                                    d.isWeekend && 'bg-stone-100/60 dark:bg-stone-800/30',
                                    d.isToday && 'bg-emerald-50/70 dark:bg-emerald-950/30',
                                    canCreate &&
                                      'hover:bg-emerald-100/60 dark:hover:bg-emerald-900/30',
                                    !canCreate && 'cursor-default',
                                  )}
                                  style={{ width: DAY_W }}
                                />
                              ))}
                            </div>

                            {/* Reservation bars */}
                            {unitRes.map((r) => {
                              const sIdx = dayIndex(windowStart, r.stay_start.slice(0, 10));
                              const eIdx = dayIndex(windowStart, r.stay_end.slice(0, 10));
                              const left = Math.max(sIdx, 0);
                              const right = Math.min(eIdx, WINDOW_DAYS);
                              if (right <= left) return null;
                              const clippedLeft = sIdx < 0;
                              const clippedRight = eIdx > WINDOW_DAYS;
                              const padLeft = clippedLeft ? 0 : 2;
                              const padRight = clippedRight ? 0 : 2;
                              return (
                                <button
                                  key={r.id}
                                  type="button"
                                  onClick={() => navigate(`/reservations/${r.id}`)}
                                  title={`${r.guest?.full_name ?? '—'} · ${r.stay_start.slice(
                                    0,
                                    10,
                                  )} → ${r.stay_end.slice(0, 10)} · ${STATUS_LABELS[r.status]}`}
                                  className={cn(
                                    'absolute z-10 flex items-center overflow-hidden px-1.5 text-xs font-medium text-white shadow-sm transition-colors',
                                    STATUS_BAR[r.status],
                                    clippedLeft ? '' : 'rounded-l',
                                    clippedRight ? '' : 'rounded-r',
                                  )}
                                  style={{
                                    left: left * DAY_W + padLeft,
                                    width: (right - left) * DAY_W - padLeft - padRight,
                                    top: 4,
                                    height: ROW_H - 8,
                                  }}
                                >
                                  <span className="truncate">
                                    {r.guest?.full_name ?? '—'}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </Fragment>
                );
              })}
            </div>
          </div>
        </Card>
      )}

      {loading && (
        <p className="text-sm text-stone-600 dark:text-stone-300">Yükleniyor…</p>
      )}

      {canCreate && (
        <p className="text-xs text-stone-500 dark:text-stone-400">
          Boş bir güne tıklayarak yeni rezervasyon oluşturabilirsiniz.
        </p>
      )}
    </div>
  );
}
