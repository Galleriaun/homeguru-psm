// Fixture: the REAL query modules, through the REAL supabase-js client, over
// HTTP to a local server that answers like PostgREST and silently caps every
// response (the production failure mode). Where queries.check.mjs proves the
// logic against an in-memory fake, this proves the actual requests the app
// puts on the wire — URL, filters, Prefer header, Content-Range parsing.
// Nothing here can reach a real Supabase project: the client is pinned to
// 127.0.0.1.
// Run: node tests/wire.check.mjs
import { createServer } from 'node:http';
import './support/alias.mjs';
import { createHarness, id } from './support/harness.mjs';
import { queryTable } from './support/postgrestModel.mjs';

const { ok, eq, rejects, done } = createHarness('wire');

// ───── local PostgREST-like server ─────
const state = { tables: {}, maxRows: Infinity, log: [], failAt: null };
const reset = (tables, maxRows = Infinity) => {
  state.tables = tables;
  state.maxRows = maxRows;
  state.log = [];
  state.failAt = null;
};

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const table = url.pathname.replace('/rest/v1/', '');
  const index = state.log.length;
  const entry = { method: req.method, table, params: url.searchParams, prefer: req.headers.prefer ?? '' };
  state.log.push(entry);
  const reply = (status, headers, body) => {
    entry.status = status;
    entry.returned = Array.isArray(body) ? body.length : null;
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  };
  if (state.failAt === index) {
    return reply(500, {}, { message: 'boom', code: 'XX000', details: null, hint: null });
  }
  if (req.method !== 'GET' || !url.pathname.startsWith('/rest/v1/') || !(table in state.tables)) {
    return reply(404, {}, { message: `unexpected ${req.method} ${url.pathname}`, code: 'TEST' });
  }
  const r = queryTable(state.tables[table], url.searchParams, {
    prefer: entry.prefer,
    maxRows: state.maxRows,
    strict: true, // anything the model does not understand is a 400
  });
  reply(r.status, r.headers, r.body);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
process.env.HG_FIXTURE_CLIENT = 'wire';
process.env.HG_FIXTURE_URL = `http://127.0.0.1:${server.address().port}`;

const src = (path) => import(new URL(`../src/lib/queries/${path}`, import.meta.url).href);
const { listReservations, listReservationsInRange, listActiveReservations } = await src('reservations.ts');
const { loadReservationsWithPayments, listPendingPaymentsForReservation } = await src('payments.ts');
const { listLedgerForReservation } = await src('ledger.ts');
const { listStaysForCleaning, CLEANING_LOOKBACK_DAYS } = await src('housekeeping.ts');
const { listPricesInRange } = await src('property_nightly_prices.ts');
const { listBlocksInRange } = await src('property_blocks.ts');
const { listNotesInRange } = await src('property_date_notes.ts');
const { PAGE_SIZE } = await src('fetchAll.ts');

// ───── data ─────
const DAY = 86400000;
const T0 = Date.parse('2023-01-01T11:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
const sortedBy = (rows, key, ascending) =>
  rows.every((r, i) => {
    if (i === 0) return true;
    const d = Date.parse(r[key]) - Date.parse(rows[i - 1][key]);
    return ascending ? d >= 0 : d <= 0;
  });
function reservations(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: id(((i * 7919) % n) + 1),
    stay_start: iso(T0 + i * DAY),
    stay_end: iso(T0 + (i + 2) * DAY),
    status: i % 10 === 0 ? 'cancelled' : i % 3 === 0 ? 'active' : 'completed',
    stay_type: 'NIGHTLY',
    total_amount: 1000 + i,
    guest: { full_name: `Misafir ${i}`, phone: null },
    unit: { name: '101', property_id: id(1) },
    property: { name: 'Test', type: 'HOTEL' },
  }));
}

// ───── listReservations: the production bug, on the wire ─────
{
  reset({ reservations: reservations(1410) }, 1000);
  const rows = await listReservations();
  eq(rows.length, 1410, 'listReservations: all 1410 through a 1000-row server cap');
  eq(new Set(rows.map((r) => r.id)).size, 1410, 'listReservations: no duplicates');
  ok(sortedBy(rows, 'stay_start', false), 'listReservations: newest first');
  eq(rows[rows.length - 1].guest.full_name, 'Misafir 0', 'listReservations: the oldest stay is present, with its joined guest');

  const [first, second, verify] = state.log;
  eq(state.log.length, 3, 'listReservations: two data pages + one verification');
  ok(first.prefer.includes('count=exact'), 'request asks for an exact count (Prefer header)');
  eq(first.params.get('order'), 'id.asc', 'request is ordered by id');
  eq(first.params.get('limit'), String(PAGE_SIZE), 'request asks for PAGE_SIZE rows');
  eq(first.params.get('id'), null, 'first page carries no cursor');
  ok(first.params.get('select').startsWith('id,property_id,'), 'select list starts with id');
  ok(first.params.get('select').includes('guest:guests(full_name,phone)'), 'select list keeps the joined guest');
  eq(first.status, 206, 'server answers 206 Partial Content for the capped page');
  eq(first.returned, 1000, 'first page is cut to the cap');
  eq(second.params.get('id'), `gt.${id(1000)}`, 'second page continues after the last id (id=gt.<uuid>)');
  eq(second.returned, 410, 'second page returns the remaining 410');
  eq(second.status, 200, 'the last page is complete (200)');
  eq(verify.params.get('limit'), '1', 'verification request asks for one row');
  eq(verify.params.get('id'), null, 'verification counts the whole set (no cursor)');

  reset({ reservations: reservations(1410) }, 10000);
  eq((await listReservations()).length, 1410, 'listReservations: all rows under the cap');
  eq(state.log.length, 1, 'listReservations: exactly one request under the cap');

  reset({ reservations: [] });
  eq((await listReservations()).length, 0, 'listReservations: empty table → []');
  eq(state.log.length, 1, 'listReservations: one request for an empty table');
}

// A server error on any page rejects; the 23P01 translation still applies.
{
  reset({ reservations: reservations(1410) }, 1000);
  state.failAt = 1;
  await rejects(() => listReservations(), 'listReservations: a failed second page rejects', /boom/);
}

// ───── listReservationsInRange ─────
{
  const start = iso(T0 + 100 * DAY);
  const end = iso(T0 + 1300 * DAY);
  const all = reservations(1410);
  reset({ reservations: all }, 1000);
  const rows = await listReservationsInRange(start, end);
  eq(rows.length, 1201, 'listReservationsInRange: every overlapping stay through the cap');
  ok(sortedBy(rows, 'stay_start', true), 'listReservationsInRange: earliest first');
  const got = new Set(rows.map((r) => r.id));
  ok(!got.has(all[98].id) && got.has(all[99].id), 'listReservationsInRange: window start boundary');
  ok(got.has(all[1299].id) && !got.has(all[1300].id), 'listReservationsInRange: window end boundary');
  eq(state.log[0].params.get('stay_start'), `lt.${end}`, 'range filter on the wire: stay_start=lt.<end>');
  eq(state.log[0].params.get('stay_end'), `gt.${start}`, 'range filter on the wire: stay_end=gt.<start>');
  ok(
    state.log.every((r) => r.params.get('stay_start') === `lt.${end}` && r.params.get('stay_end') === `gt.${start}`),
    'listReservationsInRange: every page and the verification keep the range filter',
  );
}

// ───── listActiveReservations (shared select list, not paged) ─────
{
  reset({ reservations: reservations(60) });
  const rows = await listActiveReservations();
  eq(rows.length, 18, 'listActiveReservations: only active stays');
  ok(sortedBy(rows, 'stay_start', false), 'listActiveReservations: newest first');
  eq(state.log[0].params.get('status'), 'eq.active', 'listActiveReservations: status=eq.active');
}

// ───── loadReservationsWithPayments ─────
{
  const payments = [];
  const expected = new Map();
  for (let i = 0; i < 1321; i++) {
    const reservation_id = id(5000 + (i % 400));
    payments.push({
      id: id(((i * 7919) % 1321) + 1),
      reservation_id,
      amount: i % 3 === 0 ? '100.00' : 100,
      status: i % 2 === 0 ? 'CONFIRMED' : 'UNCONFIRMED',
    });
    expected.set(reservation_id, (expected.get(reservation_id) ?? 0) + 100);
  }
  for (let i = 0; i < 50; i++) {
    payments.push({ id: id(9000 + i), reservation_id: id(5000 + i), amount: 999, status: 'DISPUTED' });
  }
  reset({ payment_collections: payments }, 1000);
  const map = await loadReservationsWithPayments();
  let total = 0;
  let exact = map.size === expected.size;
  for (const [k, v] of map) {
    total += v;
    if (expected.get(k) !== v) exact = false;
  }
  eq(total, 132100, 'loadReservationsWithPayments: every active payment summed through the cap');
  ok(exact, 'loadReservationsWithPayments: exact per-reservation sums, DISPUTED excluded');
  eq(state.log[0].params.get('status'), 'in.(UNCONFIRMED,CONFIRMED)', 'payments: status filter on the wire');
  eq(state.log[0].params.get('select'), 'id,reservation_id,amount', 'payments: select includes id (the cursor column)');

  reset({ payment_collections: payments }, 1000);
  state.failAt = 1;
  await rejects(() => loadReservationsWithPayments(), 'loadReservationsWithPayments: a failed page rejects', /boom/);
}

// ───── listPricesInRange ─────
{
  const day0 = Date.parse('2026-05-01T00:00:00Z');
  const date = (i) => new Date(day0 + i * DAY).toISOString().slice(0, 10);
  const units = [id(71), id(72), id(73)];
  const prices = [];
  let k = 0;
  for (let d = 0; d < 600; d++) {
    for (const unit_id of units) {
      prices.push({ id: id(((k * 7919) % 1800) + 1), unit_id, price_date: date(d), price: 1000 + d });
      k++;
    }
  }
  reset({ property_nightly_prices: prices }, 1000);
  eq((await listPricesInRange(date(0), date(600))).length, 1800, 'listPricesInRange: all 1800 overrides through the cap');

  reset({ property_nightly_prices: prices }, 1000);
  const one = await listPricesInRange(date(10), date(40), units[1]);
  eq(one.length, 30, 'listPricesInRange(unit): one row per night');
  ok(one.every((r) => r.unit_id === units[1]), 'listPricesInRange(unit): only the requested unit');
  eq(state.log.length, 1, 'listPricesInRange(unit): one request');
  eq(state.log[0].params.get('unit_id'), `eq.${units[1]}`, 'listPricesInRange(unit): unit_id=eq.<unit> on the wire');
  eq(state.log[0].params.getAll('price_date').join('|'), `gte.${date(10)}|lt.${date(40)}`, 'listPricesInRange: [start, end) on the wire');
}

// ───── listBlocksInRange / listNotesInRange ─────
{
  const blocks = Array.from({ length: 1200 }, (_, i) => ({
    id: id(((i * 7919) % 1200) + 1),
    block_start: iso(T0 + i * DAY),
    block_end: iso(T0 + (i + 1) * DAY),
  }));
  reset({ property_blocks: blocks }, 1000);
  eq((await listBlocksInRange(iso(T0), iso(T0 + 1200 * DAY))).length, 1200, 'listBlocksInRange: all 1200 through the cap');

  const day0 = Date.parse('2026-05-01T00:00:00Z');
  const date = (i) => new Date(day0 + i * DAY).toISOString().slice(0, 10);
  const notes = Array.from({ length: 1100 }, (_, i) => ({ id: id(((i * 7919) % 1100) + 1), note_date: date(i), note: `n${i}` }));
  reset({ property_date_notes: notes }, 1000);
  eq((await listNotesInRange(date(0), date(1100))).length, 1100, 'listNotesInRange: all 1100 through the cap');
}

// ───── Cari Hesap of one reservation: pending payments + the ledger ─────
{
  const R = id(7000);
  const payments = [
    { id: id(1), reservation_id: R, amount: 3000, method: 'TRANSFER', status: 'UNCONFIRMED', created_at: iso(T0 + 2 * DAY) },
    { id: id(2), reservation_id: R, amount: '1500.50', method: 'CASH', status: 'UNCONFIRMED', created_at: iso(T0 + 5 * DAY) },
    { id: id(3), reservation_id: R, amount: 2000, method: 'CASH', status: 'CONFIRMED', created_at: iso(T0 + 1 * DAY) },
    { id: id(4), reservation_id: R, amount: 900, method: 'CARD', status: 'DISPUTED', created_at: iso(T0 + 3 * DAY) },
    { id: id(5), reservation_id: id(7001), amount: 777, method: 'CASH', status: 'UNCONFIRMED', created_at: iso(T0 + 4 * DAY) },
  ];
  const ledger = [
    { id: id(11), reservation_id: R, type: 'DEBT', amount: 7500, note: 'Otomatik borçlandırma (giriş)', created_at: iso(T0), created_by: null },
    {
      id: id(12),
      reservation_id: R,
      type: 'PAYMENT',
      amount: 2000,
      note: 'Ödeme — CASH (onaylandı)',
      created_at: iso(T0 + 1 * DAY),
      created_by: id(900),
      payment_collection_id: id(3),
      payment_collection: { method: 'CASH', created_at: iso(T0 + DAY / 2) },
    },
    { id: id(13), reservation_id: id(7001), type: 'DEBT', amount: 1, note: 'başka rezervasyon', created_at: iso(T0), created_by: null },
  ];

  reset({ payment_collections: payments, ledger_entries: ledger });
  const pending = await listPendingPaymentsForReservation(R);
  eq(pending.map((p) => p.id).join(','), [id(2), id(1)].join(','), 'pending payments: only UNCONFIRMED of this reservation, newest first');
  eq(pending[0].amount, 1500.5, 'pending payments: numeric string summed as a number');
  eq(state.log.length, 1, 'pending payments: one request');
  eq(state.log[0].table, 'payment_collections', 'pending payments: table on the wire');
  eq(state.log[0].params.get('reservation_id'), `eq.${R}`, 'pending payments: reservation_id=eq.<id> on the wire');
  eq(state.log[0].params.get('status'), 'eq.UNCONFIRMED', 'pending payments: status=eq.UNCONFIRMED on the wire');
  eq(state.log[0].params.get('order'), 'created_at.desc', 'pending payments: newest first on the wire');
  eq(state.log[0].params.get('select'), 'id,amount,method,created_at', 'pending payments: select on the wire');

  reset({ payment_collections: payments, ledger_entries: ledger });
  const rows = await listLedgerForReservation(R);
  eq(rows.map((r) => r.id).join(','), [id(12), id(11)].join(','), 'ledger: this reservation only, newest first');
  eq(state.log[0].params.get('reservation_id'), `eq.${R}`, 'ledger: reservation_id=eq.<id> on the wire');
  eq(
    state.log[0].params.get('select'),
    '*,payment_collection:payment_collections(method,created_at)',
    'ledger: the collection’s method and date are requested on the wire',
  );

  reset({ payment_collections: payments, ledger_entries: ledger });
  state.failAt = 0;
  await rejects(() => listPendingPaymentsForReservation(R), 'pending payments: a failed request rejects', /boom/);
}

// ───── listStaysForCleaning ─────
{
  const now = new Date('2026-10-07T06:00:00Z');
  const stays = Array.from({ length: 1300 }, (_, i) => ({
    id: id(((i * 7919) % 1300) + 1),
    unit_id: id(100 + (i % 24)),
    stay_end: iso(now.getTime() + 2 * DAY - i * 2 * 3600000),
    stay_type: i % 5 === 0 ? 'DAYUSE' : 'OVERNIGHT',
    late_checkout_hours: i % 4,
    status: i % 9 === 0 ? 'cancelled' : 'completed',
  }));
  const from = now.getTime() - CLEANING_LOOKBACK_DAYS * DAY;
  const to = now.getTime() + DAY;
  const expected = stays.filter((s) => Date.parse(s.stay_end) >= from && Date.parse(s.stay_end) < to);

  reset({ reservations: stays }, 1000);
  const rows = await listStaysForCleaning(now);
  eq(rows.length, expected.length, 'listStaysForCleaning: every stay in the window, through the cap');
  eq(
    state.log[0].params.getAll('stay_end').join('|'),
    `gte.${iso(from)}|lt.${iso(to)}`,
    'listStaysForCleaning: [now − lookback, now + 1 day) on the wire',
  );
  eq(
    state.log[0].params.get('select'),
    'id,unit_id,stay_end,stay_type,late_checkout_hours,status',
    'listStaysForCleaning: select on the wire (no guest or money columns)',
  );

  reset({ reservations: stays }, 1000);
  state.failAt = 1;
  await rejects(() => listStaysForCleaning(now), 'listStaysForCleaning: a failed second page rejects', /boom/);
}

// Every request in every scenario above was understood by the strict model:
// a 400 would have surfaced as a rejected load.
server.close();
done();
