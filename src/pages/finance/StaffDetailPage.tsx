import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import {
  getStaff,
  listAdvancesForStaff,
  totalAdvancesInMonth,
  type StaffAdvance,
  type StaffProfileWithProperty,
} from '@/lib/queries/staff';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { StaffAdvanceModal } from './StaffAdvanceModal';
import { EditSalaryModal } from './EditSalaryModal';
import { formatDate, formatTRY, formatRole } from '@/lib/utils';

const timeFmt = new Intl.DateTimeFormat('tr-TR', {
  timeZone: 'Europe/Istanbul',
  timeStyle: 'short',
});
function formatTime(iso: string): string {
  return timeFmt.format(new Date(iso));
}

function currentIstanbulYearMonth(): string {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
  });
  const parts = fmt.formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value ?? '0000';
  const m = parts.find((p) => p.type === 'month')?.value ?? '00';
  return `${y}-${m}`;
}

function monthLabel(yearMonth: string): string {
  // 'YYYY-MM' → 'Mayıs 2026'
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) return yearMonth;
  const [y, m] = yearMonth.split('-');
  const d = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(d);
}

export function StaffDetailPage() {
  const { userId } = useParams<{ userId: string }>();
  const { user, profile } = useAuth();

  const [staff, setStaff] = useState<StaffProfileWithProperty | null>(null);
  const [advances, setAdvances] = useState<StaffAdvance[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanceModal, setShowAdvanceModal] = useState(false);
  const [showEditSalary, setShowEditSalary] = useState(false);

  // RLS (staff_profiles_modify) limits salary edits to SUPER_ADMIN.
  const canEditSalary = profile?.role === 'SUPER_ADMIN';

  const currentMonth = currentIstanbulYearMonth();

  useEffect(() => {
    if (!userId) return;
    setError(null);
    (async () => {
      try {
        const s = await getStaff(userId);
        if (!s) {
          setError('Personel bulunamadı');
          return;
        }
        setStaff(s);
        const ads = await listAdvancesForStaff(userId);
        setAdvances(ads);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Yüklenemedi');
      }
    })();
  }, [userId]);

  if (error) {
    return (
      <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40">
        <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        <Link
          to="/finance/staff"
          className="mt-3 inline-block text-sm text-emerald-600 hover:underline dark:text-emerald-500"
        >
          ← Personel listesine dön
        </Link>
      </Card>
    );
  }

  if (!staff) {
    return <p className="text-sm text-stone-600 dark:text-stone-300">Yükleniyor…</p>;
  }

  const salary = staff.salary != null ? Number(staff.salary) : null;
  const monthAdvances = totalAdvancesInMonth(advances, currentMonth);
  const remaining = salary != null ? salary - monthAdvances : null;

  // Color the remaining figure: negative = over-advanced (red)
  const remainingClass =
    remaining == null
      ? ''
      : remaining < 0
        ? 'text-red-600 dark:text-red-400'
        : 'text-emerald-600 dark:text-emerald-400';

  return (
    <div className="space-y-6">
      <Link
        to="/finance/staff"
        className="inline-block text-sm text-emerald-600 hover:underline dark:text-emerald-500"
      >
        ← Personel
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
            {staff.full_name}
          </h1>
          <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
            {formatRole(staff.role)}
            {staff.property?.name ? ` · ${staff.property.name}` : ''}
            {staff.hire_date ? ` · İşe giriş: ${formatDate(staff.hire_date)}` : ''}
          </p>
        </div>
        <Button onClick={() => setShowAdvanceModal(true)}>+ Avans Ver</Button>
      </div>

      <Card>
        <p className="text-xs uppercase tracking-wide text-stone-600 dark:text-stone-300">
          {monthLabel(currentMonth)}
        </p>
        <div className="mt-2 grid gap-4 sm:grid-cols-3">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-xs text-stone-600 dark:text-stone-300">Maaş</p>
              {canEditSalary && (
                <button
                  type="button"
                  onClick={() => setShowEditSalary(true)}
                  className="rounded px-2 py-0.5 text-sm font-medium text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/30"
                >
                  Düzenle
                </button>
              )}
            </div>
            <p className="mt-0.5 text-lg font-semibold text-stone-900 dark:text-stone-100">
              {salary != null ? formatTRY(salary) : '—'}
            </p>
          </div>
          <div>
            <p className="text-xs text-stone-600 dark:text-stone-300">Bu ay verilen avans</p>
            <p className="mt-0.5 text-lg font-semibold text-amber-600 dark:text-amber-400">
              {formatTRY(monthAdvances)}
            </p>
          </div>
          <div>
            <p className="text-xs text-stone-600 dark:text-stone-300">Kalan</p>
            <p className={`mt-0.5 text-lg font-semibold ${remainingClass}`}>
              {remaining != null ? formatTRY(remaining) : '—'}
            </p>
          </div>
        </div>
        {salary == null && (
          <p className="mt-3 text-xs italic text-stone-500 dark:text-stone-400">
            Bu personel için maaş tanımlanmamış. Maaş bilgisi staff_profiles üzerinden eklenmelidir.
          </p>
        )}
      </Card>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
          Avans Geçmişi
        </h2>
        {advances.length === 0 ? (
          <Card>
            <p className="text-center text-sm text-stone-600 dark:text-stone-300">
              Henüz avans kaydı yok.
            </p>
          </Card>
        ) : (
          <>
            {/* Mobile: stacked cards */}
            <div className="space-y-2 sm:hidden">
              {advances.map((a) => (
                <div
                  key={a.id}
                  className="rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-900"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-stone-600 dark:text-stone-300">
                        {formatDate(a.given_at)} · {formatTime(a.given_at)}
                      </p>
                      <p className="mt-0.5 break-words text-sm text-stone-700 dark:text-stone-300">
                        {a.note || '—'}
                      </p>
                    </div>
                    <p className="shrink-0 font-semibold text-amber-600 dark:text-amber-400">
                      {formatTRY(Number(a.amount))}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* Tablet+ : table */}
            <Card className="hidden p-0 sm:block">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-stone-300 text-xs uppercase text-stone-600 dark:border-stone-700 dark:text-stone-300">
                    <tr>
                      <th className="px-6 py-3 font-medium">Tarih</th>
                      <th className="px-6 py-3 font-medium">Açıklama</th>
                      <th className="px-6 py-3 text-right font-medium">Tutar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-300 dark:divide-stone-700">
                    {advances.map((a) => (
                      <tr key={a.id}>
                        <td className="px-6 py-3 text-stone-700 dark:text-stone-300">
                          <div>{formatDate(a.given_at)}</div>
                          <div className="text-xs text-stone-600 dark:text-stone-300">
                            {formatTime(a.given_at)}
                          </div>
                        </td>
                        <td className="px-6 py-3 text-stone-700 dark:text-stone-300">
                          {a.note || '—'}
                        </td>
                        <td className="px-6 py-3 text-right font-semibold text-amber-600 dark:text-amber-400">
                          {formatTRY(Number(a.amount))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </section>

      {showAdvanceModal && user && (
        <StaffAdvanceModal
          staffUserId={staff.user_id}
          createdByUserId={user.id}
          onClose={() => setShowAdvanceModal(false)}
          onCreated={(advance) => {
            setAdvances((prev) => [advance, ...prev]);
            setShowAdvanceModal(false);
          }}
        />
      )}

      {showEditSalary && (
        <EditSalaryModal
          staffUserId={staff.user_id}
          staffName={staff.full_name}
          currentSalary={salary}
          onClose={() => setShowEditSalary(false)}
          onUpdated={(newSalary) => {
            setStaff((prev) => (prev ? { ...prev, salary: newSalary } : prev));
            setShowEditSalary(false);
          }}
        />
      )}
    </div>
  );
}
