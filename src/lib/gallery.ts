import type { Unit } from '@/lib/queries/units';

/**
 * Build the absolute URL for a unit's public gallery page.
 * Returns '' when the unit has no photos (so callers can fall back gracefully
 * instead of sending guests to an empty page).
 *
 * Uses import.meta.env.BASE_URL so the URL works in dev (`/`) and prod
 * (`/homeguru-psm/`) without any per-environment branching here.
 */
export function buildUnitGalleryUrl(unit: Pick<Unit, 'id' | 'photo_paths'> | null | undefined): string {
  if (!unit) return '';
  if (!unit.photo_paths || unit.photo_paths.length === 0) return '';
  const base = import.meta.env.BASE_URL || '/';
  // BASE_URL is guaranteed to end with '/' by Vite, so just concat.
  return `${window.location.origin}${base}g/u/${unit.id}`;
}

/**
 * Resolve the value for the `{katalog_link}` WhatsApp template variable.
 *
 * Precedence (first non-empty wins):
 *   1. unit.catalog_url       — manual override (WhatsApp Business, Drive, etc.)
 *   2. built-in gallery URL    — auto-generated if unit has photos
 *   3. '' (placeholder stays unresolved)
 */
export function resolveKatalogLink(
  unit: Pick<Unit, 'id' | 'catalog_url' | 'photo_paths'> | null | undefined,
): string {
  if (!unit) return '';
  const manual = unit.catalog_url?.trim();
  if (manual) return manual;
  return buildUnitGalleryUrl(unit);
}
