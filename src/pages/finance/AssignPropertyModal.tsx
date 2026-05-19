import { useEffect, useState, type FormEvent } from 'react';
import { updateStaffProperty } from '@/lib/queries/staff';
import { listProperties, sortHotelsFirst, type Property } from '@/lib/queries/properties';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';

interface Props {
  staffUserId: string;
  staffName: string;
  currentPropertyId: string | null;
  onClose: () => void;
  /** Called with full property info (or nulls for unassigned) after a save. */
  onUpdated: (
    newPropertyId: string | null,
    newProperty: { name: string; type: string } | null,
  ) => void;
}

const UNASSIGNED = '__unassigned__';

export function AssignPropertyModal({
  staffUserId,
  staffName,
  currentPropertyId,
  onClose,
  onUpdated,
}: Props) {
  const [properties, setProperties] = useState<Property[] | null>(null);
  const [selectedId, setSelectedId] = useState<string>(currentPropertyId ?? UNASSIGNED);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [onClose]);

  useEffect(() => {
    listProperties()
      .then((data) => setProperties(sortHotelsFirst(data)))
      .catch((e) => setError(e instanceof Error ? e.message : 'Mülkler yüklenemedi'));
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const nextId = selectedId === UNASSIGNED ? null : selectedId;
    if (nextId === (currentPropertyId ?? null)) {
      // No-op
      onClose();
      return;
    }
    setSaving(true);
    try {
      await updateStaffProperty(staffUserId, nextId);
      const found = nextId ? properties?.find((p) => p.id === nextId) : null;
      const nextProperty = found ? { name: found.name, type: found.type } : null;
      onUpdated(nextId, nextProperty);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kaydedilemedi');
      setSaving(false);
    }
  };

  const options = [
    { value: UNASSIGNED, label: '(Atanmamış)' },
    ...(properties ?? []).map((p) => ({
      value: p.id,
      label: `${p.name} (${p.type === 'HOTEL' ? 'Otel' : 'Daire'})`,
    })),
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-16"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <Card className="w-full max-w-md">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
            Şube Ata
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-700"
            aria-label="Kapat"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path
                d="M5 5l10 10M15 5L5 15"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <p className="mb-4 text-sm text-stone-600 dark:text-stone-300">
          <strong className="text-stone-900 dark:text-stone-100">{staffName}</strong> hangi
          mülkte çalışacak? "Atanmamış" seçilirse personel veriyi göremez.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <Select
            label="Mülk"
            name="property"
            value={selectedId}
            onChange={setSelectedId}
            options={options}
            placeholder={properties === null ? 'Yükleniyor…' : undefined}
          />

          {error && (
            <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
              İptal
            </Button>
            <Button type="submit" loading={saving} disabled={properties === null}>
              Kaydet
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
