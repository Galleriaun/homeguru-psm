import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { unitPhotoUrl } from '@/lib/photos';
import { formatRoomType, formatTRY } from '@/lib/utils';
import type { Database } from '@/types/database';

type Gallery = NonNullable<
  Database['public']['Functions']['get_public_unit_gallery']['Returns']
>;

/**
 * Public, unauthenticated page that renders a single unit's photo gallery
 * plus minimal context (property name, room type, capacity, base price).
 *
 * Backed by the SECURITY DEFINER RPC `get_public_unit_gallery` (migration 026)
 * which exposes only the public-safe fields. The URL is what
 * `resolveKatalogLink()` produces for the {katalog_link} template variable.
 */
export function UnitGalleryPage() {
  const { unitId } = useParams<{ unitId: string }>();

  const [gallery, setGallery] = useState<Gallery | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  useEffect(() => {
    if (!unitId) {
      setGallery(null);
      return;
    }
    setError(null);
    supabase
      .rpc('get_public_unit_gallery', { p_unit_id: unitId })
      .then(({ data, error }) => {
        if (error) {
          setError(error.message);
          setGallery(null);
          return;
        }
        // RPC returns jsonb (or null when no row matched).
        setGallery((data as unknown as Gallery | null) ?? null);
      });
  }, [unitId]);

  // Esc closes the lightbox.
  useEffect(() => {
    if (!lightbox) return;
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null);
    };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [lightbox]);

  if (gallery === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-50 dark:bg-stone-950">
        <p className="text-sm text-stone-600 dark:text-stone-300">Yükleniyor…</p>
      </div>
    );
  }

  if (gallery === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4 dark:bg-stone-950">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-100">
            Galeri bulunamadı
          </h1>
          <p className="mt-2 text-sm text-stone-600 dark:text-stone-300">
            {error ?? 'Bu bağlantı geçersiz ya da artık geçerli değil.'}
          </p>
        </div>
      </div>
    );
  }

  const hasPhotos = gallery.photo_paths && gallery.photo_paths.length > 0;

  return (
    <div className="min-h-screen bg-stone-50 dark:bg-stone-950">
      <header className="border-b border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-900">
        <div className="mx-auto max-w-4xl px-4 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
            HomeGuru
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-stone-900 dark:text-stone-100">
            {gallery.property_name} · {gallery.name}
          </h1>
          <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
            {formatRoomType(gallery.room_type)} · {gallery.capacity} kişi ·{' '}
            <span className="text-stone-900 dark:text-stone-100">
              {formatTRY(Number(gallery.base_price))} / gece
            </span>
          </p>
          {gallery.property_address && (
            <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
              {gallery.property_address}
            </p>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6">
        {!hasPhotos ? (
          <p className="rounded-lg border border-dashed border-stone-300 bg-white px-6 py-12 text-center text-sm text-stone-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300">
            Bu birim için henüz fotoğraf eklenmemiş.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {gallery.photo_paths.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setLightbox(p)}
                className="block aspect-[4/3] overflow-hidden rounded-lg bg-stone-200 dark:bg-stone-800"
                aria-label="Fotoğrafı büyüt"
              >
                <img
                  src={unitPhotoUrl(p)}
                  alt={`${gallery.name} fotoğrafı`}
                  className="h-full w-full object-cover transition-opacity hover:opacity-90"
                  loading="lazy"
                />
              </button>
            ))}
          </div>
        )}
      </main>

      {/* Full-screen lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightbox(null)}
          role="dialog"
          aria-modal="true"
        >
          <img
            src={unitPhotoUrl(lightbox)}
            alt={`${gallery.name} büyük fotoğraf`}
            className="max-h-full max-w-full rounded shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            onClick={() => setLightbox(null)}
            aria-label="Kapat"
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-stone-900 shadow-lg hover:bg-white"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path
                d="M5 5l10 10M15 5L5 15"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
