import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import {
  getProperty,
  createProperty,
  updateProperty,
} from '@/lib/queries/properties';
import type { PropertyType } from '@/types/database';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';

export function PropertyFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [type, setType] = useState<PropertyType>('HOTEL');
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isEdit || !id) return;
    getProperty(id)
      .then((p) => {
        if (!p) {
          setError('Mülk bulunamadı');
          return;
        }
        setName(p.name);
        setType(p.type);
        setAddress(p.address ?? '');
      })
      .catch((e) => setError(e.message ?? 'Yüklenemedi'))
      .finally(() => setLoading(false));
  }, [id, isEdit]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      if (isEdit && id) {
        await updateProperty(id, {
          name: name.trim(),
          type,
          address: address.trim() || null,
        });
        navigate(`/properties/${id}`, { replace: true });
      } else {
        const created = await createProperty({
          name: name.trim(),
          type,
          address: address.trim() || null,
        });
        navigate(`/properties/${created.id}`, { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kaydedilemedi');
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-stone-600 dark:text-stone-300">Yükleniyor…</p>;
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <Link
        to={isEdit && id ? `/properties/${id}` : '/properties'}
        className="inline-block text-sm text-emerald-600 hover:underline dark:text-emerald-500"
      >
        ← Geri
      </Link>
      <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
        {isEdit ? 'Mülk Düzenle' : 'Yeni Mülk'}
      </h1>

      <Card>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Ad"
            name="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Örn: Alsancak Otel"
          />

          <Select
            label="Tip"
            name="type"
            required
            value={type}
            onChange={(v) => setType(v as PropertyType)}
            options={[
              { value: 'HOTEL', label: 'Otel' },
              { value: 'APARTMENT', label: 'Daire' },
            ]}
          />

          <Input
            label="Adres"
            name="address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Mahalle, Sokak, Daire"
          />

          {error && (
            <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Link to={isEdit && id ? `/properties/${id}` : '/properties'}>
              <Button type="button" variant="secondary" disabled={saving}>
                İptal
              </Button>
            </Link>
            <Button type="submit" loading={saving}>
              {isEdit ? 'Kaydet' : 'Oluştur'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
