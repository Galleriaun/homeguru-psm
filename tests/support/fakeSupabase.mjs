/**
 * In-memory stand-in for the supabase-js client, for the Node fixtures.
 *
 * It models the one server behaviour these tests exist for: every response is
 * silently CAPPED at `db.maxRows` rows (PostgREST "Max Rows"), whatever limit
 * the client asked for. `count: 'exact'` reports the full number of matching
 * rows regardless of the cap, exactly like the Content-Range total.
 *
 * Only the builder methods the query modules use are implemented; anything
 * else is a TypeError, so an unmodelled call fails the fixture loudly.
 */

export const db = {
  /** table name → array of row objects (mutable: tests change it mid-load). */
  tables: {},
  maxRows: Infinity,
  /** Every executed request, in order. */
  requests: [],
  /** (index, request) => void | { error } — runs before each request. */
  beforeRequest: null,
  /** Simulates a server that ignores the id cursor. */
  ignoreIdCursor: false,
  reset() {
    this.tables = {};
    this.maxRows = Infinity;
    this.requests = [];
    this.beforeRequest = null;
    this.ignoreIdCursor = false;
  },
};

const isIdColumn = (c) => c === 'id' || c.endsWith('_id');

/** Timestamps/dates compare as instants; ids and everything else as-is. */
function compare(column, a, b) {
  if (!isIdColumn(column) && typeof a === 'string' && typeof b === 'string') {
    const ta = Date.parse(a);
    const tb = Date.parse(b);
    if (!Number.isNaN(ta) && !Number.isNaN(tb)) return ta - tb;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

class Query {
  constructor(table) {
    this.table = table;
    this.columns = null;
    this.count = null;
    this.ops = [];
    this.orderBy = null;
    this.rowLimit = null;
  }
  select(columns = '*', options = {}) {
    this.columns = columns;
    this.count = options.count ?? null;
    return this;
  }
  eq(column, value) {
    this.ops.push({ op: 'eq', column, value });
    return this;
  }
  in(column, values) {
    this.ops.push({ op: 'in', column, value: values });
    return this;
  }
  lt(column, value) {
    this.ops.push({ op: 'lt', column, value });
    return this;
  }
  gt(column, value) {
    this.ops.push({ op: 'gt', column, value });
    return this;
  }
  gte(column, value) {
    this.ops.push({ op: 'gte', column, value });
    return this;
  }
  order(column, options = {}) {
    this.orderBy = { column, ascending: options.ascending !== false };
    return this;
  }
  limit(n) {
    this.rowLimit = n;
    return this;
  }
  then(onFulfilled, onRejected) {
    return new Promise((resolve) => resolve(this.run())).then(onFulfilled, onRejected);
  }

  matches(row) {
    return this.ops.every(({ op, column, value }) => {
      if (op === 'gt' && column === 'id' && db.ignoreIdCursor) return true;
      const v = row[column];
      if (op === 'eq') return v === value;
      if (op === 'in') return value.includes(v);
      if (v == null) return false; // SQL: a comparison with NULL is not true
      const c = compare(column, v, value);
      if (op === 'lt') return c < 0;
      if (op === 'gt') return c > 0;
      if (op === 'gte') return c >= 0;
      throw new Error(`fakeSupabase: unknown op ${op}`);
    });
  }

  run() {
    const request = {
      table: this.table,
      columns: this.columns,
      count: this.count,
      ops: this.ops.map((o) => ({ ...o })),
      order: this.orderBy,
      limit: this.rowLimit,
    };
    const index = db.requests.length;
    db.requests.push(request);
    const injected = db.beforeRequest ? db.beforeRequest(index, request) : undefined;
    if (injected && injected.error) return { data: null, error: injected.error, count: null };

    const source = db.tables[this.table];
    if (!source) throw new Error(`fakeSupabase: unknown table "${this.table}"`);
    const rows = source.filter((r) => this.matches(r));
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      rows.sort((a, b) => compare(column, a[column], b[column]) * (ascending ? 1 : -1));
    }
    const take = Math.min(db.maxRows, this.rowLimit ?? Infinity);
    return {
      data: rows.slice(0, take).map((r) => ({ ...r })),
      error: null,
      count: this.count === 'exact' ? rows.length : null,
    };
  }
}

export const supabase = {
  from(table) {
    return new Query(table);
  },
};
