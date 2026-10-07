// Fixture for src/lib/queries/fetchAll.ts — imports the REAL module.
// Run: node tests/fetchAll.check.mjs
import { createHarness, id } from './support/harness.mjs';
import { db, supabase } from './support/fakeSupabase.mjs';

const { fetchAllRows, sortByInstant, PAGE_SIZE } = await import(
  new URL('../src/lib/queries/fetchAll.ts', import.meta.url).href
);
const { ok, eq, rejects, done } = createHarness('fetchAll');

const table = (n, from = 1) =>
  Array.from({ length: n }, (_, i) => ({ id: id(from + i), v: from + i }));
const passThrough = (e) => new Error(e.message);

/** Loads table "t" and counts how many times the query was (re)built. */
function loader({ count = 'exact' } = {}) {
  const state = { builds: 0 };
  state.build = () => {
    state.builds++;
    return supabase.from('t').select('*', count ? { count } : {});
  };
  return state;
}
const dataRequests = () => db.requests.filter((r) => r.limit !== 1);
const sumV = (rows) => rows.reduce((a, r) => a + r.v, 0);

// 1. THE BUG. 1410 rows behind a 1000-row server cap: one unpaged request
//    (what the code did) is silently truncated; the helper returns all of them.
{
  db.reset();
  db.tables.t = table(1410);
  db.maxRows = 1000;
  const single = await supabase.from('t').select('*');
  eq(single.data.length, 1000, 'baseline: an unpaged request is cut to the cap, with no error');
  eq(single.error, null, 'baseline: the truncation raises no error');

  db.requests = [];
  const l = loader();
  const all = await fetchAllRows(l.build, passThrough);
  eq(all.length, 1410, '1410 rows through a 1000 cap');
  eq(new Set(all.map((r) => r.id)).size, 1410, 'no duplicates');
  eq(sumV(all), (1410 * 1411) / 2, 'every row present exactly once');
  eq(db.requests.length, 3, 'two data pages + one verification request');
  eq(l.builds, db.requests.length, 'a fresh query is built for every request');
  ok(
    db.requests.every((r) => r.order && r.order.column === 'id' && r.order.ascending === true),
    'every request is ordered by id ascending',
  );
  eq(db.requests[0].limit, PAGE_SIZE, 'data pages ask for PAGE_SIZE rows');
  ok(!db.requests[0].ops.some((o) => o.op === 'gt' && o.column === 'id'), 'first page has no cursor');
  const cursor = db.requests[1].ops.find((o) => o.op === 'gt' && o.column === 'id');
  eq(cursor && cursor.value, id(1000), 'second page continues after the last id of the first');
  eq(db.requests[2].limit, 1, 'verification asks for a single row (it only needs the count)');
}

// 2. Under the cap everything arrives in ONE request — one consistent
//    snapshot, no extra round trip, no verification needed.
{
  db.reset();
  db.tables.t = table(1410);
  db.maxRows = 10000;
  const all = await fetchAllRows(loader().build, passThrough);
  eq(all.length, 1410, 'under the cap: all rows');
  eq(db.requests.length, 1, 'under the cap: exactly one request');
}

// 3. A cap far below the page size (Max Rows lowered again): a short page must
//    never be read as the end of the data.
{
  db.reset();
  db.tables.t = table(50);
  db.maxRows = 7;
  const all = await fetchAllRows(loader().build, passThrough);
  eq(all.length, 50, '50 rows through a cap of 7');
  eq(sumV(all), (50 * 51) / 2, 'cap of 7: every row exactly once');
  eq(dataRequests().length, 8, 'cap of 7: eight data pages');
}

// 4. Edge sizes, with an explicit small page size.
{
  const run = async (n, pageSize, maxRows = Infinity) => {
    db.reset();
    db.tables.t = table(n);
    db.maxRows = maxRows;
    const rows = await fetchAllRows(loader().build, passThrough, { pageSize });
    return { rows, requests: db.requests.length };
  };
  let r = await run(0, 10);
  eq(r.rows.length, 0, 'empty table → []');
  eq(r.requests, 1, 'empty table: one request');
  r = await run(1, 10);
  eq(r.rows.length, 1, 'one row');
  eq(r.requests, 1, 'one row: one request');
  r = await run(10, 10);
  eq(r.rows.length, 10, 'exactly one full page');
  eq(r.requests, 1, 'exactly one full page: one request (the count says it is complete)');
  r = await run(11, 10);
  eq(r.rows.length, 11, 'one row over a page');
  eq(r.requests, 3, 'one over a page: two pages + verification');
  r = await run(20, 10);
  eq(r.rows.length, 20, 'exactly two full pages');
  eq(r.requests, 3, 'exactly two full pages: two pages + verification');
}

// 5. No count from the server (call site forgot `count: 'exact'`): still
//    complete — falls back to reading until an empty page.
{
  db.reset();
  db.tables.t = table(25);
  db.maxRows = 10;
  const all = await fetchAllRows(loader({ count: null }).build, passThrough);
  eq(all.length, 25, 'no count: all 25 rows');
  eq(dataRequests().length, 4, 'no count: three data pages + the empty page');
}

// 6. A failing request rejects the whole load — never a partial list — and the
//    error goes through the caller's wrapper.
{
  const wrap = (e) => new Error(`wrapped: ${e.message} (${e.code})`);
  db.reset();
  db.tables.t = table(30);
  db.maxRows = 10;
  db.beforeRequest = (i) => (i === 2 ? { error: { message: 'boom', code: 'XX000' } } : undefined);
  await rejects(() => fetchAllRows(loader().build, wrap), 'error on the third page rejects', /^wrapped: boom \(XX000\)$/);

  db.reset();
  db.tables.t = table(30);
  db.maxRows = 10;
  db.beforeRequest = (i) => (i === 3 ? { error: { message: 'late', code: 'XX001' } } : undefined);
  await rejects(() => fetchAllRows(loader().build, wrap), 'error on the verification request rejects', /^wrapped: late \(XX001\)$/);
}

// 7. A server that ignores the cursor (same page forever) must throw rather
//    than loop or return duplicated rows.
{
  db.reset();
  db.tables.t = table(30);
  db.maxRows = 10;
  db.ignoreIdCursor = true;
  await rejects(() => fetchAllRows(loader().build, passThrough), 'ignored cursor → throws', /tekrar/);
}

// 8. Runaway guard: a table that grows faster than it can be read hits the
//    page limit and throws instead of spinning forever.
{
  db.reset();
  db.tables.t = table(1);
  db.maxRows = 1;
  db.beforeRequest = (i) => {
    db.tables.t.push({ id: id(i + 2), v: i + 2 });
  };
  await rejects(
    () => fetchAllRows(loader().build, passThrough, { maxPages: 20 }),
    'page limit → throws',
    /sayfa sınırı/,
  );
}

// 9. A row inserted BEHIND the cursor during a multi-page load would be
//    missed; the verification count catches it and the load is repeated.
{
  db.reset();
  db.tables.t = table(25, 101);
  db.maxRows = 10;
  db.beforeRequest = (i) => {
    if (i === 1) db.tables.t.push({ id: id(1), v: 1 });
  };
  const all = await fetchAllRows(loader().build, passThrough);
  eq(all.length, 26, 'concurrent insert: the retry returns all 26 rows');
  ok(all.some((r) => r.id === id(1)), 'concurrent insert: the late row is included');
  eq(new Set(all.map((r) => r.id)).size, 26, 'concurrent insert: no duplicates');
  eq(db.requests.length, 8, 'concurrent insert: two attempts of three pages + verification');
}

// 10. A row deleted after it was fetched: also caught and repeated.
{
  db.reset();
  db.tables.t = table(25, 101);
  db.maxRows = 10;
  db.beforeRequest = (i) => {
    if (i === 1) db.tables.t = db.tables.t.filter((r) => r.id !== id(101));
  };
  const all = await fetchAllRows(loader().build, passThrough);
  eq(all.length, 24, 'concurrent delete: the retry returns the 24 remaining rows');
  ok(!all.some((r) => r.id === id(101)), 'concurrent delete: the deleted row is gone');
}

// 11. Data that keeps changing on every attempt: give up loudly, never return
//     a list known to be inconsistent.
{
  db.reset();
  db.tables.t = table(25, 1001);
  db.maxRows = 10;
  db.beforeRequest = (i) => {
    db.tables.t.push({ id: id(900 - i), v: 900 - i }); // always behind any cursor
  };
  await rejects(() => fetchAllRows(loader().build, passThrough), 'constant churn → throws', /değişti/);
  eq(
    db.requests.filter((r) => r.limit === 1).length,
    3,
    'constant churn: three attempts (three verifications), then stop',
  );
}

// 12. sortByInstant: real instants (not string order), ties broken by id, and
//     a total order even when a timestamp is missing or unreadable.
{
  const rows = [
    { id: 'b', t: '2026-07-09T11:00:00+00:00' },
    { id: 'a', t: '2026-07-09T14:00:00+03:00' }, // same instant as b
    { id: 'c', t: '2026-07-09T13:00:00+03:00' }, // 10:00Z — earliest of the three, last as a string
    { id: 'd', t: '2023-02-02T00:02:00+00:00' },
    { id: 'e', t: '2026-12-31T21:00:00Z' },
  ];
  const ids = (list) => list.map((r) => r.id).join('');
  eq(ids(sortByInstant(rows, (r) => r.t, true)), 'dcabe', 'ascending');
  eq(ids(sortByInstant(rows, (r) => r.t, false)), 'eabcd', 'descending');
  eq(ids(rows), 'bacde', 'the input array is not mutated');

  const dates = [
    { id: '2', t: '2026-05-02' },
    { id: '1', t: '2026-05-02' },
    { id: '3', t: '2026-05-01' },
  ];
  eq(ids(sortByInstant(dates, (r) => r.t, true)), '312', 'DATE strings, ties by id');

  // Unreadable timestamps sort where Postgres puts NULLs: last ascending,
  // first descending — and identically from every starting order.
  const bad = [
    { id: 'x', t: null },
    { id: 'm', t: '2026-01-01T00:00:00Z' },
    { id: 'w', t: 'not a date' },
    { id: 'k', t: '2025-01-01T00:00:00Z' },
    { id: 'y', t: undefined },
  ];
  eq(ids(sortByInstant(bad, (r) => r.t, true)), 'kmwxy', 'unreadable timestamps last when ascending');
  eq(ids(sortByInstant(bad, (r) => r.t, false)), 'wxymk', 'unreadable timestamps first when descending');
  const permutations = [
    [0, 1, 2, 3, 4],
    [4, 3, 2, 1, 0],
    [2, 0, 4, 1, 3],
    [1, 4, 0, 3, 2],
    [3, 2, 1, 4, 0],
  ];
  ok(
    permutations.every((p) => ids(sortByInstant(p.map((i) => bad[i]), (r) => r.t, true)) === 'kmwxy'),
    'same result from every input order (the comparator is a total order)',
  );
}

done();
