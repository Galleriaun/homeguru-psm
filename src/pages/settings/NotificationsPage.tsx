import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  notifCategory,
  NOTIF_CATEGORY_LABELS,
  NOTIF_CATEGORY_ORDER,
  type NotificationRow,
  type NotifCategory,
} from '@/lib/queries/notifications';
import { Card } from '@/components/ui/Card';
import { formatDateTime } from '@/lib/utils';

type Filter = 'all' | NotifCategory;

/** Short Turkish "... önce" from an ISO timestamp; falls back to a full date. */
function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'az önce';
  if (mins < 60) return `${mins} dk önce`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} sa önce`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} gün önce`;
  return formatDateTime(iso);
}

const CATEGORY_DOT: Record<NotifCategory, string> = {
  rezervasyon: 'bg-sky-500',
  onay: 'bg-amber-500',
  sorun: 'bg-red-500',
  diger: 'bg-stone-400',
};

export function NotificationsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<NotificationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [markingAll, setMarkingAll] = useState(false);

  useEffect(() => {
    listNotifications()
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : 'Bildirimler yüklenemedi'));
  }, []);

  // Only offer filter chips for categories that actually appear, so a role that
  // never receives (say) "Sorun" doesn't see a permanently empty tab.
  const presentCategories = useMemo(() => {
    const set = new Set<NotifCategory>();
    for (const n of items ?? []) set.add(notifCategory(n));
    return NOTIF_CATEGORY_ORDER.filter((c) => set.has(c));
  }, [items]);

  const filtered = useMemo(() => {
    if (!items) return [];
    if (filter === 'all') return items;
    return items.filter((n) => notifCategory(n) === filter);
  }, [items, filter]);

  const unreadCount = useMemo(
    () => (items ?? []).filter((n) => n.read_at === null).length,
    [items],
  );

  const openNotification = async (n: NotificationRow) => {
    // Optimistically mark read so the dot clears instantly; ignore failures
    // (worst case it re-appears unread on reload).
    if (n.read_at === null) {
      setItems((prev) =>
        prev?.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)) ??
        prev,
      );
      markNotificationRead(n.id).catch(() => {});
    }
    // Navigate to the source only for a safe in-app path.
    if (n.url && n.url.startsWith('/')) navigate(n.url);
  };

  const handleMarkAll = async () => {
    if (markingAll || unreadCount === 0) return;
    setMarkingAll(true);
    const now = new Date().toISOString();
    setItems((prev) => prev?.map((x) => (x.read_at ? x : { ...x, read_at: now })) ?? prev);
    try {
      await markAllNotificationsRead();
    } catch {
      // Re-sync from the server if the bulk update failed.
      listNotifications().then(setItems).catch(() => {});
    } finally {
      setMarkingAll(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
            Bildirimler
          </h1>
          <p className="text-sm text-stone-600 dark:text-stone-300">
            Son 15 günün bildirimleri.
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={handleMarkAll}
            disabled={markingAll}
            className="rounded-md border border-stone-300 px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-100 disabled:opacity-60 dark:border-stone-600 dark:text-stone-300 dark:hover:bg-stone-800"
          >
            Tümünü okundu işaretle
          </button>
        )}
      </div>

      {(presentCategories.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {(['all', ...presentCategories] as Filter[]).map((f) => {
            const isActive = filter === f;
            const label = f === 'all' ? 'Tümü' : NOTIF_CATEGORY_LABELS[f];
            return (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={
                  isActive
                    ? 'rounded-full border border-emerald-600 bg-emerald-600 px-4 py-1 text-sm font-medium text-white'
                    : 'rounded-full border border-stone-300 px-4 py-1 text-sm text-stone-700 hover:bg-stone-100 dark:border-stone-600 dark:text-stone-300 dark:hover:bg-stone-800'
                }
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {error && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40">
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </Card>
      )}

      {!items && !error && (
        <p className="text-sm text-stone-600 dark:text-stone-300">Yükleniyor…</p>
      )}

      {items && filtered.length === 0 && !error && (
        <Card>
          <p className="text-center text-sm text-stone-600 dark:text-stone-300">
            Bildirim yok.
          </p>
        </Card>
      )}

      {filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map((n) => {
            const cat = notifCategory(n);
            const unread = n.read_at === null;
            const clickable = Boolean(n.url && n.url.startsWith('/'));
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => openNotification(n)}
                className={
                  'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors ' +
                  (unread
                    ? 'border-stone-300 bg-white dark:border-stone-600 dark:bg-stone-900'
                    : 'border-stone-200 bg-stone-50 dark:border-stone-700 dark:bg-stone-900/50') +
                  (clickable ? ' hover:bg-stone-100 dark:hover:bg-stone-800' : ' cursor-default')
                }
              >
                <span
                  aria-hidden="true"
                  className={
                    'mt-1.5 h-2 w-2 shrink-0 rounded-full ' +
                    (unread ? CATEGORY_DOT[cat] : 'bg-transparent')
                  }
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p
                      className={
                        'min-w-0 break-words text-sm ' +
                        (unread
                          ? 'font-semibold text-stone-900 dark:text-stone-100'
                          : 'font-medium text-stone-700 dark:text-stone-300')
                      }
                    >
                      {n.title}
                    </p>
                    <span className="shrink-0 whitespace-nowrap text-xs text-stone-500 dark:text-stone-400">
                      {timeAgo(n.created_at)}
                    </span>
                  </div>
                  {n.body && (
                    <p className="mt-0.5 whitespace-pre-line break-words text-sm text-stone-600 dark:text-stone-400">
                      {n.body}
                    </p>
                  )}
                  <span className="mt-1 inline-block rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-medium text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                    {NOTIF_CATEGORY_LABELS[cat]}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
