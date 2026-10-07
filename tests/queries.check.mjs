// Fixture for the list queries that must never be silently truncated.
// Imports the REAL modules from src/lib/queries; only the supabase client is
// replaced by an in-memory fake that enforces a row cap like PostgREST does.
// Run: node tests/queries.check.mjs
import './support/alias.mjs';
import { createHarness, id } from './support/harness.mjs';
import { db } from './support/fakeSupabase.mjs';

const src = (path) => import(new URL(`../src/lib/queries/${path}`, import.meta.url).href);
const { listReservations, listReservationsInRange, listActiveReservations } = await src('reservations.ts');
const { loadReservationsWithPayments, listPendingPaymentsForReservation } = await src('payments.ts');
const { listLedgerForReservation } = await src('ledger.ts');
const { listStaysForCleaning, CLEANING_LOOKBACK_DAYS } = await src('housekeeping.ts');
const { listPricesInRange } = await src('property_nightly_prices.ts');
const { listBlocksInRange } = await src('property_blocks.ts');
const { listNotesInRange } = await src('property_date_notes.ts');

const { ok, eq, rejects, done } = createHarness('queries');

const DAY = 86400000;
const T0 = Date.parse('2023-01-01T11:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
const sortedBy = (rows, key, ascending) =>
  rows.every((r, i) => {
    if (i === 0) return true;
    const d = Date.parse(r[key]) - Date.parse(rows[i - 1][key]);
    return ascending ? d >= 0 : d <= 0;
  });
const allPaged = () =>
  db.requests.every(
    (r) => r.count === 'exact' && r.order && r.order.column === 'id' && r.limit != null,
  );

/** n reservations, one per day from T0, each staying 2 days. Ids are assigned
 *  in a scrambled order so id order is NOT stay_start order. */
function reservations(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: id(((i * 7919) % n) + 1),
    stay_start: iso(T0 + i * DAY),
    stay_end: iso(T0 + (i + 2) * DAY),
    status: i % 10 === 0 ? 'cancelled' : i % 3 === 0 ? 'active' : 'completed',
    stay_type: 'NIGHTLY',
    total_amount: 1000 + i,
  }));
}

// ───── listReservations ─────
// The bug: 1410 reservations, a 1000-row cap. The Liste and Borçlular lost the
// 410 oldest stays.
{
  db.reset();
  db.tables.reservations = reservations(1410);
  db.maxRows = 1000;
  const rows = await listReservations();
  eq(rows.length, 1410, 'listReservations: all 1410 through a 1000 cap');
  eq(new Set(rows.map((r) => r.id)).size, 1410, 'listReservations: no duplicates');
  ok(sortedBy(rows, 'stay_start', false), 'listReservations: newest stay_start first');
  eq(rows[rows.length - 1].stay_start, iso(T0), 'listReservations: the OLDEST stay is present (it used to be dropped)');
  eq(rows[0].stay_start, iso(T0 + 1409 * DAY), 'listReservations: the newest stay is first');
  ok(allPaged(), 'listReservations: every request is counted, id-ordered and limited');
  ok(
    db.requests[0].columns.includes('guest:guests(full_name, phone)') &&
      db.requests[0].columns.includes('total_amount'),
    'listReservations: still selects the joined names and the total',
  );

  db.reset();
  db.tables.reservations = reservations(1410);
  db.maxRows = 10000;
  eq((await listReservations()).length, 1410, 'listReservations: all rows under the cap');
  eq(db.requests.length, 1, 'listReservations: one request when under the cap');

  db.reset();
  db.tables.reservations = [];
  eq((await listReservations()).length, 0, 'listReservations: empty table → []');
}

// The exclusion-constraint error keeps its friendly Turkish translation.
{
  db.reset();
  db.tables.reservations = reservations(5);
  db.beforeRequest = () => ({ error: { message: 'conflict', code: '23P01' } });
  await rejects(() => listReservations(), 'listReservations: errors go through wrapErr', /çakışıyor/);
}

// ───── listReservationsInRange ─────
{
  // Window = days [100, 1300) of the fixture. A stay overlaps when it starts
  // before the window ends AND ends after the window starts (both strict).
  const start = iso(T0 + 100 * DAY);
  const end = iso(T0 + 1300 * DAY);
  const all = reservations(1410);
  const expected = all.filter(
    (r) => Date.parse(r.stay_start) < Date.parse(end) && Date.parse(r.stay_end) > Date.parse(start),
  );

  db.reset();
  db.tables.reservations = all;
  db.maxRows = 1000;
  const rows = await listReservationsInRange(start, end);
  eq(expected.length, 1201, 'fixture sanity: 1201 stays overlap the window');
  eq(rows.length, expected.length, 'listReservationsInRange: every overlapping stay through a 1000 cap');
  const got = new Set(rows.map((r) => r.id));
  ok(expected.every((r) => got.has(r.id)), 'listReservationsInRange: exactly the overlapping stays');
  ok(sortedBy(rows, 'stay_start', true), 'listReservationsInRange: earliest stay_start first');
  ok(allPaged(), 'listReservationsInRange: every request is counted, id-ordered and limited');

  // Boundaries: a stay that ENDS exactly at the window start, and one that
  // STARTS exactly at the window end, do not overlap.
  const endsAtStart = all.find((r) => r.stay_end === start);
  const startsAtEnd = all.find((r) => r.stay_start === end);
  ok(endsAtStart && !got.has(endsAtStart.id), 'listReservationsInRange: stay ending at the window start is excluded');
  ok(startsAtEnd && !got.has(startsAtEnd.id), 'listReservationsInRange: stay starting at the window end is excluded');
  const lastInside = all.find((r) => r.stay_start === iso(T0 + 1299 * DAY));
  const firstInside = all.find((r) => r.stay_end === iso(T0 + 101 * DAY));
  ok(got.has(lastInside.id), 'listReservationsInRange: stay starting the day before the window end is included');
  ok(got.has(firstInside.id), 'listReservationsInRange: stay ending the day after the window start is included');

  db.reset();
  db.tables.reservations = all;
  eq((await listReservationsInRange(start, end)).length, 1201, 'listReservationsInRange: same result with no cap');
  eq(db.requests.length, 1, 'listReservationsInRange: one request when under the cap');
}

// ───── listActiveReservations (shares the select list; not paged) ─────
{
  db.reset();
  db.tables.reservations = reservations(60);
  const rows = await listActiveReservations();
  eq(rows.length, 18, 'listActiveReservations: only active stays');
  ok(rows.every((r) => r.status === 'active'), 'listActiveReservations: all active');
  ok(sortedBy(rows, 'stay_start', false), 'listActiveReservations: newest first');
}

// ───── loadReservationsWithPayments ─────
{
  // 1321 active rows + DISPUTED noise. Reservation k gets payments of 100 each;
  // amounts alternate between number and numeric-string, as PostgREST may send.
  const payments = [];
  let n = 0;
  const expected = new Map();
  for (let i = 0; i < 1321; i++) {
    const reservation_id = id(5000 + (i % 400));
    const status = i % 2 === 0 ? 'CONFIRMED' : 'UNCONFIRMED';
    payments.push({ id: id(((i * 7919) % 1321) + 1), reservation_id, amount: i % 3 === 0 ? '100.00' : 100, status });
    expected.set(reservation_id, (expected.get(reservation_id) ?? 0) + 100);
    n++;
  }
  for (let i = 0; i < 50; i++) {
    payments.push({ id: id(9000 + i), reservation_id: id(5000 + i), amount: 999, status: 'DISPUTED' });
  }

  db.reset();
  db.tables.payment_collections = payments;
  db.maxRows = 1000;
  const map = await loadReservationsWithPayments();
  eq(map.size, 400, 'loadReservationsWithPayments: one entry per reservation');
  let total = 0;
  let exact = true;
  for (const [k, v] of map) {
    total += v;
    if (expected.get(k) !== v) exact = false;
  }
  eq(total, n * 100, 'loadReservationsWithPayments: every active payment summed through a 1000 cap');
  ok(exact, 'loadReservationsWithPayments: each reservation has its exact sum (DISPUTED excluded, strings summed numerically)');
  ok(allPaged(), 'loadReservationsWithPayments: every request is counted, id-ordered and limited');

  db.reset();
  db.tables.payment_collections = payments;
  await loadReservationsWithPayments();
  eq(db.requests.length, 1, 'loadReservationsWithPayments: one request when under the cap');

  // A failed page must reject — an understated sum would mark paid stays unpaid.
  db.reset();
  db.tables.payment_collections = payments;
  db.maxRows = 1000;
  db.beforeRequest = (i) => (i === 1 ? { error: { message: 'network', code: 'X' } } : undefined);
  await rejects(() => loadReservationsWithPayments(), 'loadReservationsWithPayments: a failed page rejects', /network/);

  // An unreadable amount must reject rather than poison a sum with NaN
  // (NaN compares false to everything: the stay would read as fully paid).
  db.reset();
  db.tables.payment_collections = [
    { id: id(1), reservation_id: id(5000), amount: 100, status: 'CONFIRMED' },
    { id: id(2), reservation_id: id(5000), amount: 'abc', status: 'CONFIRMED' },
  ];
  await rejects(() => loadReservationsWithPayments(), 'loadReservationsWithPayments: an unreadable amount rejects', /tutar/);

  // Rows without a reservation are skipped, as before.
  db.reset();
  db.tables.payment_collections = [
    { id: id(1), reservation_id: null, amount: 100, status: 'CONFIRMED' },
    { id: id(2), reservation_id: id(5000), amount: 250, status: 'UNCONFIRMED' },
  ];
  const small = await loadReservationsWithPayments();
  eq(small.size, 1, 'loadReservationsWithPayments: a row without reservation_id is skipped');
  eq(small.get(id(5000)), 250, 'loadReservationsWithPayments: single payment sum');
}

// ───── listPricesInRange ─────
{
  // 3 units × 600 nights from 2026-05-01 = 1800 override rows.
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

  db.reset();
  db.tables.property_nightly_prices = prices;
  db.maxRows = 1000;
  const all = await listPricesInRange(date(0), date(600));
  eq(all.length, 1800, 'listPricesInRange: all 1800 overrides through a 1000 cap');
  ok(sortedBy(all, 'price_date', true), 'listPricesInRange: ordered by date');
  ok(allPaged(), 'listPricesInRange: every request is counted, id-ordered and limited');

  // [start, end): the start date is included, the end date is not.
  db.reset();
  db.tables.property_nightly_prices = prices;
  const window = await listPricesInRange(date(10), date(13));
  eq(window.length, 9, 'listPricesInRange: 3 nights × 3 units');
  ok(window.some((r) => r.price_date === date(10)), 'listPricesInRange: start date included');
  ok(!window.some((r) => r.price_date === date(13)), 'listPricesInRange: end date excluded');

  // With a unit: only that unit's rows — what the reservation form prices from.
  db.reset();
  db.tables.property_nightly_prices = prices;
  const one = await listPricesInRange(date(10), date(40), units[1]);
  eq(one.length, 30, 'listPricesInRange(unit): one row per night');
  ok(one.every((r) => r.unit_id === units[1]), 'listPricesInRange(unit): only the requested unit');
  eq(db.requests.length, 1, 'listPricesInRange(unit): one request');
  ok(
    db.requests[0].ops.some((o) => o.op === 'eq' && o.column === 'unit_id' && o.value === units[1]),
    'listPricesInRange(unit): the unit filter is applied by the server, not in the browser',
  );
}

// ───── listBlocksInRange ─────
{
  const blocks = Array.from({ length: 1200 }, (_, i) => ({
    id: id(((i * 7919) % 1200) + 1),
    block_start: iso(T0 + i * DAY),
    block_end: iso(T0 + (i + 1) * DAY),
  }));
  db.reset();
  db.tables.property_blocks = blocks;
  db.maxRows = 1000;
  const rows = await listBlocksInRange(iso(T0), iso(T0 + 1200 * DAY));
  eq(rows.length, 1200, 'listBlocksInRange: all 1200 through a 1000 cap');
  ok(sortedBy(rows, 'block_start', true), 'listBlocksInRange: ordered by block_start');
  ok(allPaged(), 'listBlocksInRange: every request is counted, id-ordered and limited');

  db.reset();
  db.tables.property_blocks = blocks;
  const part = await listBlocksInRange(iso(T0 + 10 * DAY), iso(T0 + 12 * DAY));
  eq(part.length, 2, 'listBlocksInRange: only blocks overlapping the window (touching edges excluded)');
}

// ───── listNotesInRange ─────
{
  const day0 = Date.parse('2026-05-01T00:00:00Z');
  const date = (i) => new Date(day0 + i * DAY).toISOString().slice(0, 10);
  const notes = Array.from({ length: 1100 }, (_, i) => ({
    id: id(((i * 7919) % 1100) + 1),
    note_date: date(i),
    note: `n${i}`,
  }));
  db.reset();
  db.tables.property_date_notes = notes;
  db.maxRows = 1000;
  const rows = await listNotesInRange(date(0), date(1100));
  eq(rows.length, 1100, 'listNotesInRange: all 1100 through a 1000 cap');
  ok(sortedBy(rows, 'note_date', true), 'listNotesInRange: ordered by date');
  ok(allPaged(), 'listNotesInRange: every request is counted, id-ordered and limited');

  db.reset();
  db.tables.property_date_notes = notes;
  const part = await listNotesInRange(date(5), date(8));
  eq(part.length, 3, 'listNotesInRange: [start, end) — 3 days');
  ok(!part.some((r) => r.note_date === date(8)), 'listNotesInRange: end date excluded');
}

// ───── listPendingPaymentsForReservation ─────
// The Cari Hesap section lists the payments still waiting for approval. Only
// UNCONFIRMED rows of THIS reservation may come back: a CONFIRMED payment is
// already a cari row (it would be counted twice), a DISPUTED one was rejected.
{
  const R = id(7000);
  const fixture = () => [
    { id: id(1), reservation_id: R, amount: 3000, method: 'TRANSFER', status: 'UNCONFIRMED', created_at: iso(T0 + 2 * DAY) },
    { id: id(2), reservation_id: R, amount: '1500.50', method: 'CASH', status: 'UNCONFIRMED', created_at: iso(T0 + 5 * DAY) },
    { id: id(3), reservation_id: R, amount: 2000, method: 'CASH', status: 'CONFIRMED', created_at: iso(T0 + 1 * DAY) },
    { id: id(4), reservation_id: R, amount: 900, method: 'CARD', status: 'DISPUTED', created_at: iso(T0 + 3 * DAY) },
    { id: id(5), reservation_id: id(7001), amount: 777, method: 'CASH', status: 'UNCONFIRMED', created_at: iso(T0 + 4 * DAY) },
  ];

  db.reset();
  db.tables.payment_collections = fixture();
  const rows = await listPendingPaymentsForReservation(R);
  eq(rows.length, 2, 'pending payments: only the UNCONFIRMED rows of this reservation');
  eq(rows.map((r) => r.id).join(','), [id(2), id(1)].join(','), 'pending payments: newest first');
  ok(!rows.some((r) => r.id === id(3)), 'pending payments: a CONFIRMED payment is not pending (it is already a cari row)');
  ok(!rows.some((r) => r.id === id(4)), 'pending payments: a DISPUTED (rejected) payment is not listed');
  ok(!rows.some((r) => r.id === id(5)), 'pending payments: another reservation’s payment is not listed');
  eq(rows[0].amount, 1500.5, 'pending payments: a numeric string becomes a number');
  eq(rows[1].amount, 3000, 'pending payments: amount');
  eq(rows[1].method, 'TRANSFER', 'pending payments: method');
  eq(rows[0].created_at, iso(T0 + 5 * DAY), 'pending payments: collection time');
  eq(Object.keys(rows[0]).sort().join(','), 'amount,created_at,id,method', 'pending payments: exactly the four fields the screen needs');

  eq(db.requests.length, 1, 'pending payments: one request');
  const request = db.requests[0];
  eq(request.table, 'payment_collections', 'pending payments: reads payment_collections');
  ok(
    request.ops.some((o) => o.op === 'eq' && o.column === 'reservation_id' && o.value === R),
    'pending payments: filtered to the reservation',
  );
  ok(
    request.ops.some((o) => o.op === 'eq' && o.column === 'status' && o.value === 'UNCONFIRMED'),
    'pending payments: filtered to UNCONFIRMED',
  );
  eq(request.ops.length, 2, 'pending payments: no other filter');

  db.reset();
  db.tables.payment_collections = fixture();
  eq((await listPendingPaymentsForReservation(id(9999))).length, 0, 'pending payments: none for a reservation without any');

  // An unreadable amount must reject: on this screen it would become a sum.
  for (const bad of ['abc', null, '']) {
    db.reset();
    db.tables.payment_collections = [
      { id: id(1), reservation_id: R, amount: bad, method: 'CASH', status: 'UNCONFIRMED', created_at: iso(T0) },
    ];
    await rejects(
      () => listPendingPaymentsForReservation(R),
      `pending payments: an unreadable amount (${String(bad)}) rejects`,
      /tutar/,
    );
  }

  db.reset();
  db.tables.payment_collections = fixture();
  db.beforeRequest = () => ({ error: { message: 'network', code: 'X' } });
  await rejects(() => listPendingPaymentsForReservation(R), 'pending payments: a failed request rejects', /network/);
}

// ───── listLedgerForReservation ─────
{
  const R = id(7000);
  const fixture = () => [
    { id: id(1), reservation_id: R, type: 'DEBT', amount: 7500, note: 'Otomatik borçlandırma (giriş)', created_at: iso(T0), created_by: null },
    {
      id: id(2),
      reservation_id: R,
      type: 'PAYMENT',
      amount: '2000.00',
      note: 'Ödeme — CASH (onaylandı)',
      created_at: iso(T0 + DAY),
      created_by: id(900),
      payment_collection_id: id(102),
      payment_collection: { method: 'CASH', created_at: iso(T0 + DAY / 2) },
    },
    { id: id(3), reservation_id: id(7001), type: 'DEBT', amount: 1, note: 'başka rezervasyon', created_at: iso(T0), created_by: null },
  ];

  db.reset();
  db.tables.ledger_entries = fixture();
  const rows = await listLedgerForReservation(R);
  eq(rows.length, 2, 'ledger: only this reservation’s rows');
  eq(rows.map((r) => r.id).join(','), [id(2), id(1)].join(','), 'ledger: newest first');
  eq(db.requests.length, 1, 'ledger: one request');
  ok(
    db.requests[0].columns.includes('payment_collection:payment_collections(method, created_at)'),
    'ledger: the linked collection’s method AND date are selected (a Personel is shown when the money was collected)',
  );
  ok(
    db.requests[0].ops.some((o) => o.op === 'eq' && o.column === 'reservation_id' && o.value === R),
    'ledger: filtered to the reservation',
  );

  for (const bad of ['abc', null, '']) {
    db.reset();
    db.tables.ledger_entries = [
      { id: id(1), reservation_id: R, type: 'DEBT', amount: bad, note: 'x', created_at: iso(T0), created_by: null },
    ];
    await rejects(() => listLedgerForReservation(R), `ledger: an unreadable amount (${String(bad)}) rejects`, /tutar/);
  }
}

// ───── listStaysForCleaning ─────
// The Temizlik screen decides "Kirli" from when a stay ENDED, so it needs the
// stays that ended recently (and the ones about to end, so an open screen can
// flip at 11:00 without a reload). A row dropped by the server cap would be a
// room that is never shown as Kirli.
{
  const now = new Date('2026-10-07T06:00:00Z');
  // One stay end every 2 hours, from two days ahead back to ~108 days ago.
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

  db.reset();
  db.tables.reservations = stays;
  db.maxRows = 1000;
  const rows = await listStaysForCleaning(now);
  ok(expected.length > 1000, 'listStaysForCleaning: the fixture really exceeds the 1000-row cap');
  eq(rows.length, expected.length, 'listStaysForCleaning: every stay in the window, through a 1000 cap');
  eq(new Set(rows.map((r) => r.id)).size, expected.length, 'listStaysForCleaning: no duplicates');
  ok(
    rows.every((r) => Date.parse(r.stay_end) >= from && Date.parse(r.stay_end) < to),
    'listStaysForCleaning: nothing outside [now − lookback, now + 1 day)',
  );
  ok(rows.some((r) => Date.parse(r.stay_end) > now.getTime()), 'listStaysForCleaning: stays ending within the next day are included');
  ok(!rows.some((r) => Date.parse(r.stay_end) >= to), 'listStaysForCleaning: stays ending later than that are not');
  ok(allPaged(), 'listStaysForCleaning: every request is counted, id-ordered and limited');
  const request = db.requests[0];
  eq(request.table, 'reservations', 'listStaysForCleaning: reads reservations');
  for (const column of ['id', 'unit_id', 'stay_end', 'stay_type', 'late_checkout_hours', 'status']) {
    ok(request.columns.split(',').map((c) => c.trim()).includes(column), `listStaysForCleaning: selects ${column}`);
  }
  ok(!/guest|total_amount|deposit|note/.test(request.columns), 'listStaysForCleaning: no guest or money columns — cleaning staff load this');
  ok(
    request.ops.some((o) => o.op === 'gte' && o.column === 'stay_end' && Date.parse(o.value) === from),
    'listStaysForCleaning: lower bound is now − lookback',
  );
  ok(
    request.ops.some((o) => o.op === 'lt' && o.column === 'stay_end' && Date.parse(o.value) === to),
    'listStaysForCleaning: upper bound is now + 1 day',
  );
  ok(CLEANING_LOOKBACK_DAYS >= 30, 'listStaysForCleaning: looks back at least a month');

  db.reset();
  db.tables.reservations = [];
  eq((await listStaysForCleaning(now)).length, 0, 'listStaysForCleaning: empty table → []');

  db.reset();
  db.tables.reservations = stays;
  db.maxRows = 1000;
  db.beforeRequest = (i) => (i === 1 ? { error: { message: 'network', code: 'X' } } : undefined);
  await rejects(() => listStaysForCleaning(now), 'listStaysForCleaning: a failed page rejects', /network/);
}

done();
