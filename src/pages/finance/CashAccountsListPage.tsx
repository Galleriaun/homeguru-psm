import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { can } from '@/lib/rbac';
import {
  listCashAccounts,
  balancesByAccount,
  type CashAccountWithProperty,
} from '@/lib/queries/cashAccounts';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FinanceTabs } from './FinanceTabs';
import { formatTRY } from '@/lib/utils';
import type { AccountType } from '@/types/database';

const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  CASH: 'Nakit',
  BANK: 'Banka',
  CARD: 'Kredi Kartı',
};

// Account type is a classification, not a status — use a single neutral
// stone palette so colour doesn't suggest meaning that isn't there.
const ACCOUNT_TYPE_BADGE = 'bg-stone-200 text-stone-700 dark:bg-stone-700 dark:text-stone-200';

export function CashAccountsListPage() {
  const { profile } = useAuth();
  const [accounts, setAccounts] = useState<CashAccountWithProperty[] | null>(null);
  const [balances, setBalances] = useState<Map<string, number>>(() => new Map());
  const [error, setError] = useState<string | null>(null);

  const canWrite = profile && can(profile.role, 'finance:write');

  useEffect(() => {
    Promise.all([listCashAccounts(), balancesByAccount()])
      .then(([as, bs]) => {
        setAccounts(as);
        setBalances(bs);
      })
      .catch((e) => setError(e?.message ?? 'Kasalar yüklenemedi'));
  }, []);

  // Group by property; sort HOTEL groups before APARTMENT, alphabetical inside each type.
  const grouped = useMemo(() => {
    if (!accounts) return [];
    const buckets = new Map<
      string,
      {
        propertyId: string;
        propertyName: string;
        propertyType: string;
        items: CashAccountWithProperty[];
      }
    >();
    for (const a of accounts) {
      const key = a.property_id;
      const existing = buckets.get(key);
      if (existing) {
        existing.items.push(a);
      } else {
        buckets.set(key, {
          propertyId: key,
          propertyName: a.property?.name ?? '—',
          propertyType: a.property?.type ?? 'APARTMENT',
          items: [a],
        });
      }
    }
    return Array.from(buckets.values()).sort((g1, g2) => {
      if (g1.propertyType !== g2.propertyType) {
        return g1.propertyType === 'HOTEL' ? -1 : 1;
      }
      return g1.propertyName.localeCompare(g2.propertyName, 'tr');
    });
  }, [accounts]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
            Kasalar
          </h1>
          <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
            Mülk bazında nakit, banka ve kart hesaplarınız
          </p>
        </div>
        <div className="flex items-center gap-3">
          <FinanceTabs />
          {canWrite && (
            <Link to="/finance/cash/new">
              <Button>+ Yeni Kasa</Button>
            </Link>
          )}
        </div>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40">
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </Card>
      )}

      {!accounts && !error && (
        <p className="text-sm text-stone-600 dark:text-stone-300">Yükleniyor…</p>
      )}

      {accounts && accounts.length === 0 && (
        <Card>
          <p className="text-center text-sm text-stone-600 dark:text-stone-300">
            Henüz kasa eklenmemiş.
          </p>
        </Card>
      )}

      {grouped.map((group) => {
        const groupTotal = group.items.reduce(
          (sum, a) => sum + (balances.get(a.id) ?? 0),
          0,
        );
        return (
          <Fragment key={group.propertyId}>
            <section className="space-y-2">
              <div className="flex items-baseline justify-between">
                <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
                  {group.propertyName}
                </h2>
                <span className="text-sm text-stone-600 dark:text-stone-300">
                  Mülk toplam:{' '}
                  <strong className="text-stone-900 dark:text-stone-100">
                    {formatTRY(groupTotal)}
                  </strong>
                </span>
              </div>

              <Card className="p-0">
                <ul className="divide-y divide-stone-300 dark:divide-stone-700">
                  {group.items.map((a) => {
                    const balance = balances.get(a.id) ?? 0;
                    return (
                      <li key={a.id}>
                        <Link
                          to={`/finance/cash/${a.id}`}
                          className="flex items-center justify-between gap-4 px-6 py-3 transition-colors hover:bg-stone-50 dark:hover:bg-stone-800/50"
                        >
                          <div className="min-w-0">
                            <div className="text-base font-semibold text-stone-900 dark:text-stone-100">
                              {a.name}
                            </div>
                            <div className="mt-0.5 flex items-center gap-2">
                              <span
                                className={`rounded px-2 py-0.5 text-xs font-medium ${ACCOUNT_TYPE_BADGE}`}
                              >
                                {ACCOUNT_TYPE_LABEL[a.account_type]}
                              </span>
                              <span className="text-xs text-stone-600 dark:text-stone-300">
                                {a.currency}
                              </span>
                            </div>
                          </div>
                          <div
                            className={
                              balance >= 0
                                ? 'shrink-0 text-base font-semibold text-emerald-600 dark:text-emerald-400'
                                : 'shrink-0 text-base font-semibold text-red-600 dark:text-red-400'
                            }
                          >
                            {formatTRY(balance)}
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </section>
          </Fragment>
        );
      })}
    </div>
  );
}
