import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  listKbsSubmissions,
  markKbsStatus,
  getKbsCopyText,
  type KbsListItem,
} from '@/lib/queries/kbs';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { cn, formatDate, formatDateTime } from '@/lib/utils';
import type { KbsStatus } from '@/types/database';

type FilterOption = 'ALL' | KbsStatus;

const STATUS_LABELS: Record<KbsStatus, string> = {
  PENDING: 'Bildirilecek',
  SUBMITTED: 'Bildirildi',
  CONFIRMED: 'Onaylandı',
  FAILED: 'Başarısız',
};

const STATUS_BADGE: Record<KbsStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  SUBMITTED: 'bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300',
  CONFIRMED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  FAILED: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
};

const FILTER_LABELS: Record<FilterOption, string> = {
  ALL: 'Tümü',
  PENDING: 'Bildirilecek',
  SUBMITTED: 'Bildirildi',
  CONFIRMED: 'Onaylandı',
  FAILED: 'Başarısız',
};

export function KbsListPage() {
  const [items, setItems] = useState<KbsListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterOption>('PENDING');

  // Per-row action state
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copyId, setCopyId] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<Record<string, 'ok' | 'fail'>>({});

  const load = () => {
    setError(null);
    listKbsSubmissions()
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : 'Yüklenemedi'));
  };

  useEffect(() => {
    load();
  }, []);

  const counts = useMemo(() => {
    const m: Record<KbsStatus, number> = {
      PENDING: 0,
      SUBMITTED: 0,
      CONFIRMED: 0,
      FAILED: 0,
    };
    for (const i of items ?? []) m[i.status] += 1;
    return m;
  }, [items]);
  const totalCount = items?.length ?? 0;

  const visible = useMemo(() => {
    if (!items) return [];
    if (filter === 'ALL') return items;
    return items.filter((i) => i.status === filter);
  }, [items, filter]);

  const handleMark = async (item: KbsListItem, next: KbsStatus) => {
    setBusyId(item.id);
    try {
      const updated = await markKbsStatus(item.id, next);
      setItems((prev) =>
        prev
          ? prev.map((i) =>
              i.id === item.id
                ? { ...i, status: updated.status, submitted_at: updated.submitted_at }
                : i,
            )
          : prev,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Durum güncellenemedi');
    } finally {
      setBusyId(null);
    }
  };

  const clearCopyAfter = (itemId: string, ms: number) => {
    window.setTimeout(() => {
      setCopyStatus((s) => {
        if (!(itemId in s)) return s;
        const { [itemId]: _gone, ...rest } = s;
        void _gone;
        return rest;
      });
    }, ms);
  };

  const handleCopy = async (item: KbsListItem) => {
    setCopyId(item.id);
    try {
      const text = await getKbsCopyText(item);
      if (!text) throw new Error('Misafir bilgisi alınamadı');
      await navigator.clipboard.writeText(text);
      setCopyStatus((s) => ({ ...s, [item.id]: 'ok' }));
      clearCopyAfter(item.id, 2000);
    } catch {
      setCopyStatus((s) => ({ ...s, [item.id]: 'fail' }));
      clearCopyAfter(item.id, 3000);
    } finally {
      setCopyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">KBS</h1>
        <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
          Aktife alınan rezervasyonlar için Emniyet KBS portalına bildirim listesi.
          Her satır için <strong>Detayları Kopyala</strong> ile bilgiyi panoya alıp
          portala yapıştırın, ardından <strong>Bildirildi olarak işaretle</strong>'ye tıklayın.
        </p>
      </div>

      {/* Status filter chips */}
      <div className="flex flex-wrap gap-2">
        {(['ALL', 'PENDING', 'SUBMITTED', 'CONFIRMED', 'FAILED'] as const).map((f) => {
          const count =
            f === 'ALL'
              ? totalCount
              : counts[f as KbsStatus];
          const active = filter === f;
          return (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                'rounded-full px-4 py-1 text-sm font-medium transition-colors',
                active
                  ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                  : 'border border-stone-300 text-stone-700 hover:bg-stone-100 dark:border-stone-600 dark:text-stone-300 dark:hover:bg-stone-800',
              )}
            >
              {FILTER_LABELS[f]} <span className="ml-1 text-xs opacity-70">({count})</span>
            </button>
          );
        })}
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40">
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </Card>
      )}

      {!items && !error && (
        <p className="text-sm text-stone-600 dark:text-stone-300">Yükleniyor…</p>
      )}

      {items && visible.length === 0 && (
        <Card>
          <p className="text-center text-sm text-stone-600 dark:text-stone-300">
            {filter === 'PENDING'
              ? 'Bildirilecek kayıt yok.'
              : 'Bu filtreye uyan kayıt yok.'}
          </p>
        </Card>
      )}

      {visible.map((item) => {
        const isPending = item.status === 'PENDING';
        const isSubmitted = item.status === 'SUBMITTED' || item.status === 'CONFIRMED';
        const copyState = copyStatus[item.id];
        return (
          <Card key={item.id} className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">
                    {item.guest?.full_name ?? '(Misafir silinmiş)'}
                  </h2>
                  <span
                    className={cn(
                      'rounded px-2 py-0.5 text-xs font-medium',
                      STATUS_BADGE[item.status],
                    )}
                  >
                    {STATUS_LABELS[item.status]}
                  </span>
                </div>
                <p className="text-sm text-stone-700 dark:text-stone-300">
                  {item.property?.name ?? '?'} · {item.unit?.name ?? '?'}
                </p>
                <p className="text-sm text-stone-600 dark:text-stone-300">
                  Giriş: <strong>{item.reservation ? formatDate(item.reservation.stay_start) : '?'}</strong>{' '}
                  · Çıkış:{' '}
                  <strong>{item.reservation ? formatDate(item.reservation.stay_end) : '?'}</strong>
                </p>
                <p className="text-xs text-stone-500 dark:text-stone-400">
                  Oluşturuldu: {formatDateTime(item.created_at)}
                  {item.submitted_at && (
                    <> · Bildirildi: {formatDateTime(item.submitted_at)}</>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {item.reservation && (
                  <Link to={`/reservations/${item.reservation.id}`}>
                    <Button variant="ghost" size="sm">
                      Rezervasyona Git
                    </Button>
                  </Link>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  loading={copyId === item.id}
                  onClick={() => handleCopy(item)}
                >
                  {copyState === 'ok'
                    ? 'Kopyalandı ✓'
                    : copyState === 'fail'
                      ? 'Kopyalanamadı'
                      : 'Detayları Kopyala'}
                </Button>
                {isPending && (
                  <Button
                    size="sm"
                    loading={busyId === item.id}
                    onClick={() => handleMark(item, 'SUBMITTED')}
                  >
                    Bildirildi olarak işaretle
                  </Button>
                )}
                {isSubmitted && (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={busyId === item.id}
                    onClick={() => handleMark(item, 'PENDING')}
                  >
                    Geri çek
                  </Button>
                )}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
