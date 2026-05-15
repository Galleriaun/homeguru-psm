import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { can } from '@/lib/rbac';
import { getProperty, deleteProperty, type Property } from '@/lib/queries/properties';
import { listUnitsForProperty, deleteUnit, type Unit } from '@/lib/queries/units';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { formatTRY, formatRoomType } from '@/lib/utils';

export function PropertyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [property, setProperty] = useState<Property | null>(null);
  const [units, setUnits] = useState<Unit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteProperty, setConfirmDeleteProperty] = useState(false);
  const [unitToDelete, setUnitToDelete] = useState<Unit | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    setError(null);
    Promise.all([getProperty(id), listUnitsForProperty(id)])
      .then(([p, u]) => {
        if (!p) {
          setError('Mülk bulunamadı');
          return;
        }
        setProperty(p);
        setUnits(u);
      })
      .catch((e) => setError(e.message ?? 'Yüklenemedi'));
  }, [id]);

  if (error) {
    return (
      <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40">
        <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        <Link to="/properties" className="mt-3 inline-block text-sm text-emerald-600 hover:underline dark:text-emerald-500">
          ← Mülklere dön
        </Link>
      </Card>
    );
  }

  if (!property || !units) {
    return <p className="text-sm text-stone-600 dark:text-stone-300">Yükleniyor…</p>;
  }

  const isAdmin = profile && can(profile.role, 'admin:*');
  const canManageProperty = isAdmin;
  const canManageUnits = profile && (isAdmin || profile.role === 'PROPERTY_MANAGER');
  const isApartmentFull = property.type === 'APARTMENT' && units.length >= 1;

  const handleDeleteProperty = async () => {
    if (!id) return;
    setBusy(true);
    try {
      await deleteProperty(id);
      navigate('/properties', { replace: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Silme başarısız';
      setError(msg);
      setBusy(false);
      setConfirmDeleteProperty(false);
    }
  };

  const handleDeleteUnit = async () => {
    if (!unitToDelete) return;
    setBusy(true);
    try {
      await deleteUnit(unitToDelete.id);
      setUnits((prev) => prev?.filter((u) => u.id !== unitToDelete.id) ?? null);
      setUnitToDelete(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Silme başarısız';
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <Link
        to="/properties"
        className="inline-block text-sm text-emerald-600 hover:underline dark:text-emerald-500"
      >
        ← Mülkler
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
            {property.name}
          </h1>
          <div className="mt-2 flex items-center gap-2">
            <span
              className={
                property.type === 'HOTEL'
                  ? 'rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                  : 'rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
              }
            >
              {property.type === 'HOTEL' ? 'Otel' : 'Daire'}
            </span>
            {property.address && (
              <span className="text-sm text-stone-600 dark:text-stone-300">{property.address}</span>
            )}
          </div>
        </div>
        {canManageProperty && (
          <div className="flex gap-2">
            <Link to={`/properties/${property.id}/edit`}>
              <Button variant="secondary" size="sm">
                Düzenle
              </Button>
            </Link>
            <Button variant="danger" size="sm" onClick={() => setConfirmDeleteProperty(true)}>
              Sil
            </Button>
          </div>
        )}
      </div>

      {/* Units */}
      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
            Birimler ({units.length})
          </h2>
          {canManageUnits && !isApartmentFull && (
            <Link to={`/properties/${property.id}/units/new`}>
              <Button size="sm">+ Yeni Birim</Button>
            </Link>
          )}
        </div>

        {isApartmentFull && (
          <p className="mb-3 rounded bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
            Daire tipi mülkler yalnızca tek birim içerebilir.
          </p>
        )}

        {units.length === 0 ? (
          <p className="py-4 text-center text-sm text-stone-600 dark:text-stone-300">
            Henüz birim eklenmemiş.
          </p>
        ) : (
          <div className="-mx-6 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-stone-200 text-xs uppercase text-stone-600 dark:border-stone-700 dark:text-stone-300">
                <tr>
                  <th className="px-6 py-2 font-medium">Ad</th>
                  <th className="px-6 py-2 font-medium">Tip</th>
                  <th className="px-6 py-2 font-medium">Kapasite</th>
                  <th className="px-6 py-2 font-medium">Gecelik Ücret</th>
                  {canManageUnits && <th className="px-6 py-2"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200 dark:divide-stone-700">
                {units.map((u) => (
                  <tr key={u.id}>
                    <td className="px-6 py-3 font-medium text-stone-900 dark:text-stone-100">
                      {u.name}
                    </td>
                    <td className="px-6 py-3 text-stone-700 dark:text-stone-300">
                      {formatRoomType(u.room_type)}
                    </td>
                    <td className="px-6 py-3 text-stone-700 dark:text-stone-300">
                      {u.capacity} kişi
                    </td>
                    <td className="px-6 py-3 text-stone-700 dark:text-stone-300">
                      {formatTRY(u.base_price)}
                    </td>
                    {canManageUnits && (
                      <td className="px-6 py-3 text-right">
                        <div className="flex justify-end gap-1">
                          <Link to={`/properties/${property.id}/units/${u.id}/edit`}>
                            <Button variant="ghost" size="sm">
                              Düzenle
                            </Button>
                          </Link>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                            onClick={() => setUnitToDelete(u)}
                          >
                            Sil
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Confirm delete property */}
      <ConfirmDialog
        open={confirmDeleteProperty}
        title={`"${property.name}" silinsin mi?`}
        description={
          <>
            <p>Bu işlem geri alınamaz. Mülke bağlı tüm birimler de silinir.</p>
            <p className="mt-2 font-medium">
              Not: Aktif rezervasyonu olan mülkler silinemez.
            </p>
          </>
        }
        confirmLabel="Sil"
        destructive
        loading={busy}
        onConfirm={handleDeleteProperty}
        onCancel={() => setConfirmDeleteProperty(false)}
      />

      {/* Confirm delete unit */}
      <ConfirmDialog
        open={!!unitToDelete}
        title={unitToDelete ? `"${unitToDelete.name}" silinsin mi?` : ''}
        description="Bu işlem geri alınamaz."
        confirmLabel="Sil"
        destructive
        loading={busy}
        onConfirm={handleDeleteUnit}
        onCancel={() => setUnitToDelete(null)}
      />
    </div>
  );
}
