import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { can } from '@/lib/rbac';
import { listReservations, type ReservationWithRefs } from '@/lib/queries/reservations';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ReservationsViewTabs } from './ViewTabs';
import { formatTRY, formatDate } from '@/lib/utils';
import type { ReservationStatus } from '@/types/database';

const STATUS_LABELS: Record<ReservationStatus, string> = {
  pending: 'Beklemede',
  upcoming: 'Yakında',
  active: 'Aktif',
  completed: 'Tamamlandı',
  cancelled: 'İptal',
};

const STATUS_COLORS: Record<ReservationStatus, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  upcoming: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  completed: 'bg-stone-200 text-stone-700 dark:bg-stone-700 dark:text-stone-200',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

// The "Tümü" view groups reservations under one heading per status, in this
// order — so Yakında, Aktif etc. each get their own section.
const GROUP_ORDER: ReservationStatus[] = [
  'active',
  'upcoming',
  'completed',
  'pending',
  'cancelled',
];

export function ReservationsListPage() {
  const { profile } = useAuth();
  const [reservations, setReservations] = useState<ReservationWithRefs[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'ALL' | ReservationStatus>('ALL');

  useEffect(() => {
    listReservations()
      .then(setReservations)
      .catch((e) => setError(e?.message ?? 'Rezervasyonlar yüklenemedi'));
  }, []);

  const canCreate = profile && can(profile.role, 'reservation:create');

  // The flat list for a specific status filter — also drives the empty check.
  const filtered = useMemo(() => {
    if (!reservations) return [];
    if (filter === 'ALL') return reservations;
    return reservations.filter((r) => r.status === filter);
  }, [reservations, filter]);

  // The "Tümü" view: one section per status. Yakında is sorted soonest-first
  // (what's coming up next); every other group keeps most-recent-first.
  const groups = useMemo(() => {
    if (!reservations) return [];
    return GROUP_ORDER.map((status) => ({
      status,
      label: STATUS_LABELS[status],
      items: reservations
        .filter((r) => r.status === status)
        .sort((a, b) =>
          status === 'upcoming'
            ? a.stay_start.localeCompare(b.stay_start)
            : b.stay_start.localeCompare(a.stay_start),
        ),
    })).filter((g) => g.items.length > 0);
  }, [reservations]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
            Rezervasyonlar
          </h1>
          <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
            Tüm rezervasyonların listesi
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <ReservationsViewTabs />
          {canCreate && (
            <Link to="/reservations/new">
              <Button>+ Yeni</Button>
            </Link>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(['ALL', 'active', 'upcoming', 'completed', 'pending', 'cancelled'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={
              filter === f
                ? 'rounded-full bg-emerald-600 px-4 py-1 text-sm font-medium text-white'
                : 'rounded-full border border-stone-300 px-4 py-1 text-sm text-stone-700 hover:bg-stone-100 dark:border-stone-600 dark:text-stone-300 dark:hover:bg-stone-800'
            }
          >
            {f === 'ALL' ? 'Tümü' : STATUS_LABELS[f]}
          </button>
        ))}
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40">
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </Card>
      )}

      {!reservations && !error && (
        <p className="text-sm text-stone-600 dark:text-stone-300">Yükleniyor…</p>
      )}

      {reservations && filtered.length === 0 && (
        <Card>
          <p className="text-center text-sm text-stone-600 dark:text-stone-300">
            Bu filtreyle eşleşen rezervasyon yok.
          </p>
        </Card>
      )}

      {reservations &&
        filtered.length > 0 &&
        (filter === 'ALL' ? (
          <div className="space-y-6">
            {groups.map((g) => (
              <section key={g.status} className="space-y-2">
                <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
                  {g.label}
                  <span className="ml-2 text-sm font-normal text-stone-500 dark:text-stone-400">
                    {g.items.length}
                  </span>
                </h2>
                <ReservationRows items={g.items} />
              </section>
            ))}
          </div>
        ) : (
          <ReservationRows items={filtered} />
        ))}
    </div>
  );
}

/** The mobile cards + tablet table for a list of reservations. */
function ReservationRows({ items }: { items: ReservationWithRefs[] }) {
  return (
    <>
      {/* Mobile: stacked cards */}
      <div className="space-y-2 sm:hidden">
        {items.map((r) => (
          <Link
            key={r.id}
            to={`/reservations/${r.id}`}
            className="block rounded-lg border border-stone-200 bg-white p-3 transition-colors hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:hover:bg-stone-800/50"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 flex-1 font-medium text-stone-900 dark:text-stone-100">
                {r.guest?.full_name ?? '—'}
              </p>
              <span
                className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[r.status]}`}
              >
                {STATUS_LABELS[r.status]}
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs text-stone-600 dark:text-stone-300">
              {r.property?.name} · {r.unit?.name}
            </p>
            <p className="mt-1 flex items-center justify-between gap-2 text-xs text-stone-700 dark:text-stone-300">
              <span>
                {formatDate(r.stay_start)} → {formatDate(r.stay_end)}
              </span>
              <span className="font-semibold text-stone-900 dark:text-stone-100">
                {formatTRY(Number(r.total_amount))}
              </span>
            </p>
          </Link>
        ))}
      </div>

      {/* Tablet+ : table */}
      <Card className="hidden p-0 sm:block">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-stone-300 text-xs uppercase text-stone-600 dark:border-stone-700 dark:text-stone-300">
              <tr>
                <th className="px-6 py-3 font-medium">Misafir</th>
                <th className="px-6 py-3 font-medium">Mülk / Birim</th>
                <th className="px-6 py-3 font-medium">Tarih</th>
                <th className="px-6 py-3 font-medium">Tutar</th>
                <th className="px-6 py-3 font-medium">Durum</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-300 dark:divide-stone-700">
              {items.map((r) => (
                <tr key={r.id} className="transition-colors hover:bg-stone-50 dark:hover:bg-stone-800/50">
                  <td className="px-6 py-3 font-medium text-stone-900 dark:text-stone-100">
                    <Link to={`/reservations/${r.id}`} className="block">
                      {r.guest?.full_name ?? '—'}
                    </Link>
                  </td>
                  <td className="px-6 py-3 text-stone-700 dark:text-stone-300">
                    <div className="text-base font-semibold text-stone-900 dark:text-stone-100">
                      {r.unit?.name}
                    </div>
                    <div className="text-xs text-stone-600 dark:text-stone-400">
                      {r.property?.name}
                    </div>
                  </td>
                  <td className="px-6 py-3 text-stone-700 dark:text-stone-300">
                    <div>{formatDate(r.stay_start)}</div>
                    <div className="text-xs text-stone-600 dark:text-stone-400">
                      → {formatDate(r.stay_end)}
                    </div>
                  </td>
                  <td className="px-6 py-3 text-stone-700 dark:text-stone-300">
                    {formatTRY(Number(r.total_amount))}
                  </td>
                  <td className="px-6 py-3">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[r.status]}`}>
                      {STATUS_LABELS[r.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
