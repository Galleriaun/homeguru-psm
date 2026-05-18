import { Fragment, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { can } from '@/lib/rbac';
import {
  listProperties,
  sortHotelsFirst,
  type Property,
} from '@/lib/queries/properties';
import { listAllUnits, type Unit } from '@/lib/queries/units';
import {
  listAllTasks,
  recordTaskStatus,
  latestPerUnit,
  DEFAULT_STATUS,
  type TaskWithRefs,
} from '@/lib/queries/housekeeping';
import { listOpenIssueCountsByUnit } from '@/lib/queries/housekeepingIssues';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { IssuesModal } from './IssuesModal';
import { cn, formatRoomType } from '@/lib/utils';
import type { HousekeepingStatus } from '@/types/database';

const STATUS_LABELS: Record<HousekeepingStatus, string> = {
  DIRTY: 'Kirli',
  IN_PROGRESS: 'Temizleniyor',
  CLEAN: 'Temiz',
};

// Inactive state: outlined; active state: filled. Each status gets a semantic color.
const STATUS_ACTIVE: Record<HousekeepingStatus, string> = {
  DIRTY: 'bg-red-600 text-white hover:bg-red-700',
  IN_PROGRESS: 'bg-amber-500 text-white hover:bg-amber-600',
  CLEAN: 'bg-emerald-600 text-white hover:bg-emerald-700',
};
const STATUS_INACTIVE =
  'border border-stone-300 text-stone-700 hover:bg-stone-100 dark:border-stone-600 dark:text-stone-300 dark:hover:bg-stone-800';

type FilterOption = 'ALL' | HousekeepingStatus;

const FILTER_LABELS: Record<FilterOption, string> = {
  ALL: 'Tümü',
  DIRTY: 'Kirli',
  IN_PROGRESS: 'Temizleniyor',
  CLEAN: 'Temiz',
};

export function HousekeepingPage() {
  const { profile, user } = useAuth();
  const [properties, setProperties] = useState<Property[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [tasks, setTasks] = useState<TaskWithRefs[]>([]);
  const [filter, setFilter] = useState<FilterOption>('ALL');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Per-unit "busy while saving" tracking so the right button stays interactive.
  const [savingUnitId, setSavingUnitId] = useState<string | null>(null);

  // Open-issues count per unit (for the alert badge on each card)
  const [openIssueCounts, setOpenIssueCounts] = useState<Map<string, number>>(
    () => new Map(),
  );
  const [issueModalUnit, setIssueModalUnit] = useState<Unit | null>(null);

  const canWrite = Boolean(profile && can(profile.role, 'housekeeping:write'));

  useEffect(() => {
    setLoading(true);
    Promise.all([
      listProperties(),
      listAllUnits(),
      listAllTasks(),
      listOpenIssueCountsByUnit(),
    ])
      .then(([p, u, t, ic]) => {
        setProperties(p);
        setUnits(u);
        setTasks(t);
        setOpenIssueCounts(ic);
      })
      .catch((e) => setError(e?.message ?? 'Yüklenemedi'))
      .finally(() => setLoading(false));
  }, []);

  // Called by IssuesModal after a create or resolve so the badge updates
  // without forcing a full page reload.
  const refreshIssueCounts = () => {
    listOpenIssueCountsByUnit()
      .then(setOpenIssueCounts)
      .catch(() => {
        // Non-fatal: badge stays stale until next full refresh.
      });
  };

  // Current status per unit (derived). Units without history default to DIRTY.
  const currentByUnit = useMemo(() => latestPerUnit(tasks), [tasks]);

  // Group units by property, hotel-first; sort units alphabetically within property.
  const grouped = useMemo(() => {
    const propsSorted = sortHotelsFirst(properties);
    return propsSorted.map((p) => ({
      property: p,
      units: units
        .filter((u) => u.property_id === p.id)
        .sort((a, b) => a.name.localeCompare(b.name, 'tr')),
    }));
  }, [properties, units]);

  const totalCount = units.length;
  const dirtyCount = units.filter(
    (u) => (currentByUnit.get(u.id)?.status ?? DEFAULT_STATUS) === 'DIRTY',
  ).length;
  const inProgressCount = units.filter(
    (u) => (currentByUnit.get(u.id)?.status ?? DEFAULT_STATUS) === 'IN_PROGRESS',
  ).length;
  const cleanCount = units.filter(
    (u) => (currentByUnit.get(u.id)?.status ?? DEFAULT_STATUS) === 'CLEAN',
  ).length;

  const matchesFilter = (unitId: string): boolean => {
    if (filter === 'ALL') return true;
    const status = currentByUnit.get(unitId)?.status ?? DEFAULT_STATUS;
    return status === filter;
  };

  const handleChangeStatus = async (
    unit: Unit,
    newStatus: HousekeepingStatus,
  ) => {
    if (!canWrite) return;
    const current = currentByUnit.get(unit.id)?.status ?? DEFAULT_STATUS;
    if (current === newStatus) return; // no-op

    setSavingUnitId(unit.id);
    setError(null);
    try {
      const created = await recordTaskStatus({
        property_id: unit.property_id,
        unit_id: unit.id,
        status: newStatus,
        updated_by: user?.id ?? null,
      });
      // Prepend so latestPerUnit picks it up first (newest-first order)
      setTasks((prev) => [
        {
          ...created,
          unit: { name: unit.name, room_type: unit.room_type, property_id: unit.property_id },
          property: properties.find((p) => p.id === unit.property_id)
            ? {
                name: properties.find((p) => p.id === unit.property_id)!.name,
                type: properties.find((p) => p.id === unit.property_id)!.type,
              }
            : null,
        },
        ...prev,
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Durum güncellenemedi');
    } finally {
      setSavingUnitId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
          Temizlik
        </h1>
        <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
          Mülk bazında oda / daire temizlik durumu
        </p>
      </div>

      {/* Status filter chips with counts */}
      <div className="flex flex-wrap gap-2">
        {(['ALL', 'DIRTY', 'IN_PROGRESS', 'CLEAN'] as const).map((f) => {
          const count =
            f === 'ALL'
              ? totalCount
              : f === 'DIRTY'
                ? dirtyCount
                : f === 'IN_PROGRESS'
                  ? inProgressCount
                  : cleanCount;
          const isActive = filter === f;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'rounded-full px-4 py-1 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                  : 'border border-stone-300 text-stone-700 hover:bg-stone-100 dark:border-stone-600 dark:text-stone-300 dark:hover:bg-stone-800',
              )}
            >
              {FILTER_LABELS[f]}{' '}
              <span className="ml-1 text-xs opacity-70">({count})</span>
            </button>
          );
        })}
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40">
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </Card>
      )}

      {loading && (
        <p className="text-sm text-stone-600 dark:text-stone-300">Yükleniyor…</p>
      )}

      {!loading && !error && totalCount === 0 && (
        <Card>
          <p className="text-center text-sm text-stone-600 dark:text-stone-300">
            Henüz birim eklenmemiş.
          </p>
        </Card>
      )}

      {issueModalUnit && user && (
        <IssuesModal
          unitId={issueModalUnit.id}
          unitName={issueModalUnit.name}
          propertyId={issueModalUnit.property_id}
          reportedByUserId={user.id}
          canWrite={canWrite}
          onClose={() => setIssueModalUnit(null)}
          onChange={refreshIssueCounts}
        />
      )}

      {!loading &&
        grouped.map((g) => {
          const visibleUnits = g.units.filter((u) => matchesFilter(u.id));
          if (visibleUnits.length === 0) return null;
          return (
            <Fragment key={g.property.id}>
              <section className="space-y-3">
                <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
                  {g.property.name}
                </h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {visibleUnits.map((unit) => {
                    const current =
                      currentByUnit.get(unit.id)?.status ?? DEFAULT_STATUS;
                    const isSaving = savingUnitId === unit.id;
                    const openIssues = openIssueCounts.get(unit.id) ?? 0;
                    return (
                      <Card key={unit.id} className="space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-base font-semibold text-stone-900 dark:text-stone-100">
                              {unit.name}
                            </p>
                            <p className="text-xs text-stone-600 dark:text-stone-300">
                              {formatRoomType(unit.room_type)}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {isSaving && (
                              <span className="text-xs text-stone-500">Kaydediliyor…</span>
                            )}
                            {openIssues > 0 && (
                              <span
                                title={`${openIssues} açık sorun`}
                                className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300"
                              >
                                ⚠ {openIssues}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Status buttons: current is filled, others are outlined */}
                        <div className="grid grid-cols-3 gap-2">
                          {(['DIRTY', 'IN_PROGRESS', 'CLEAN'] as const).map((s) => {
                            const isCurrent = s === current;
                            return (
                              <button
                                key={s}
                                type="button"
                                disabled={!canWrite || isSaving}
                                onClick={() => handleChangeStatus(unit, s)}
                                className={cn(
                                  'rounded-md px-2 py-2 text-xs font-medium transition-colors',
                                  isCurrent ? STATUS_ACTIVE[s] : STATUS_INACTIVE,
                                  (!canWrite || isSaving) && 'cursor-not-allowed opacity-60',
                                )}
                              >
                                {STATUS_LABELS[s]}
                              </button>
                            );
                          })}
                        </div>

                        <Button
                          variant="secondary"
                          size="sm"
                          className="w-full"
                          onClick={() => setIssueModalUnit(unit)}
                        >
                          Sorunlar
                          {openIssues > 0 && (
                            <span className="ml-1 text-xs text-red-600 dark:text-red-400">
                              ({openIssues})
                            </span>
                          )}
                        </Button>
                      </Card>
                    );
                  })}
                </div>
              </section>
            </Fragment>
          );
        })}
    </div>
  );
}
