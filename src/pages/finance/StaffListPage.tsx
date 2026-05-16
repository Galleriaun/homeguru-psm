import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listStaff, type StaffProfileWithProperty } from '@/lib/queries/staff';
import { Card } from '@/components/ui/Card';
import { FinanceTabs } from './FinanceTabs';
import { formatTRY, formatRole } from '@/lib/utils';

// Role is a classification, not a status — single neutral stone palette
// avoids implying that different roles are "better" or "worse".
const ROLE_BADGE = 'bg-stone-200 text-stone-700 dark:bg-stone-700 dark:text-stone-200';

export function StaffListPage() {
  const [staff, setStaff] = useState<StaffProfileWithProperty[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listStaff()
      .then(setStaff)
      .catch((e) => setError(e?.message ?? 'Personel yüklenemedi'));
  }, []);

  // Group by property; HOTEL groups first, then APARTMENT, then unassigned.
  const grouped = useMemo(() => {
    if (!staff) return [];
    const buckets = new Map<
      string,
      {
        key: string;
        label: string;
        propertyType: string; // 'HOTEL' | 'APARTMENT' | 'UNASSIGNED'
        items: StaffProfileWithProperty[];
      }
    >();
    for (const s of staff) {
      const key = s.property_id ?? '__unassigned__';
      const label = s.property?.name ?? 'Atanmamış';
      const propertyType = s.property?.type ?? (s.property_id ? 'APARTMENT' : 'UNASSIGNED');
      const existing = buckets.get(key);
      if (existing) existing.items.push(s);
      else buckets.set(key, { key, label, propertyType, items: [s] });
    }
    const typeOrder: Record<string, number> = { HOTEL: 0, APARTMENT: 1, UNASSIGNED: 2 };
    return Array.from(buckets.values()).sort((g1, g2) => {
      const t1 = typeOrder[g1.propertyType] ?? 1;
      const t2 = typeOrder[g2.propertyType] ?? 1;
      if (t1 !== t2) return t1 - t2;
      return g1.label.localeCompare(g2.label, 'tr');
    });
  }, [staff]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
            Personel
          </h1>
          <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
            Maaş bilgileri ve verilen avansların kaydı
          </p>
        </div>
        <FinanceTabs />
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40">
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </Card>
      )}

      {!staff && !error && (
        <p className="text-sm text-stone-600 dark:text-stone-300">Yükleniyor…</p>
      )}

      {staff && staff.length === 0 && (
        <Card>
          <p className="text-center text-sm text-stone-600 dark:text-stone-300">
            Henüz personel eklenmemiş.
          </p>
        </Card>
      )}

      {grouped.map((group) => (
        <Fragment key={group.key}>
          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
              {group.label}
            </h2>
            <Card className="p-0">
              <ul className="divide-y divide-stone-300 dark:divide-stone-700">
                {group.items.map((s) => (
                  <li key={s.user_id}>
                    <Link
                      to={`/finance/staff/${s.user_id}`}
                      className="flex items-center justify-between gap-4 px-6 py-3 transition-colors hover:bg-stone-50 dark:hover:bg-stone-800/50"
                    >
                      <div className="min-w-0">
                        <div className="text-base font-semibold text-stone-900 dark:text-stone-100">
                          {s.full_name}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2">
                          <span
                            className={`rounded px-2 py-0.5 text-xs font-medium ${ROLE_BADGE}`}
                          >
                            {formatRole(s.role)}
                          </span>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        {s.salary != null ? (
                          <>
                            <div className="text-xs uppercase tracking-wide text-stone-600 dark:text-stone-300">
                              Maaş
                            </div>
                            <div className="text-base font-semibold text-stone-900 dark:text-stone-100">
                              {formatTRY(Number(s.salary))}
                            </div>
                          </>
                        ) : (
                          <span className="text-xs italic text-stone-500 dark:text-stone-400">
                            maaş tanımsız
                          </span>
                        )}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        </Fragment>
      ))}
    </div>
  );
}
