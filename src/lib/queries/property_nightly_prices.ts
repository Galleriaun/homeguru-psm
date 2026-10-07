import { supabase } from '@/lib/supabase';
import { fetchAllRows, sortByInstant } from '@/lib/queries/fetchAll';
import type { Database } from '@/types/database';

export type NightlyPrice = Database['public']['Tables']['property_nightly_prices']['Row'];

const wrapErr = (e: { message: string; details?: string; hint?: string; code?: string }) =>
  new Error(
    `${e.message}${e.details ? ` — ${e.details}` : ''}${e.hint ? ` [${e.hint}]` : ''}${e.code ? ` (${e.code})` : ''}`,
  );

/**
 * Price overrides with price_date in [startDate, endDate), ordered by date.
 * Without `unitId`: every visible unit (the Takvim grid). With it: that unit
 * only — the reservation form prices one stay and has no use for the rest.
 *
 * One row per unit per night, so a bulk price set grows this fast. It goes
 * through fetchAllRows so an override can never be silently cut at the
 * server's Max Rows and a stay priced at the default instead.
 */
export async function listPricesInRange(
  startDate: string,
  endDate: string,
  unitId?: string,
): Promise<NightlyPrice[]> {
  const rows = await fetchAllRows<NightlyPrice>(() => {
    const q = supabase
      .from('property_nightly_prices')
      .select('*', { count: 'exact' })
      .gte('price_date', startDate)
      .lt('price_date', endDate);
    return unitId ? q.eq('unit_id', unitId) : q;
  }, wrapErr);
  return sortByInstant(rows, (r) => r.price_date, true);
}

/**
 * Bulk-set a flat price across a date range. Backed by set_nightly_price_range
 * (migration 047) which upserts one row per night in [startDate, endDate]
 * inclusive. Returns the count of nights affected.
 */
export async function setPriceRange(
  propertyId: string,
  unitId: string,
  startDate: string,
  endDate: string,
  price: number,
): Promise<number> {
  const { data, error } = await supabase.rpc('set_nightly_price_range', {
    _property_id: propertyId,
    _unit_id: unitId,
    _start_date: startDate,
    _end_date: endDate,
    _price: price,
  });
  if (error) throw wrapErr(error);
  return data ?? 0;
}

export async function deletePrice(id: string): Promise<void> {
  const { error } = await supabase.from('property_nightly_prices').delete().eq('id', id);
  if (error) throw wrapErr(error);
}
