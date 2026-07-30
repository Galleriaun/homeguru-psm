import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { listReservations, type ReservationWithRefs } from '@/lib/queries/reservations';
import { listProperties } from '@/lib/queries/properties';
import { loadReservationsWithPayments } from '@/lib/queries/payments';
import { Card } from '@/components/ui/Card';
import { FinanceTabs } from './FinanceTabs';
import { formatTRY, formatDate } from '@/lib/utils';

interface Debtor {
  reservation: ReservationWithRefs;
  total: number;
  paid: number;
  outstanding: number;
}

/**
 * A debt belongs to Bornova when its mülk's region is 'bornova'; everything
 * else is Ana Grup ("Genel"). Region lives on the mülk and listReservations
 * doesn't embed it, so it's looked up by property_id.
 *
 * A reservation whose mülk was deleted (property_id NULL — the "bağı kopar"
 * path, migration 079) has no region left to read and therefore counts as
 * Genel. Module scope so the useMemo deps stay honest.
 */
function isBornovaDebt(
  r: ReservationWithRefs,
  regions: Map<string, string | null>,
): boolean {
  return (r.property_id ? regions.get(r.property_id) : null) === 'bornova';
}

/**
 * Borçlar — guests who still owe money. For every non-cancelled reservation we
 * compare the collected sum (active UNCONFIRMED + CONFIRMED payments) against
 * total_amount; any positive remainder is an outstanding debt (alacak). Rows
 * are sorted by the largest debt first so the desk can chase the big ones.
 *
 * Reuses listReservations + loadReservationsWithPayments (the same payment-sum
 * map that drives the reservation-card badge) — no extra query or migration.
 */
export function DebtorsPage() {
  const { profile } = useAuth();
  /**
   * Only a user who sees every region gets the toggle — mirrors Onaylar. Matched
   * on the RAW role on purpose: YONETICI_BORNOVA must NOT match, because RLS
   * already scopes them to Bornova and a toggle would offer them an always-empty
   * "Genel" tab.
   */
  const seesAllRegions =
    profile?.role === 'SUPER_ADMIN' || profile?.role === 'PROPERTY_MANAGER';
  const [regionFilter, setRegionFilter] = useState<'GENEL' | 'BORNOVA'>('GENEL');

  const [reservations, setReservations] = useState<ReservationWithRefs[] | null>(null);
  const [paidMap, setPaidMap] = useState<Map<string, number>>(() => new Map());
  /** Whether paidMap actually arrived — see the render guard below. */
  const [paidLoaded, setPaidLoaded] = useState(false);
  /** property_id → region, for the Genel / Bornova split. */
  const [propertyRegions, setPropertyRegions] = useState<Map<string, string | null>>(
    () => new Map(),
  );
  /** Whether propertyRegions actually arrived — see the render guard below. */
  const [regionsLoaded, setRegionsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listReservations()
      .then(setReservations)
      .catch((e) => setError(e?.message ?? 'Rezervasyonlar yüklenemedi'));
    // An empty paidMap is indistinguishable from "nobody has paid", which on
    // THIS page means every guest is listed as owing their full total. The
    // reservation list and calendar only risk a wrong badge and can tolerate a
    // silent failure; a debt ledger cannot — so this one is surfaced as an
    // error and gates the list via `ready`.
    loadReservationsWithPayments()
      .then((m) => {
        setPaidMap(m);
        setPaidLoaded(true);
      })
      .catch((e) => setError(e?.message ?? 'Ödemeler yüklenemedi'));
  }, []);

  useEffect(() => {
    // Regions only matter for a user who gets the toggle. Skipping the query for
    // a region-scoped user also stops them seeing an error about a filter their
    // screen never shows. ProtectedRoute guarantees `profile` is present before
    // this renders, so seesAllRegions is stable from the first pass — it stays
    // in the deps so this survives that ever changing.
    if (!seesAllRegions) return;
    // RLS-filtered, the same read the Mülkler list does. A failure is surfaced
    // rather than swallowed: without it every Bornova debt would silently fall
    // into Genel.
    listProperties()
      .then((ps) => {
        setPropertyRegions(new Map(ps.map((p) => [p.id, p.region])));
        setRegionsLoaded(true);
      })
      .catch((e) =>
        setError(e?.message ?? 'Mülkler yüklenemedi — bölge filtresi uygulanamıyor'),
      );
  }, [seesAllRegions]);

  const debtors = useMemo<Debtor[]>(() => {
    if (!reservations) return [];
    const rows: Debtor[] = [];
    for (const r of reservations) {
      if (r.status === 'cancelled') continue;
      const total = Number(r.total_amount);
      const paid = paidMap.get(r.id) ?? 0;
      const outstanding = total - paid;
      if (outstanding > 0.005) rows.push({ reservation: r, total, paid, outstanding });
    }
    return rows.sort((a, b) => b.outstanding - a.outstanding);
  }, [reservations, paidMap]);

  /** Per-region counts for the chip badges — computed BEFORE the filter. */
  const regionCounts = useMemo(() => {
    let bornova = 0;
    for (const d of debtors) if (isBornovaDebt(d.reservation, propertyRegions)) bornova += 1;
    return { GENEL: debtors.length - bornova, BORNOVA: bornova };
  }, [debtors, propertyRegions]);

  /** The rows actually shown. A region-scoped user gets their whole list. */
  const visibleDebtors = useMemo(() => {
    if (!seesAllRegions) return debtors;
    const wantBornova = regionFilter === 'BORNOVA';
    return debtors.filter(
      (d) => isBornovaDebt(d.reservation, propertyRegions) === wantBornova,
    );
  }, [debtors, propertyRegions, regionFilter, seesAllRegions]);

  // Toplam borç follows the visible list, so Genel and Bornova totals never mix.
  const totalDebt = useMemo(
    () => visibleDebtors.reduce((sum, d) => sum + d.outstanding, 0),
    [visibleDebtors],
  );

  /**
   * Nothing is shown until every input the numbers depend on has arrived.
   * Without paidLoaded the page would briefly bill every guest for their full
   * total; and an empty propertyRegions map is indistinguishable from
   * "everything is Genel", so for an all-regions user Bornova debts would flash
   * up under Genel on first paint.
   */
  const ready =
    Boolean(reservations) && paidLoaded && (!seesAllRegions || regionsLoaded);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
            Borçlar
          </h1>
          <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
            Ödemesi eksik kalan rezervasyonlar — en yüksek borç üstte.
          </p>
        </div>
        <FinanceTabs />
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40">
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </Card>
      )}

      {/* Region split — Genel (Ana Grup) vs Bornova, so the two never mix in
          the list or in Toplam borç. Same control as Onaylar. */}
      {seesAllRegions && (
        <div className="flex flex-wrap gap-2">
          {(['GENEL', 'BORNOVA'] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRegionFilter(r)}
              className={
                regionFilter === r
                  ? 'rounded-full bg-emerald-600 px-4 py-1 text-sm font-medium text-white'
                  : 'rounded-full border border-stone-300 px-4 py-1 text-sm text-stone-700 hover:bg-stone-100 dark:border-stone-600 dark:text-stone-300 dark:hover:bg-stone-800'
              }
            >
              {r === 'GENEL' ? 'Genel' : 'Bornova'}
              {regionCounts[r] > 0 && (
                <span
                  className={
                    'ml-1.5 rounded-full px-1.5 py-0.5 text-xs ' +
                    (regionFilter === r
                      ? 'bg-white/25 text-white'
                      : 'bg-stone-200 text-stone-700 dark:bg-stone-700 dark:text-stone-200')
                  }
                >
                  {regionCounts[r]}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {!ready && !error && (
        <p className="text-sm text-stone-600 dark:text-stone-300">Yükleniyor…</p>
      )}

      {ready && visibleDebtors.length === 0 && (
        <Card>
          <p className="text-center text-sm text-stone-600 dark:text-stone-300">
            {debtors.length > 0
              ? 'Bu bölgede borçlu rezervasyon yok.'
              : 'Borçlu rezervasyon yok — tüm ödemeler tamam.'}
          </p>
        </Card>
      )}

      {ready && visibleDebtors.length > 0 && (
        <>
          <Card className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-stone-700 dark:text-stone-300">
              <span className="block">Toplam borç</span>
              <span className="block text-xs font-normal text-stone-500 dark:text-stone-400">
                ({visibleDebtors.length} rezervasyon)
              </span>
            </span>
            <span className="shrink-0 whitespace-nowrap text-lg font-semibold text-red-700 dark:text-red-400">
              {formatTRY(totalDebt)}
            </span>
          </Card>

          <div className="space-y-2">
            {visibleDebtors.map((d) => (
              <Link
                key={d.reservation.id}
                to={`/reservations/${d.reservation.id}`}
                className="block rounded-lg border border-stone-200 bg-white p-3 transition-colors hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:hover:bg-stone-800/50"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-stone-900 dark:text-stone-100">
                      {d.reservation.guest?.full_name ?? '—'}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-stone-600 dark:text-stone-300">
                      {d.reservation.property?.name} · {d.reservation.unit?.name}
                    </p>
                    <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                      {formatDate(d.reservation.stay_start)} →{' '}
                      {formatDate(d.reservation.stay_end)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-red-700 dark:text-red-400">
                      Kalan {formatTRY(d.outstanding)}
                    </p>
                    <p className="mt-0.5 text-[11px] text-stone-500 dark:text-stone-400">
                      {formatTRY(d.paid)} / {formatTRY(d.total)}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
