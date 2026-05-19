import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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
const LABEL_W = 180; // px for the sticky unit-name column
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

export function ReservationsCalendarPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [windowStart, setWindowStart] = useState(() => mondayOf(todayStr()));
  const [properties, setProperties] = useState<Property[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [reservations, setReservations] = useState<ReservationWithRefs[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

      {/* Mobile (< md): agenda list of reservations in the window */}
      {!error && properties.length > 0 && (
        <div className="md:hidden">
          <MobileAgenda
            reservations={reservations}
            windowStart={windowStart}
            windowDays={WINDOW_DAYS}
            today={today}
          />
        </div>
      )}

      {/* Desktop (md+): Gantt timeline */}
      {!error && properties.length > 0 && (
        <Card className="hidden p-0 md:block">
          <div className="overflow-x-auto">
            <div style={{ width: LABEL_W + trackWidth }}>
              {/* Header row */}
              <div className="flex border-b border-stone-300 dark:border-stone-600">
                <div
                  className="sticky left-0 z-30 shrink-0 bg-white px-3 py-2 text-xs font-medium uppercase text-stone-600 dark:bg-stone-900 dark:text-stone-300"
                  style={{ width: LABEL_W }}
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
                        className="sticky left-0 z-20 shrink-0 bg-stone-50 px-3 py-1.5 text-sm font-semibold text-stone-800 dark:bg-stone-800/40 dark:text-stone-200"
                        style={{ width: LABEL_W }}
                      >
                        {p.name}
                      </div>
                      <div
                        className="py-1.5 text-xs text-stone-500 dark:text-stone-400"
                        style={{ width: trackWidth }}
                      >
                        <span className="px-3">
                          {p.type === 'HOTEL' ? 'Otel' : 'Apart'}
                        </span>
                      </div>
                    </div>

                    {propUnits.length === 0 && (
                      <div className="flex border-b border-stone-200 dark:border-stone-700">
                        <div
                          className="sticky left-0 z-10 shrink-0 bg-white px-3 py-2 text-xs italic text-stone-400 dark:bg-stone-900"
                          style={{ width: LABEL_W }}
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
                            style={{ width: LABEL_W, height: ROW_H }}
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
        <p className="hidden text-xs text-stone-500 dark:text-stone-400 md:block">
          Boş bir güne tıklayarak yeni rezervasyon oluşturabilirsiniz.
        </p>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// MobileAgenda — list-style alternative shown below the `md` breakpoint.
// Same data as the Gantt: reservations that overlap the active 28-day window.
// Sorted by stay_start; cancelled reservations are filtered out to match the
// Gantt's behavior. Grouped under a small date header so the user can scan by
// arrival day. Tapping a card navigates to /reservations/<id>.
// -----------------------------------------------------------------------------

const longDateFmt = new Intl.DateTimeFormat('tr-TR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});

const STATUS_LIST_BADGE: Record<ReservationStatus, string> = {
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  completed: 'bg-stone-200 text-stone-700 dark:bg-stone-700 dark:text-stone-200',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
};

interface MobileAgendaProps {
  reservations: ReservationWithRefs[];
  windowStart: string;
  windowDays: number;
  today: string;
}

function MobileAgenda({ reservations, windowStart, windowDays, today }: MobileAgendaProps) {
  const windowEndStr = addDaysStr(windowStart, windowDays);

  // Filter to in-window + non-cancelled, then sort by stay_start.
  const visible = useMemo(() => {
    return reservations
      .filter((r) => {
        if (r.status === 'cancelled') return false;
        const s = r.stay_start.slice(0, 10);
        const e = r.stay_end.slice(0, 10);
        // overlap: starts before window-end AND ends after window-start
        return s < windowEndStr && e > windowStart;
      })
      .sort((a, b) => a.stay_start.localeCompare(b.stay_start));
  }, [reservations, windowStart, windowEndStr]);

  // Group by stay_start date (YYYY-MM-DD). Keeps insertion order via Map.
  const groups = useMemo(() => {
    const m = new Map<string, ReservationWithRefs[]>();
    for (const r of visible) {
      const k = r.stay_start.slice(0, 10);
      const arr = m.get(k) ?? [];
      arr.push(r);
      m.set(k, arr);
    }
    return Array.from(m.entries());
  }, [visible]);

  if (visible.length === 0) {
    return (
      <Card>
        <p className="text-center text-sm text-stone-600 dark:text-stone-300">
          Bu zaman aralığında rezervasyon yok.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {groups.map(([dateStr, items]) => {
        const d = new Date(dateStr + 'T00:00:00Z');
        const headerLabel = longDateFmt.format(d);
        const isToday = dateStr === today;
        const isPast = dateStr < today;
        return (
          <section key={dateStr} className="space-y-2">
            <div className="flex items-baseline gap-2">
              <h2
                className={cn(
                  'text-sm font-semibold',
                  isToday
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : isPast
                      ? 'text-stone-500 dark:text-stone-400'
                      : 'text-stone-800 dark:text-stone-200',
                )}
              >
                {headerLabel}
              </h2>
              {isToday && (
                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                  Bugün
                </span>
              )}
            </div>
            <ul className="space-y-2">
              {items.map((r) => {
                const sStr = r.stay_start.slice(0, 10);
                const eStr = r.stay_end.slice(0, 10);
                const nights = Math.max(1, dayIndex(sStr, eStr));
                return (
                  <li key={r.id}>
                    <Link
                      to={`/reservations/${r.id}`}
                      className="block rounded-lg border border-stone-200 bg-white p-3 transition-colors hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:hover:bg-stone-800/50"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 flex-1 font-medium text-stone-900 dark:text-stone-100">
                          {r.guest?.full_name ?? '—'}
                        </p>
                        <span
                          className={cn(
                            'shrink-0 rounded px-2 py-0.5 text-xs font-medium',
                            STATUS_LIST_BADGE[r.status],
                          )}
                        >
                          {STATUS_LABELS[r.status]}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-stone-600 dark:text-stone-300">
                        {r.property?.name ?? '—'} · {r.unit?.name ?? '—'}
                      </p>
                      <p className="mt-1 text-xs text-stone-700 dark:text-stone-300">
                        {formatDate(sStr)} → {formatDate(eStr)}{' '}
                        <span className="text-stone-500 dark:text-stone-400">
                          · {nights} gece
                        </span>
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
