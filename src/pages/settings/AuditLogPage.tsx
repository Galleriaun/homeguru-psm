import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import {
  listAuditLog,
  listAuditFacets,
  lookupStaffNames,
  formatMetadata,
  type AuditEntry,
  type AuditFilters,
} from '@/lib/queries/audit';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DateInput } from '@/components/ui/DateInput';
import { Select } from '@/components/ui/Select';
import { cn, formatDateTime } from '@/lib/utils';

const PAGE_SIZE = 50;

/**
 * Turkish display labels for raw audit codes. The DB still stores English
 * canonical strings ('DECRYPT', 'sensitive_field', etc.) so anything not
 * mapped here renders as-is (fine for any future action we haven't translated).
 */
const ACTION_LABELS: Record<string, string> = {
  DECRYPT: 'Okuma (Şifre Çözme)',
};

const ENTITY_TYPE_LABELS: Record<string, string> = {
  sensitive_field: 'Hassas Alan',
};

const labelOr = (map: Record<string, string>, value: string): string =>
  map[value] ?? value;

export function AuditLogPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'SUPER_ADMIN';

  // Filters
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [from, setFrom] = useState(''); // YYYY-MM-DD
  const [to, setTo] = useState('');     // YYYY-MM-DD

  // Page
  const [page, setPage] = useState(0);

  // Data
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [staffNames, setStaffNames] = useState<Map<string, string>>(() => new Map());
  const [facets, setFacets] = useState<{ actions: string[]; entityTypes: string[] }>({
    actions: [],
    entityTypes: [],
  });

  // Per-row expand state for metadata
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Build the AuditFilters object once per filter change.
  const filters: AuditFilters = useMemo(
    () => ({
      action: action || undefined,
      entityType: entityType || undefined,
      from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
      // Exclusive upper bound: add 1 day so the user picking "to=18.05" includes the 18th.
      to: to ? new Date(new Date(`${to}T00:00:00`).getTime() + 86_400_000).toISOString() : undefined,
    }),
    [action, entityType, from, to],
  );

  // Reset to first page whenever filters change.
  useEffect(() => {
    setPage(0);
  }, [action, entityType, from, to]);

  // Load facets once.
  useEffect(() => {
    if (!isAdmin) return;
    listAuditFacets()
      .then(setFacets)
      .catch(() => {
        /* facets are best-effort; failure just leaves the dropdowns empty */
      });
  }, [isAdmin]);

  // Load page whenever filters or page change.
  useEffect(() => {
    if (!isAdmin) return;
    setLoadError(null);
    setRows(null);
    listAuditLog(filters, { page, pageSize: PAGE_SIZE })
      .then(async (res) => {
        setRows(res.rows);
        setTotal(res.total);
        // Background: fetch staff names for any user_ids we haven't seen yet
        const ids = res.rows
          .map((r) => r.user_id)
          .filter((u): u is string => Boolean(u));
        const missing = ids.filter((id) => !staffNames.has(id));
        if (missing.length > 0) {
          try {
            const map = await lookupStaffNames(missing);
            setStaffNames((prev) => {
              const merged = new Map(prev);
              for (const [k, v] of map) merged.set(k, v);
              return merged;
            });
          } catch {
            // Non-fatal: names just stay as uuids
          }
        }
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Yüklenemedi'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, page, isAdmin]);

  if (!isAdmin) {
    return (
      <Card>
        <p className="text-sm text-stone-700 dark:text-stone-300">
          Bu sayfayı görüntülemek için süper admin yetkisi gereklidir.
        </p>
      </Card>
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageStart = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const pageEnd = Math.min(total, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
          Denetim Kaydı
        </h1>
        <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
          Her erişim ve finansal durum değişiklikleri burada kayıt altındadır.
          Sadece okuma — düzenleme veya silme yapılamaz.
        </p>
      </div>

      <Card>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select
            label="Aksiyon"
            name="filter_action"
            value={action}
            onChange={setAction}
            options={[
              { value: '', label: 'Tümü' },
              ...facets.actions.map((a) => ({ value: a, label: labelOr(ACTION_LABELS, a) })),
            ]}
          />
          <Select
            label="Varlık Tipi"
            name="filter_entity_type"
            value={entityType}
            onChange={setEntityType}
            options={[
              { value: '', label: 'Tümü' },
              ...facets.entityTypes.map((t) => ({
                value: t,
                label: labelOr(ENTITY_TYPE_LABELS, t),
              })),
            ]}
          />
          <DateInput
            label="Başlangıç"
            name="filter_from"
            value={from}
            onChange={setFrom}
          />
          <DateInput
            label="Bitiş"
            name="filter_to"
            value={to}
            onChange={setTo}
          />
        </div>
      </Card>

      {loadError && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40">
          <p className="text-sm text-red-700 dark:text-red-400">{loadError}</p>
        </Card>
      )}

      {!loadError && rows === null && (
        <p className="text-sm text-stone-600 dark:text-stone-300">Yükleniyor…</p>
      )}

      {rows && rows.length === 0 && (
        <Card>
          <p className="text-center text-sm text-stone-600 dark:text-stone-300">
            Bu filtreyle eşleşen kayıt yok.
          </p>
        </Card>
      )}

      {rows && rows.length > 0 && (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm text-stone-600 dark:text-stone-300">
              {pageStart}–{pageEnd} / {total} kayıt
            </p>
            <div className="flex items-center gap-2 text-sm">
              <Button
                variant="secondary"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                ← Önceki
              </Button>
              <span className="text-stone-600 dark:text-stone-300">
                Sayfa {page + 1} / {totalPages}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={page + 1 >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Sonraki →
              </Button>
            </div>
          </div>

          <Card className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-stone-300 text-xs uppercase text-stone-600 dark:border-stone-700 dark:text-stone-300">
                  <tr>
                    <th className="px-4 py-3 font-medium">Zaman</th>
                    <th className="px-4 py-3 font-medium">Kullanıcı</th>
                    <th className="px-4 py-3 font-medium">Aksiyon</th>
                    <th className="px-4 py-3 font-medium">Varlık</th>
                    <th className="px-4 py-3 font-medium">Detay</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-300 dark:divide-stone-700">
                  {rows.map((r) => {
                    const isOpen = expanded.has(r.id);
                    const name = r.user_id ? (staffNames.get(r.user_id) ?? null) : null;
                    const meta = formatMetadata(r.metadata);
                    return (
                      <tr key={r.id} className="align-top">
                        <td className="px-4 py-3 text-stone-700 dark:text-stone-300">
                          {formatDateTime(r.created_at)}
                        </td>
                        <td className="px-4 py-3">
                          {r.user_id ? (
                            <div>
                              <div className="text-stone-900 dark:text-stone-100">
                                {name ?? <span className="italic opacity-60">(bilinmiyor)</span>}
                              </div>
                              <div
                                className="font-mono text-xs text-stone-500 dark:text-stone-400"
                                title={r.user_id}
                              >
                                {r.user_id.slice(0, 8)}…
                              </div>
                            </div>
                          ) : (
                            <span className="text-stone-400 dark:text-stone-500">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            title={r.action}
                            className={cn(
                              'rounded px-2 py-0.5 text-xs font-medium',
                              r.action === 'DECRYPT'
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                                : 'bg-stone-200 text-stone-700 dark:bg-stone-700 dark:text-stone-200',
                            )}
                          >
                            {labelOr(ACTION_LABELS, r.action)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div
                            className="text-stone-900 dark:text-stone-100"
                            title={r.entity_type}
                          >
                            {labelOr(ENTITY_TYPE_LABELS, r.entity_type)}
                          </div>
                          {r.entity_id && (
                            <div
                              className="font-mono text-xs text-stone-500 dark:text-stone-400"
                              title={r.entity_id}
                            >
                              {r.entity_id.slice(0, 8)}…
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {meta ? (
                            <div>
                              <button
                                type="button"
                                onClick={() => toggleExpand(r.id)}
                                className="text-xs text-sky-700 hover:underline dark:text-sky-400"
                              >
                                {isOpen ? 'Gizle' : 'Göster'}
                              </button>
                              {isOpen && (
                                <pre className="mt-1 max-w-md overflow-x-auto whitespace-pre-wrap rounded bg-stone-50 px-2 py-1 font-mono text-xs text-stone-700 dark:bg-stone-800/60 dark:text-stone-200">
                                  {meta}
                                </pre>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-stone-400 dark:text-stone-500">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
