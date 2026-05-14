import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { can } from '@/lib/rbac';
import { listReservations, type ReservationWithRefs } from '@/lib/queries/reservations';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { formatTRY, formatDate } from '@/lib/utils';
import type { ReservationStatus } from '@/types/database';

const STATUS_LABELS: Record<ReservationStatus, string> = {
  pending: 'Beklemede',
  active: 'Aktif',
  completed: 'Tamamlandı',
  cancelled: 'İptal',
};

const STATUS_COLORS: Record<ReservationStatus, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  completed: 'bg-stone-200 text-stone-700 dark:bg-stone-700 dark:text-stone-200',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

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

  const filtered = useMemo(() => {
    if (!reservations) return [];
    if (filter === 'ALL') return reservations;
    return reservations.filter((r) => r.status === filter);
  }, [reservations, filter]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
            Rezervasyonlar
          </h1>
          <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
            Tüm rezervasyonların listesi
          </p>
        </div>
        {canCreate && (
          <Link to="/reservations/new">
            <Button>+ Yeni Rezervasyon</Button>
          </Link>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {(['ALL', 'pending', 'active', 'completed', 'cancelled'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={
              filter === f
                ? 'rounded-full bg-emerald-600 px-4 py-1 text-sm font-medium text-white'
                : 'rounded-full border border-stone-300 px-4 py-1 text-sm text-stone-700 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800'
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
        <p className="text-sm text-stone-600 dark:text-stone-400">Yükleniyor…</p>
      )}

      {reservations && filtered.length === 0 && (
        <Card>
          <p className="text-center text-sm text-stone-600 dark:text-stone-400">
            Bu filtreyle eşleşen rezervasyon yok.
          </p>
        </Card>
      )}

      {reservations && filtered.length > 0 && (
        <Card className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-stone-300 text-xs uppercase text-stone-600 dark:border-stone-800 dark:text-stone-400">
                <tr>
                  <th className="px-6 py-3 font-medium">Misafir</th>
                  <th className="px-6 py-3 font-medium">Mülk / Birim</th>
                  <th className="px-6 py-3 font-medium">Tarih</th>
                  <th className="px-6 py-3 font-medium">Tutar</th>
                  <th className="px-6 py-3 font-medium">Durum</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-300 dark:divide-stone-800">
                {filtered.map((r) => (
                  <tr key={r.id} className="transition-colors hover:bg-stone-50 dark:hover:bg-stone-800/50">
                    <td className="px-6 py-3 font-medium text-stone-900 dark:text-stone-100">
                      <Link to={`/reservations/${r.id}`} className="block">
                        {r.guest?.full_name ?? '—'}
                      </Link>
                    </td>
                    <td className="px-6 py-3 text-stone-700 dark:text-stone-400">
                      <div>{r.property?.name}</div>
                      <div className="text-xs text-stone-600 dark:text-stone-500">
                        {r.unit?.name}
                      </div>
                    </td>
                    <td className="px-6 py-3 text-stone-700 dark:text-stone-400">
                      <div>{formatDate(r.stay_start)}</div>
                      <div className="text-xs text-stone-600 dark:text-stone-500">
                        → {formatDate(r.stay_end)}
                      </div>
                    </td>
                    <td className="px-6 py-3 text-stone-700 dark:text-stone-400">
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
      )}
    </div>
  );
}
