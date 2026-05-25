import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { getProperty, type Property } from '@/lib/queries/properties';
import {
  getUnit,
  createUnit,
  updateUnit,
  countUnitsForProperty,
  type Unit,
} from '@/lib/queries/units';
import type { RoomType } from '@/types/database';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { NumberInput } from '@/components/ui/NumberInput';
import { Select } from '@/components/ui/Select';
import { formatRoomType } from '@/lib/utils';
import {
  uploadUnitPhoto,
  unitPhotoUrl,
  deleteUnitPhotos,
  UNIT_PHOTO_MAX,
} from '@/lib/photos';

// Bina ve daire birimleri artık aynı oda tiplerini kullanıyor (1+0/1+1/2+1).
// Kapasite her iki tipte de elle giriliyor — eski SINGLE/DOUBLE/TRIPLE/QUAD
// kayıtları DB'de kalsa bile yeni seçimler bu üç değerden biri olur.
const HOTEL_ROOM_TYPES: RoomType[] = ['1+0', '1+1', '2+1'];
const APARTMENT_ROOM_TYPES: RoomType[] = ['1+0', '1+1', '2+1'];

export function UnitFormPage() {
  const { id: propertyId, unitId } = useParams<{ id: string; unitId?: string }>();
  const isEdit = Boolean(unitId);
  const navigate = useNavigate();

  const [property, setProperty] = useState<Property | null>(null);
  const [name, setName] = useState('');
  const [roomType, setRoomType] = useState<RoomType>('SINGLE');
  const [capacity, setCapacity] = useState(2);
  const [basePrice, setBasePrice] = useState(1000);
  const [catalogUrl, setCatalogUrl] = useState('');
  const [photoPaths, setPhotoPaths] = useState<string[]>([]);
  const [originalPaths, setOriginalPaths] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!propertyId) return;

    const load = async (): Promise<[Property | null, Unit | null]> => {
      const propPromise = getProperty(propertyId);
      const unitPromise =
        isEdit && unitId ? getUnit(unitId) : Promise.resolve<Unit | null>(null);
      return Promise.all([propPromise, unitPromise]);
    };

    load()
      .then(([prop, unit]) => {
        if (!prop) {
          setError('Mülk bulunamadı');
          return;
        }
        setProperty(prop);
        // Default room type by property type
        setRoomType(prop.type === 'HOTEL' ? 'DOUBLE' : '1+1');

        if (unit) {
          setName(unit.name);
          setRoomType(unit.room_type);
          setCapacity(unit.capacity);
          setBasePrice(Number(unit.base_price));
          setCatalogUrl(unit.catalog_url ?? '');
          setPhotoPaths(unit.photo_paths ?? []);
          setOriginalPaths(unit.photo_paths ?? []);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Yüklenemedi'))
      .finally(() => setLoading(false));
  }, [propertyId, unitId, isEdit]);

  const isHotel = property?.type === 'HOTEL';
  const allowedRoomTypes = isHotel ? HOTEL_ROOM_TYPES : APARTMENT_ROOM_TYPES;

  const handleFilesPicked = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;

    const remaining = UNIT_PHOTO_MAX - photoPaths.length;
    if (remaining <= 0) {
      setPhotoError(`En fazla ${UNIT_PHOTO_MAX} fotoğraf yükleyebilirsiniz.`);
      return;
    }

    setPhotoError(null);
    setUploading(true);
    try {
      const toUpload = files.slice(0, remaining);
      const newPaths: string[] = [];
      for (const f of toUpload) {
        const path = await uploadUnitPhoto(f);
        newPaths.push(path);
      }
      setPhotoPaths((prev) => [...prev, ...newPaths]);
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : 'Fotoğraf yüklenemedi');
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = (path: string) => {
    setPhotoPaths((prev) => prev.filter((p) => p !== path));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!propertyId || !property) return;
    setError(null);
    setSaving(true);
    try {
      // Apartment single-unit guard (client-side; DB trigger is the source of truth)
      if (!isEdit && property.type === 'APARTMENT') {
        const count = await countUnitsForProperty(propertyId);
        if (count >= 1) {
          setError('Daire tipi mülkler yalnızca tek birim içerebilir.');
          setSaving(false);
          return;
        }
      }

      // Capacity is now entered manually for both bina and daire — the old
      // implied-from-room-type mapping was only valid for SINGLE/DOUBLE etc.
      const finalCapacity = capacity;

      const trimmedCatalog = catalogUrl.trim();
      const catalogPayload = trimmedCatalog.length > 0 ? trimmedCatalog : null;

      if (isEdit && unitId) {
        await updateUnit(unitId, {
          name: name.trim(),
          room_type: roomType,
          capacity: finalCapacity,
          base_price: basePrice,
          catalog_url: catalogPayload,
          photo_paths: photoPaths,
        });
      } else {
        await createUnit({
          property_id: propertyId,
          name: name.trim(),
          room_type: roomType,
          capacity: finalCapacity,
          base_price: basePrice,
          catalog_url: catalogPayload,
          photo_paths: photoPaths,
        });
      }

      // Best-effort cleanup: anything in the original list but not in the new one.
      const removed = originalPaths.filter((p) => !photoPaths.includes(p));
      if (removed.length > 0) {
        await deleteUnitPhotos(removed);
      }

      navigate(`/properties/${propertyId}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kaydedilemedi');
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-stone-600 dark:text-stone-300">Yükleniyor…</p>;
  }

  if (!property) {
    return (
      <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40">
        <p className="text-sm text-red-700 dark:text-red-400">{error ?? 'Mülk bulunamadı'}</p>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <Link
        to={`/properties/${propertyId}`}
        className="inline-block text-sm text-emerald-600 hover:underline dark:text-emerald-500"
      >
        ← {property.name}
      </Link>
      <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
        {isEdit ? 'Birim Düzenle' : 'Yeni Birim'}
      </h1>

      <Card>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Ad"
            name="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={isHotel ? 'Örn: Oda 101' : 'Örn: Daire'}
          />

          <Select
            label="Tip"
            name="room_type"
            required
            value={roomType}
            onChange={(v) => setRoomType(v as RoomType)}
            options={allowedRoomTypes.map((rt) => ({
              value: rt,
              label: formatRoomType(rt),
            }))}
          />

          <NumberInput
            label="Kapasite (kişi)"
            name="capacity"
            min={1}
            max={20}
            required
            value={capacity}
            onChange={setCapacity}
          />

          <NumberInput
            label="Gecelik Ücret (₺)"
            name="base_price"
            min={0}
            step={50}
            required
            value={basePrice}
            onChange={setBasePrice}
          />

          <Input
            label="Katalog Linki"
            name="catalog_url"
            type="url"
            value={catalogUrl}
            onChange={(e) => setCatalogUrl(e.target.value)}
            placeholder="https://wa.me/p/... veya istediğiniz başka link"
            maxLength={1000}
            hint="Boş bırakırsanız bu birim için fotoğraflardan oluşan otomatik bir galeri linki oluşturulur. Doldurursanız WhatsApp şablonlarında {katalog_link} bu URL'i kullanır."
          />

          {/* Photo gallery */}
          <div>
            <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">
              Fotoğraflar
            </label>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFilesPicked}
                className="hidden"
                disabled={uploading || photoPaths.length >= UNIT_PHOTO_MAX}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={uploading}
                disabled={photoPaths.length >= UNIT_PHOTO_MAX}
                onClick={() => fileInputRef.current?.click()}
              >
                + Fotoğraf Ekle
              </Button>
              <span className="text-xs text-stone-600 dark:text-stone-300">
                {photoPaths.length}/{UNIT_PHOTO_MAX} fotoğraf
              </span>
            </div>

            {photoError && (
              <p className="mt-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
                {photoError}
              </p>
            )}

            {photoPaths.length > 0 && (
              <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {photoPaths.map((p) => (
                  <div key={p} className="relative aspect-square">
                    <img
                      src={unitPhotoUrl(p)}
                      alt="Birim fotoğrafı"
                      className="h-full w-full rounded object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removePhoto(p)}
                      aria-label="Fotoğrafı kaldır"
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-xs text-white shadow hover:bg-red-700"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
              Görseller ~200 KB'a sıkıştırılarak yüklenir. Oda/daire iç fotoğrafları eklenebilir.
            </p>
          </div>

          {error && (
            <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Link to={`/properties/${propertyId}`}>
              <Button type="button" variant="secondary" disabled={saving || uploading}>
                İptal
              </Button>
            </Link>
            <Button type="submit" loading={saving} disabled={uploading}>
              {isEdit ? 'Kaydet' : 'Oluştur'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
