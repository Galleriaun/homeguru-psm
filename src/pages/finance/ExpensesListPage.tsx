import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import {
  listExpenses,
  totalAmount,
  EXPENSE_CATEGORIES,
  type ExpenseWithProperty,
} from '@/lib/queries/expenses';
import { listProperties, sortHotelsFirst, type Property } from '@/lib/queries/properties';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { FinanceTabs } from './FinanceTabs';
import { formatTRY, formatDate } from '@/lib/utils';
import { exportRowsToCsv } from '@/lib/csvExport';
import { loadStaffDirectory } from '@/lib/queries/staff_directory';

function currentMonthStr(): string {
  // YYYY-MM in local time
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function ExpensesListPage() {
  const { profile } = useAuth();

  const [properties, setProperties] = useState<Property[]>([]);
  /** Gider tipi: GENEL (property_id null) or MULK (property-tied). */
  const [expenseType, setExpenseType] = useState<'GENEL' | 'MULK'>('MULK');
  const [propertyId, setPropertyId] = useState(''); // '' = all mülkler (within MULK)
  const [month, setMonth] = useState(currentMonthStr());
  const [category, setCategory] = useState(''); // '' = all

  const [expenses, setExpenses] = useState<ExpenseWithProperty[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [staffMap, setStaffMap] = useState<Map<string, string>>(() => new Map());

  // YETKILI may *submit* a gider (queues pending), but doesn't have
  // finance:write for edits. Surface the "+ Yeni Gider" button for them too.
  const canCreateExpense =
    profile?.role === 'SUPER_ADMIN' ||
    profile?.role === 'PROPERTY_MANAGER' ||
    profile?.role === 'YETKILI';

  // Load properties + staff directory once
  useEffect(() => {
    listProperties()
      .then(setProperties)
      .catch((e) => setError(e?.message ?? 'Mülkler yüklenemedi'));
    loadStaffDirectory().then(setStaffMap).catch(() => {});
  }, []);

  // Refetch whenever filters change
  useEffect(() => {
    setError(null);
    setExpenses(null);
    listExpenses({
      propertyId: expenseType === 'MULK' && propertyId ? propertyId : undefined,
      genelOnly: expenseType === 'GENEL',
      mulkOnly: expenseType === 'MULK' && !propertyId,
      month: month || undefined,
      category: category || undefined,
    })
      .then(setExpenses)
      .catch((e) => setError(e?.message ?? 'Giderler yüklenemedi'));
  }, [expenseType, propertyId, month, category]);

  const giderTipiOptions = [
    { value: 'GENEL', label: 'Genel' },
    { value: 'MULK', label: 'Mülk' },
  ];

  const propertyOptions = useMemo(
    () => [
      { value: '', label: 'Tüm mülkler' },
      ...sortHotelsFirst(properties).map((p) => ({ value: p.id, label: p.name })),
    ],
    [properties],
  );

  const categoryOptions = useMemo(
    () => [
      { value: '', label: 'Tüm kategoriler' },
      ...EXPENSE_CATEGORIES.map((c) => ({ value: c, label: c })),
    ],
    [],
  );

  // Render Ay as a Select (matches Mülk + Kategori). Native <input type="month">
  // looked over-tall on iOS Safari. Show last 24 months newest-first.
  const monthOptions = useMemo(() => {
    const monthFmt = new Intl.DateTimeFormat('tr-TR', {
      month: 'long',
      year: 'numeric',
    });
    const now = new Date();
    const out: { value: string; label: string }[] = [];
    for (let i = 0; i < 24; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      out.push({ value: `${y}-${m}`, label: monthFmt.format(d) });
    }
    return out;
  }, []);

  const total = expenses ? totalAmount(expenses) : 0;

  // Split into Genel (no property) vs Mülk (tied to a property) so the list
  // can render two stacked sections with their own subtotals. The user-facing
  // contract: Genel first at the top, Mülk giderleri underneath.
  const genelExpenses = useMemo(
    () => expenses?.filter((e) => e.property_id === null) ?? [],
    [expenses],
  );
  const mulkExpenses = useMemo(
    () => expenses?.filter((e) => e.property_id !== null) ?? [],
    [expenses],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
            Giderler
          </h1>
          <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
            Mülk bazında işletme giderlerinizin kaydı
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <FinanceTabs />
          {canCreateExpense && (
            <Link to="/finance/expenses/new">
              <Button>+ Yeni Gider</Button>
            </Link>
          )}
        </div>
      </div>

      <Card>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select
            label="Gider Tipi"
            name="filter_expense_type"
            value={expenseType}
            onChange={(v) => setExpenseType(v as 'GENEL' | 'MULK')}
            options={giderTipiOptions}
          />
          {expenseType === 'MULK' && (
            <Select
              label="Mülk"
              name="filter_property"
              value={propertyId}
              onChange={setPropertyId}
              options={propertyOptions}
            />
          )}
          <Select
            label="Ay"
            name="filter_month"
            value={month}
            onChange={setMonth}
            options={monthOptions}
          />
          <Select
            label="Kategori"
            name="filter_category"
            value={category}
            onChange={setCategory}
            options={categoryOptions}
          />
        </div>
      </Card>

      {error && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40">
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </Card>
      )}

      {!error && expenses === null && (
        <p className="text-sm text-stone-600 dark:text-stone-300">Yükleniyor…</p>
      )}

      {expenses && expenses.length === 0 && (
        <Card>
          <p className="text-center text-sm text-stone-600 dark:text-stone-300">
            Bu kriterlerle kayıt bulunamadı.
          </p>
        </Card>
      )}

      {expenses && expenses.length > 0 && (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm text-stone-600 dark:text-stone-300">
              {expenses.length} kayıt
            </p>
            <div className="flex items-baseline gap-3">
              <p className="text-sm">
                <span className="text-stone-600 dark:text-stone-300">Toplam: </span>
                <strong className="text-lg text-stone-900 dark:text-stone-100">
                  {formatTRY(total)}
                </strong>
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const rows = expenses.map((e) => ({
                    Tarih: formatDate(e.expense_date),
                    Mülk: e.property?.name ?? 'Genel',
                    Kategori: e.category,
                    Düzenli: e.is_recurring ? 'Evet' : 'Hayır',
                    Tutar: Number(e.amount).toFixed(2),
                    Açıklama: e.description ?? '',
                  }));
                  const parts = [
                    'giderler',
                    expenseType === 'GENEL' ? 'genel' : null,
                    expenseType === 'MULK' && propertyId
                      ? properties.find((p) => p.id === propertyId)?.name
                      : null,
                    month || null,
                    category || null,
                  ]
                    .filter(Boolean)
                    .join('-');
                  exportRowsToCsv(parts, rows, [
                    { key: 'Tarih', label: 'Tarih' },
                    { key: 'Mülk', label: 'Mülk' },
                    { key: 'Kategori', label: 'Kategori' },
                    { key: 'Düzenli', label: 'Düzenli' },
                    { key: 'Tutar', label: 'Tutar (TRY)' },
                    { key: 'Açıklama', label: 'Açıklama' },
                  ]);
                }}
              >
                CSV İndir
              </Button>
            </div>
          </div>

          {/* Genel giderler — property_id IS NULL. Always renders first. */}
          {genelExpenses.length > 0 && (
            <ExpenseSection
              title="Genel Giderler"
              items={genelExpenses}
              subtotal={totalAmount(genelExpenses)}
              staffMap={staffMap}
            />
          )}

          {/* Mülk giderleri — tied to a property. Renders below. */}
          {mulkExpenses.length > 0 && (
            <ExpenseSection
              title="Mülk Giderleri"
              items={mulkExpenses}
              subtotal={totalAmount(mulkExpenses)}
              staffMap={staffMap}
            />
          )}
        </>
      )}
    </div>
  );
}

/**
 * One titled block of expense rows + its own subtotal. Pulled out so the
 * Genel / Mülk split renders without duplicating the mobile-card-vs-table
 * markup. Each row remains a tap-target linking to the edit page.
 */
function ExpenseSection({
  title,
  items,
  subtotal,
  staffMap,
}: {
  title: string;
  items: ExpenseWithProperty[];
  subtotal: number;
  staffMap: Map<string, string>;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-600 dark:text-stone-300">
          {title}{' '}
          <span className="ml-1 text-xs font-normal text-stone-500 dark:text-stone-400">
            ({items.length})
          </span>
        </h2>
        <p className="text-sm">
          <strong className="text-stone-900 dark:text-stone-100">
            {formatTRY(subtotal)}
          </strong>
        </p>
      </div>

      {/* Mobile: stacked cards */}
      <div className="space-y-2 sm:hidden">
        {items.map((e) => (
          <Link
            key={e.id}
            to={`/finance/expenses/${e.id}/edit`}
            className="block rounded-lg border border-stone-200 bg-white p-3 transition-colors hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:hover:bg-stone-800/50"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded bg-stone-200 px-2 py-0.5 text-xs font-medium text-stone-700 dark:bg-stone-700 dark:text-stone-200">
                    {e.category}
                  </span>
                  {e.is_recurring && (
                    <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                      Düzenli
                    </span>
                  )}
                  <span className="text-xs text-stone-600 dark:text-stone-300">
                    {formatDate(e.expense_date)}
                  </span>
                </div>
                <p className="mt-1 truncate text-sm text-stone-700 dark:text-stone-300">
                  {e.property?.name ?? 'Genel'}
                </p>
                {e.description && (
                  <p className="mt-0.5 truncate text-xs text-stone-500 dark:text-stone-400">
                    {e.description}
                  </p>
                )}
                {e.created_by && staffMap.get(e.created_by) && (
                  <p className="mt-0.5 text-[11px] text-stone-500 dark:text-stone-400">
                    Oluşturan: {staffMap.get(e.created_by)}
                  </p>
                )}
              </div>
              <p className="shrink-0 font-semibold text-stone-900 dark:text-stone-100">
                {formatTRY(Number(e.amount))}
              </p>
            </div>
          </Link>
        ))}
      </div>

      {/* Tablet+ : table */}
      <Card className="hidden p-0 sm:block">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-stone-300 text-xs uppercase text-stone-600 dark:border-stone-700 dark:text-stone-300">
              <tr>
                <th className="px-6 py-3 font-medium">Tarih</th>
                <th className="px-6 py-3 font-medium">Mülk</th>
                <th className="px-6 py-3 font-medium">Kategori</th>
                <th className="px-6 py-3 font-medium">Açıklama</th>
                <th className="px-6 py-3 text-right font-medium">Tutar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-300 dark:divide-stone-700">
              {items.map((e) => (
                <tr
                  key={e.id}
                  className="cursor-pointer transition-colors hover:bg-stone-50 dark:hover:bg-stone-800/50"
                >
                  <td className="px-6 py-3 text-stone-700 dark:text-stone-300">
                    <Link to={`/finance/expenses/${e.id}/edit`} className="block">
                      {formatDate(e.expense_date)}
                    </Link>
                  </td>
                  <td className="px-6 py-3 text-stone-700 dark:text-stone-300">
                    {e.property?.name ?? 'Genel'}
                  </td>
                  <td className="px-6 py-3">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="rounded bg-stone-200 px-2 py-0.5 text-xs font-medium text-stone-700 dark:bg-stone-700 dark:text-stone-200">
                        {e.category}
                      </span>
                      {e.is_recurring && (
                        <span
                          title="Düzenli (örn. her ay)"
                          className="rounded bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                        >
                          Düzenli
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-stone-700 dark:text-stone-300">
                    <div>{e.description || '—'}</div>
                    {e.created_by && staffMap.get(e.created_by) && (
                      <div className="text-xs text-stone-500 dark:text-stone-400">
                        Oluşturan: {staffMap.get(e.created_by)}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-3 text-right font-semibold text-stone-900 dark:text-stone-100">
                    {formatTRY(Number(e.amount))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </section>
  );
}
