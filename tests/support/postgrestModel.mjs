/**
 * A small model of how PostgREST answers a table GET, for the fixtures.
 *
 * It implements what the list queries rely on:
 *   - column filters:  col=eq.v  neq.v  gt.v  gte.v  lt.v  lte.v  in.(a,b)  is.null
 *   - order=col.asc|desc[,col2...]   limit=N   offset=N
 *   - the server-side row cap (`maxRows`), applied silently
 *   - `Prefer: count=exact` → `Content-Range: 0-999/1410`, HTTP 206 when partial
 *
 * `select` is ignored (rows are returned whole; joined names are pre-nested in
 * the fixture rows).
 *
 * strict = true  → an operator this model does not know is a 400, so a query
 *                  that depends on unmodelled behaviour fails loudly.
 * strict = false → unknown operators are ignored and an `eq` on a column the
 *                  row lacks keeps the row (the forgiving behaviour screens
 *                  with hand-written fixtures need).
 */

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);

const isIdColumn = (c) => c === 'id' || c.endsWith('_id');

/** Compare a row value with a URL value the way Postgres would for its type. */
function compare(column, rowValue, urlValue) {
  if (typeof rowValue === 'number') return rowValue - Number(urlValue);
  const a = String(rowValue);
  const b = String(urlValue);
  if (!isIdColumn(column)) {
    const ta = Date.parse(a);
    const tb = Date.parse(b);
    if (!Number.isNaN(ta) && !Number.isNaN(tb)) return ta - tb;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

function parseInList(raw) {
  // in.(a,b,"c d")
  const inner = raw.slice(raw.indexOf('(') + 1, raw.lastIndexOf(')'));
  return inner.split(',').map((v) => v.trim().replace(/^"(.*)"$/, '$1'));
}

class BadRequest extends Error {}

function matchesFilter(row, column, raw, strict) {
  const dot = raw.indexOf('.');
  const op = dot === -1 ? raw : raw.slice(0, dot);
  const value = dot === -1 ? '' : raw.slice(dot + 1);
  const has = column in row;
  const v = row[column];
  switch (op) {
    case 'eq':
      if (!has && !strict) return true;
      return v != null && String(v) === value;
    case 'neq':
      return v != null && String(v) !== value;
    case 'in':
      return v != null && parseInList(raw).includes(String(v));
    case 'is':
      if (value === 'null') return v == null;
      if (strict) throw new BadRequest(`unsupported is.${value}`);
      return true;
    case 'gt':
      return v != null && compare(column, v, value) > 0;
    case 'gte':
      return v != null && compare(column, v, value) >= 0;
    case 'lt':
      return v != null && compare(column, v, value) < 0;
    case 'lte':
      return v != null && compare(column, v, value) <= 0;
    default:
      if (strict) throw new BadRequest(`unsupported operator "${op}" on ${column}`);
      return true;
  }
}

/**
 * @param rows          all rows of the table
 * @param searchParams  URLSearchParams of the request
 * @param options       { prefer, maxRows, strict }
 * @returns             { status, headers, body, matched }
 */
export function queryTable(rows, searchParams, options = {}) {
  const { prefer = '', maxRows = Infinity, strict = false } = options;
  try {
    let out = rows;
    for (const [key, raw] of searchParams) {
      if (RESERVED.has(key)) continue;
      out = out.filter((r) => matchesFilter(r, key, raw, strict));
    }

    const order = searchParams.get('order');
    if (order) {
      const keys = order.split(',').map((part) => {
        const [column, direction = 'asc'] = part.split('.');
        return { column, sign: direction === 'desc' ? -1 : 1 };
      });
      out = [...out].sort((a, b) => {
        for (const { column, sign } of keys) {
          const av = a[column];
          const bv = b[column];
          if (av == null && bv == null) continue;
          if (av == null) return sign; // NULLS LAST asc / FIRST desc
          if (bv == null) return -sign;
          const c = compare(column, av, bv);
          if (c !== 0) return c * sign;
        }
        return 0;
      });
    }

    const total = out.length;
    const offset = Number(searchParams.get('offset') ?? 0) || 0;
    const limitParam = searchParams.get('limit');
    const limit = limitParam === null ? Infinity : Number(limitParam);
    const take = Math.min(limit, maxRows);
    const page = out.slice(offset, take === Infinity ? undefined : offset + take);

    const counted = prefer.includes('count=exact');
    const range = page.length ? `${offset}-${offset + page.length - 1}` : '*';
    const headers = { 'Content-Range': `${range}/${counted ? total : '*'}` };
    const partial = counted && page.length < total;
    return { status: partial ? 206 : 200, headers, body: page, matched: total };
  } catch (e) {
    if (e instanceof BadRequest) {
      return {
        status: 400,
        headers: {},
        body: { code: 'PGRST100', message: `postgrestModel: ${e.message}`, details: null, hint: null },
        matched: 0,
      };
    }
    throw e;
  }
}
