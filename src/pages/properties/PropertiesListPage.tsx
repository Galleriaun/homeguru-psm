import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { can } from '@/lib/rbac';
import { listProperties, type Property } from '@/lib/queries/properties';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { propertyPhotoUrl } from '@/lib/photos';

export function PropertiesListPage() {
  const { profile } = useAuth();
  const [properties, setProperties] = useState<Property[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'ALL' | 'HOTEL' | 'APARTMENT'>('ALL');

  useEffect(() => {
    listProperties()
      .then(setProperties)
      .catch((e) => setError(e.message ?? 'Mülkler yüklenemedi'));
  }, []);

  const canCreate = profile && can(profile.role, 'admin:*');
  const filtered = (properties?.filter((p) => filter === 'ALL' || p.type === filter) ?? [])
    // On "Tümü", show hotels first; within each type, preserve oldest-first order
    .sort((a, b) => {
      if (filter === 'ALL' && a.type !== b.type) {
        return a.type === 'HOTEL' ? -1 : 1;
      }
      return 0;
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">Mülkler</h1>
          <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
            Otel ve dairelerinizin listesi
          </p>
        </div>
        {canCreate && (
          <Link to="/properties/new" className="shrink-0">
            <Button>+ Yeni Mülk</Button>
          </Link>
        )}
      </div>

      {/* Filter chips */}
      <div className="flex gap-2">
        {(['ALL', 'HOTEL', 'APARTMENT'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={
              filter === f
                ? 'rounded-full bg-emerald-600 px-4 py-1 text-sm font-medium text-white'
                : 'rounded-full border border-stone-300 px-4 py-1 text-sm text-stone-700 hover:bg-stone-100 dark:border-stone-600 dark:text-stone-300 dark:hover:bg-stone-800'
            }
          >
            {f === 'ALL' ? 'Tümü' : f === 'HOTEL' ? 'Oteller' : 'Daireler'}
          </button>
        ))}
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40">
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </Card>
      )}

      {!properties && !error && (
        <p className="text-sm text-stone-600 dark:text-stone-300">Yükleniyor…</p>
      )}

      {properties && filtered.length === 0 && (
        <Card>
          <p className="text-center text-sm text-stone-600 dark:text-stone-300">
            Henüz mülk eklenmemiş.
          </p>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((p) => {
          const thumb = p.photo_paths?.[0];
          return (
            <Link key={p.id} to={`/properties/${p.id}`} className="block">
              <Card className="overflow-hidden transition-shadow hover:shadow-md">
                {/* Thumbnail (first photo). Negative margins break out of Card's p-6 padding. */}
                <div className="-mx-6 -mt-6 mb-4 aspect-[16/9] overflow-hidden bg-stone-100 dark:bg-stone-800">
                  {thumb ? (
                    <img
                      src={propertyPhotoUrl(thumb)}
                      alt={`${p.name} kapak fotoğrafı`}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-stone-400 dark:text-stone-500">
                      Fotoğraf yok
                    </div>
                  )}
                </div>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-semibold text-stone-900 dark:text-stone-100">
                      {p.name}
                    </h3>
                    {p.address && (
                      <p className="mt-1 truncate text-xs text-stone-600 dark:text-stone-300">
                        {p.address}
                      </p>
                    )}
                  </div>
                  <span
                    className={
                      p.type === 'HOTEL'
                        ? 'rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                        : 'rounded bg-stone-200 px-2 py-0.5 text-xs font-medium text-stone-700 dark:bg-stone-700 dark:text-stone-200'
                    }
                  >
                    {p.type === 'HOTEL' ? 'Otel' : 'Daire'}
                  </span>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
