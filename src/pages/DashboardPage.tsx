import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { can } from '@/lib/rbac';
import { loadDashboardCounts, type DashboardCounts } from '@/lib/queries/dashboard';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/utils';

export function DashboardPage() {
  const { profile } = useAuth();

  const [counts, setCounts] = useState<DashboardCounts | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    loadDashboardCounts()
      .then(setCounts)
      .catch((e) => setError(e instanceof Error ? e.message : 'Veriler yüklenemedi'));
  }, []);

  if (!profile) {
    return <p className="text-sm text-stone-600 dark:text-stone-300">Yükleniyor…</p>;
  }

  const canReadFinance = can(profile.role, 'finance:read');
  const canReadHousekeeping = can(profile.role, 'housekeeping:read');
  const canCreateReservation = can(profile.role, 'reservation:create');
  const canCreateGuest = can(profile.role, 'guest:create');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
          Hoş geldin, {profile.full_name}
        </h1>
        <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
          Bugünün özeti ve hızlı işlemler
        </p>
      </div>

      {/* Today tiles */}
      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-600 dark:text-stone-300">
          Bugün
        </h2>
        {error && (
          <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40">
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          </Card>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Tile
            to="/reservations"
            label="Bugün Giriş"
            value={counts?.checkInsToday}
            accent="emerald"
          />
          <Tile
            to="/reservations"
            label="Bugün Çıkış"
            value={counts?.checkOutsToday}
            accent="sky"
          />
          <Tile
            to="/reservations/calendar"
            label="Şu An Aktif"
            value={counts?.activeNow}
            accent="stone"
          />
          {canReadFinance && (
            <Tile
              to="/finance/pending"
              label="Onay Bekleyen"
              value={counts?.pendingPayments}
              accent="amber"
              alert={(counts?.pendingPayments ?? 0) > 0}
            />
          )}
          {canReadHousekeeping && (
            <Tile
              to="/housekeeping"
              label="Açık Sorun"
              value={counts?.openIssues}
              accent="red"
              alert={(counts?.openIssues ?? 0) > 0}
            />
          )}
        </div>
      </section>

      {/* Quick actions */}
      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-600 dark:text-stone-300">
          Hızlı İşlemler
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {canCreateReservation && (
            <QuickAction
              to="/reservations/new"
              label="+ Yeni Rezervasyon"
              description="Müsait birim seçerek hızlıca rezervasyon oluştur"
              primary
            />
          )}
          <QuickAction
            to="/reservations/availability"
            label="Müsaitlik Ara"
            description="Tarih ve gece sayısına göre uygun birimleri bul"
          />
          {canCreateGuest && (
            <QuickAction
              to="/guests/new"
              label="+ Yeni Misafir"
              description="Misafir kaydı oluştur"
            />
          )}
          {canReadFinance && (
            <QuickAction
              to="/finance/pending"
              label="Tahsilat Onayları"
              description="Personel tarafından toplanan tahsilatları onayla"
            />
          )}
        </div>
      </section>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Tile — compact count card, tap to drill into the relevant page.
// -----------------------------------------------------------------------------

type Accent = 'emerald' | 'sky' | 'amber' | 'red' | 'stone';

const ACCENT_VALUE: Record<Accent, string> = {
  emerald: 'text-emerald-700 dark:text-emerald-400',
  sky: 'text-sky-700 dark:text-sky-400',
  amber: 'text-amber-700 dark:text-amber-400',
  red: 'text-red-700 dark:text-red-400',
  stone: 'text-stone-900 dark:text-stone-100',
};

interface TileProps {
  to: string;
  label: string;
  value: number | undefined;
  accent: Accent;
  /** Wraps the count in a soft glow if there's something needing attention. */
  alert?: boolean;
}

function Tile({ to, label, value, accent, alert }: TileProps) {
  return (
    <Link
      to={to}
      className={cn(
        'block rounded-lg border bg-white p-4 transition-shadow hover:shadow-md dark:bg-stone-900',
        alert
          ? 'border-current shadow-sm ' + ACCENT_VALUE[accent]
          : 'border-stone-200 dark:border-stone-700',
      )}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-stone-600 dark:text-stone-300">
        {label}
      </p>
      <p
        className={cn(
          'mt-1 text-3xl font-semibold tabular-nums',
          alert ? ACCENT_VALUE[accent] : ACCENT_VALUE[accent],
        )}
      >
        {value === undefined ? '…' : value}
      </p>
    </Link>
  );
}

// -----------------------------------------------------------------------------
// QuickAction — big primary button-like card. `primary` floods the brand colour.
// -----------------------------------------------------------------------------

interface QuickActionProps {
  to: string;
  label: string;
  description: ReactNode;
  primary?: boolean;
}

function QuickAction({ to, label, description, primary }: QuickActionProps) {
  return (
    <Link
      to={to}
      className={cn(
        'block rounded-lg border p-4 transition-colors',
        primary
          ? 'border-transparent bg-sky-700 text-white hover:bg-sky-800'
          : 'border-stone-200 bg-white text-stone-900 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-800/50',
      )}
    >
      <p className="text-base font-semibold">{label}</p>
      <p
        className={cn(
          'mt-1 text-xs',
          primary ? 'text-sky-100' : 'text-stone-600 dark:text-stone-300',
        )}
      >
        {description}
      </p>
    </Link>
  );
}
