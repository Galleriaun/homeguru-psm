/**
 * Fetch EVERY row of a query.
 *
 * PostgREST silently caps a response at the project's "Max Rows" setting: a
 * query that matches more rows than the cap comes back truncated with no error
 * (the only trace is `Content-Range: 0-999/*`). That is how reservations went
 * missing from the Takvim, and how old unpaid stays dropped off the Borçlular
 * list. Any list that must be complete goes through here instead of a single
 * request.
 *
 * Deliberately free of imports (no supabase client): the builder is described
 * structurally below, so the Node fixtures in tests/ can drive this file with
 * a fake server.
 */

/**
 * Rows asked for per request. The server returns fewer when its own cap is
 * lower, which is handled. Large on purpose: a list that fits in one response
 * is loaded in ONE request, exactly as before paging existed.
 */
export const PAGE_SIZE = 5000;

/** Safety stop for one load: 500 pages. */
const MAX_PAGES = 500;

/** Whole-load attempts when the data keeps changing underneath a paged load. */
const MAX_ATTEMPTS = 3;

export interface PageError {
  message: string;
  details?: string;
  hint?: string;
  code?: string;
}

export interface PageResponse<T> {
  data: T[] | null;
  error: PageError | null;
  count?: number | null;
}

/** The part of a supabase-js filter builder this file uses. */
export interface PagedQuery<T> extends PromiseLike<PageResponse<T>> {
  gt(column: string, value: string): PagedQuery<T>;
  order(column: string, options: { ascending: boolean }): PagedQuery<T>;
  limit(count: number): PagedQuery<T>;
}

/**
 * `build` returns the query with its select and filters applied and NOTHING
 * else — no order, no limit. It is called once per request, because supabase-js
 * builders are mutable. Select with `{ count: 'exact' }`:
 *
 *     fetchAllRows(
 *       () => supabase.from('t').select('*', { count: 'exact' }).eq('a', 1),
 *       wrapErr,
 *     )
 *
 * How it stays complete and correct:
 *
 * - Keyset paging (`id > last id`, ordered by id) rather than offsets: a row
 *   inserted or deleted while the pages load cannot shift the rest and cause a
 *   skip or a duplicate.
 * - A page ends the load only when the server's own exact count — taken in the
 *   same request, so the same snapshot — says nothing is left after it. A
 *   SHORT page is never treated as the end: that is exactly what a server cap
 *   below `pageSize` looks like. Without a count (a call site that forgot
 *   `count: 'exact'`) it reads on until an empty page: slower, still complete.
 * - One request is one consistent snapshot. A load that needed several pages
 *   is not, so it is verified afterwards: the total is counted again and must
 *   equal the number of rows loaded. A row added or removed mid-load fails
 *   that check and the whole load is repeated. (This catches a net change in
 *   the row count; a truly atomic multi-page read would need a server-side
 *   snapshot.)
 * - All or nothing: a failed request, a repeated id (the cursor was ignored),
 *   the page limit, or data that will not hold still all throw. A partial list
 *   is never returned, because every caller treats "row absent" as meaningful
 *   (not paid, not booked).
 */
export async function fetchAllRows<T extends { id: string }>(
  build: () => PagedQuery<T>,
  onError: (e: PageError) => Error,
  opts: { pageSize?: number; maxPages?: number; maxAttempts?: number } = {},
): Promise<T[]> {
  const pageSize = opts.pageSize ?? PAGE_SIZE;
  const maxPages = opts.maxPages ?? MAX_PAGES;
  const maxAttempts = opts.maxAttempts ?? MAX_ATTEMPTS;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const all: T[] = [];
    const seen = new Set<string>();
    let afterId: string | null = null;
    let requests = 0;
    let complete = false;

    while (!complete) {
      if (requests >= maxPages) throw new Error('Veri yüklenemedi: sayfa sınırı aşıldı.');
      const filtered: PagedQuery<T> = afterId === null ? build() : build().gt('id', afterId);
      const { data, error, count } = await filtered
        .order('id', { ascending: true })
        .limit(pageSize);
      requests++;
      if (error) throw onError(error);
      const rows: T[] = data ?? [];
      for (const row of rows) {
        if (seen.has(row.id)) {
          throw new Error('Veri yüklenemedi: aynı kayıt tekrar geldi (sayfalama hatası).');
        }
        seen.add(row.id);
        all.push(row);
      }
      if (rows.length === 0 || (typeof count === 'number' && rows.length >= count)) {
        complete = true;
      } else {
        afterId = rows[rows.length - 1].id;
      }
    }

    // A single request is a single snapshot — nothing to verify.
    if (requests === 1) return all;

    const check = await build().order('id', { ascending: true }).limit(1);
    if (check.error) throw onError(check.error);
    if (typeof check.count !== 'number' || check.count === all.length) return all;
  }
  throw new Error('Veri yüklenemedi: yükleme sırasında kayıtlar değişti. Lütfen tekrar deneyin.');
}

/**
 * Sort by a timestamp column, comparing real instants (not strings — the same
 * moment can be serialised with different offsets). Ties break on `id`, so the
 * order is identical between loads. Returns a new array.
 *
 * A missing or unreadable timestamp sorts where Postgres puts NULLs — last
 * when ascending, first when descending — so the comparator is a total order
 * and can never return NaN.
 *
 * Paged queries come back ordered by id, so the display order the server used
 * to provide has to be restored here.
 */
export function sortByInstant<T extends { id: string }>(
  rows: readonly T[],
  getIso: (row: T) => string | null | undefined,
  ascending: boolean,
): T[] {
  const dir = ascending ? 1 : -1;
  return rows
    .map((row) => {
      const iso = getIso(row);
      return { row, at: iso == null ? NaN : Date.parse(iso) };
    })
    .sort((a, b) => {
      const aBad = Number.isNaN(a.at);
      const bBad = Number.isNaN(b.at);
      if (aBad !== bBad) return (aBad ? 1 : -1) * dir;
      if (!aBad && a.at !== b.at) return (a.at - b.at) * dir;
      return a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0;
    })
    .map((x) => x.row);
}
