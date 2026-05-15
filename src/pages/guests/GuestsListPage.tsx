import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { can } from '@/lib/rbac';
import { listGuests, type GuestSummary } from '@/lib/queries/guests';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';

export function GuestsListPage() {
  const { profile } = useAuth();
  const [guests, setGuests] = useState<GuestSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    listGuests()
      .then(setGuests)
      .catch((e) => setError(e?.message ?? 'Misafirler yüklenemedi'));
  }, []);

  const canCreate = profile && can(profile.role, 'guest:create');

  const filtered = useMemo(() => {
    if (!guests) return [];
    const q = search.trim().toLowerCase();
    if (!q) return guests;
    return guests.filter(
      (g) =>
        g.full_name.toLowerCase().includes(q) ||
        (g.phone ?? '').toLowerCase().includes(q) ||
        (g.email ?? '').toLowerCase().includes(q),
    );
  }, [guests, search]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">Misafirler</h1>
          <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
            Kayıtlı misafirlerinizin listesi
          </p>
        </div>
        {canCreate && (
          <Link to="/guests/new">
            <Button>+ Yeni Misafir</Button>
          </Link>
        )}
      </div>

      <div className="max-w-md">
        <Input
          name="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Ad, telefon veya e-posta ile ara…"
        />
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40">
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </Card>
      )}

      {!guests && !error && (
        <p className="text-sm text-stone-600 dark:text-stone-300">Yükleniyor…</p>
      )}

      {guests && filtered.length === 0 && (
        <Card>
          <p className="text-center text-sm text-stone-600 dark:text-stone-300">
            {search ? 'Arama sonucu bulunamadı.' : 'Henüz misafir eklenmemiş.'}
          </p>
        </Card>
      )}

      {guests && filtered.length > 0 && (
        <Card className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-stone-300 text-xs uppercase text-stone-600 dark:border-stone-700 dark:text-stone-300">
                <tr>
                  <th className="px-6 py-3 font-medium">Ad Soyad</th>
                  <th className="px-6 py-3 font-medium">Telefon</th>
                  <th className="px-6 py-3 font-medium">E-posta</th>
                  <th className="px-6 py-3 font-medium">Uyruk</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-300 dark:divide-stone-700">
                {filtered.map((g) => (
                  <tr
                    key={g.id}
                    className="cursor-pointer transition-colors hover:bg-stone-50 dark:hover:bg-stone-800/50"
                  >
                    <td className="px-6 py-3 font-medium text-stone-900 dark:text-stone-100">
                      <Link to={`/guests/${g.id}`} className="block">
                        {g.full_name}
                      </Link>
                    </td>
                    <td className="px-6 py-3 text-stone-700 dark:text-stone-300">
                      {g.phone ?? '—'}
                    </td>
                    <td className="px-6 py-3 text-stone-700 dark:text-stone-300">
                      {g.email ?? '—'}
                    </td>
                    <td className="px-6 py-3 text-stone-700 dark:text-stone-300">
                      {g.nationality ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
