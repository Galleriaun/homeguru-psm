import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  listReservationsInRange,
  type ReservationWithRefs,
} from '@/lib/queries/reservations';
import { Card } from '@/components/ui/Card';
import { cn, istanbulToday } from '@/lib/utils';

// --- date helpers in YYYY-MM-DD UTC-day space (stay_* are stored at UTC) ---
function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function mondayOnOrBefore(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}
function addMonths(monthStartStr: string, delta: number): string {
  const d = new Date(monthStartStr + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + delta);
  return d.toISOString().slice(0, 10); // day is always 01, so it stays 01
}

// Istanbul (UTC+3, fixed — no DST since 2016) wall-clock from a stored
// timestamptz ISO: shift +3h then slice the relevant part.
function istanbulClock(iso: string): string {
  return new Date(new Date(iso).getTime() + 3 * 60 * 60 * 1000)
    .toISOString()
    .slice(11, 16);
}
function istanbulDay(iso: string): string {
  return new Date(new Date(iso).getTime() + 3 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

// Monday-first to match the Turkish week convention used across the app.
const WEEKDAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const monthYearFmt = new Intl.DateTimeFormat('tr-TR', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

interface DayUseMonthCalendarProps {
  /** Bump to force a refetch (e.g. after a reservation edit elsewhere on the page). */
  refreshKey?: number;
}

/**
 * Month-grid calendar dedicated to güniçi (DAYUSE) stays. They begin and end on
 * the same day, so they collapse to a zero-width bar on the resource-timeline
 * Gantt and can't be shown there. Here each one renders as a timed chip
 * (14:00–16:00) on its day. Self-contained — it fetches its own month range so
 * it stays decoupled from the Gantt's 28-day window and navigation.
 */
export function DayUseMonthCalendar({ refreshKey = 0 }: DayUseMonthCalendarProps) {
  const navigate = useNavigate();
  const [monthStart, setMonthStart] = useState(() => istanbulToday().slice(0, 7) + '-01');
  const [stays, setStays] = useState<ReservationWithRefs[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const today = istanbulToday();
  // The visible grid is always 6 weeks (42 days) from the Monday on/before the
  // 1st — enough rows for any month layout.
  const gridStart = useMemo(() => mondayOnOrBefore(monthStart), [monthStart]);

  useEffect(() => {
    // Guard against out-of-order resolution: when the month changes faster than
    // a fetch completes, an earlier response must not clobber a later one (and
    // we must not setState after unmount).
    let ignore = false;
    const startISO = new Date(gridStart + 'T00:00:00Z').toISOString();
    const endISO = new Date(addDaysStr(gridStart, 42) + 'T00:00:00Z').toISOString();
    setLoading(true);
    setError(null);
    listReservationsInRange(startISO, endISO)
      .then((rs) => {
        if (ignore) return;
        setStays(rs.filter((r) => r.stay_type === 'DAYUSE' && r.status !== 'cancelled'));
      })
      .catch((e) => {
        if (ignore) return;
        setError(e instanceof Error ? e.message : 'Yüklenemedi');
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [gridStart, refreshKey]);

  // Bucket stays by their Istanbul calendar day, earliest giriş first.
  const byDay = useMemo(() => {
    const m = new Map<string, ReservationWithRefs[]>();
    for (const r of stays) {
      const day = istanbulDay(r.stay_start);
      const arr = m.get(day) ?? [];
      arr.push(r);
      m.set(day, arr);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => a.stay_start.localeCompare(b.stay_start));
    }
    return m;
  }, [stays]);

  const cells = useMemo(
    () =>
      Array.from({ length: 42 }, (_, i) => {
        const dateStr = addDaysStr(gridStart, i);
        return {
          dateStr,
          dayNum: Number(dateStr.slice(8, 10)),
          inMonth: dateStr.slice(0, 7) === monthStart.slice(0, 7),
          isToday: dateStr === today,
        };
      }),
    [gridStart, monthStart, today],
  );

  const monthLabel = monthYearFmt.format(new Date(monthStart + 'T00:00:00Z'));
  const navBtn =
    'rounded px-2 py-1 text-stone-600 hover:bg-stone-200 dark:text-stone-300 dark:hover:bg-stone-700';

  return (
    <Card className="p-0">
      {/* Header: month label + navigation */}
      <div className="flex items-center justify-between border-b border-stone-300 bg-stone-50 px-3 py-2 dark:border-stone-600 dark:bg-stone-800/40">
        <span className="text-sm font-semibold text-stone-700 dark:text-stone-200">
          Güniçi konaklamalar — {monthLabel}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMonthStart((m) => addMonths(m, -1))}
            aria-label="Önceki ay"
            className={cn(navBtn, 'text-base leading-none')}
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => setMonthStart(istanbulToday().slice(0, 7) + '-01')}
            className={cn(navBtn, 'text-xs font-medium')}
          >
            Bugün
          </button>
          <button
            type="button"
            onClick={() => setMonthStart((m) => addMonths(m, 1))}
            aria-label="Sonraki ay"
            className={cn(navBtn, 'text-base leading-none')}
          >
            ›
          </button>
        </div>
      </div>

      {error && (
        <p className="px-3 py-2 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {/* min-w keeps each column readable; the grid scrolls horizontally on
          phones and fills the width on tablet/desktop. */}
      <div className="overflow-x-auto">
        <div className="min-w-[640px]">
          {/* Weekday header */}
          <div className="grid grid-cols-7 border-b border-stone-200 text-center text-[11px] font-medium uppercase tracking-wide text-stone-500 dark:border-stone-700 dark:text-stone-400">
            {WEEKDAYS.map((w) => (
              <div key={w} className="py-1">
                {w}
              </div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7">
            {cells.map((c) => {
              const chips = byDay.get(c.dateStr) ?? [];
              return (
                <div
                  key={c.dateStr}
                  className={cn(
                    'min-h-[72px] border-b border-r border-stone-200 p-1 dark:border-stone-700',
                    !c.inMonth && 'bg-stone-50 dark:bg-stone-900/40',
                  )}
                >
                  <div className="mb-0.5 flex justify-end">
                    <span
                      className={cn(
                        'text-[11px] leading-none',
                        c.isToday
                          ? 'rounded bg-emerald-600 px-1 py-0.5 font-semibold text-white dark:bg-emerald-500'
                          : c.inMonth
                            ? 'text-stone-600 dark:text-stone-300'
                            : 'text-stone-400 dark:text-stone-600',
                      )}
                    >
                      {c.dayNum}
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    {chips.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => navigate(`/reservations/${r.id}`)}
                        title={`${r.guest?.full_name ?? ''} · ${r.unit?.name ?? ''} · ${istanbulClock(r.stay_start)}–${istanbulClock(r.stay_end)}`}
                        className="block w-full rounded bg-emerald-100 px-1 py-0.5 text-left text-[10px] leading-tight text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-200 dark:hover:bg-emerald-900/70"
                      >
                        <span className="block font-semibold">
                          {istanbulClock(r.stay_start)}–{istanbulClock(r.stay_end)}
                        </span>
                        <span className="block truncate">
                          {r.guest?.full_name ?? '—'}
                          {r.unit?.name ? ` · ${r.unit.name}` : ''}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {loading && (
        <p className="px-3 py-2 text-xs text-stone-500 dark:text-stone-400">Yükleniyor…</p>
      )}
    </Card>
  );
}
