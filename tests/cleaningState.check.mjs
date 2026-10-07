// Fixture for src/lib/cleaningState.ts — imports the REAL module.
// Run: node tests/cleaningState.check.mjs
//
// A unit is "Kirli" when a stay on it has ENDED after the last cleaning mark —
// decided by the stay's end time, not by the reservation's status (owner rule,
// 2026-10-07).
//
// Why: the old rule wrote a "Kirli" mark only when a stay CHANGED to
// "Tamamlandı". A stay that already was "Tamamlandı" while the guest was still
// in the room never changed again, so its unit was never marked. Two ways that
// happened in production, both reproduced below with the real dates:
//   B5 — entered at 00:45 for a guest who arrived after midnight, check-in
//        dated the day before, one night: checkout = today, so the form saved it
//        as "Tamamlandı" at once. Extended later; still "Tamamlandı".
//   B2 — a one-night stay completed by the job at 11:02, then extended seven
//        times with "Uzat", which moves the checkout but never the status.
import './support/alias.mjs';
import { createHarness, id } from './support/harness.mjs';

const { stayEndsAt, latestEndedStayPerUnit, cleaningState, cleaningStateByUnit, DEFAULT_CLEANING_STATUS } =
  await import(new URL('../src/lib/cleaningState.ts', import.meta.url).href);
const { checkoutTimeLabel } = await import(new URL('../src/lib/utils.ts', import.meta.url).href);
const { ok, eq, done } = createHarness('cleaningState');

/** An instant written the way people say it: Istanbul wall-clock time. */
const ist = (s) => Date.parse(`${s}:00+03:00`);
const istIso = (s) => new Date(ist(s)).toISOString();
/** Overnight checkout is stored as UTC midnight of the checkout date. */
const checkout = (date) => `${date}T00:00:00.000Z`;

const overnight = (unit, checkoutDate, extra = {}) => ({
  unit_id: unit,
  stay_end: checkout(checkoutDate),
  stay_type: 'OVERNIGHT',
  late_checkout_hours: 0,
  status: 'active',
  ...extra,
});
const dayuse = (unit, endIstanbul, extra = {}) => ({
  unit_id: unit,
  stay_end: istIso(endIstanbul),
  stay_type: 'DAYUSE',
  late_checkout_hours: 0,
  status: 'active',
  ...extra,
});
const mark = (status, atIstanbul) => ({ status, updated_at: istIso(atIstanbul) });

const B2 = id(2);
const B5 = id(5);
const D7 = id(7);
const NO4 = id(4);

// ── 1. When a stay ends ──────────────────────────────────────────────────────
{
  eq(stayEndsAt(overnight(B2, '2026-10-06')), ist('2026-10-06T11:00'), 'overnight: ends 11:00 Istanbul on the checkout date');
  eq(stayEndsAt(overnight(B2, '2026-10-06', { late_checkout_hours: 2 })), ist('2026-10-06T13:00'), 'overnight + 2 h Geç Çıkış: 13:00');
  eq(stayEndsAt(overnight(B2, '2026-10-06', { late_checkout_hours: 4 })), ist('2026-10-06T15:00'), 'overnight + 4 h Geç Çıkış: 15:00');
  eq(stayEndsAt(overnight(B2, '2026-10-06', { late_checkout_hours: null })), ist('2026-10-06T11:00'), 'overnight, no Geç Çıkış value: 11:00');
  eq(stayEndsAt(dayuse(B5, '2026-10-03T21:00')), ist('2026-10-03T21:00'), 'day-use: ends at its own end time');
  eq(stayEndsAt(dayuse(B5, '2026-10-03T21:00', { late_checkout_hours: 3 })), ist('2026-10-03T21:00'), 'day-use: Geç Çıkış does not apply');
  ok(Number.isNaN(stayEndsAt({ ...overnight(B2, '2026-10-06'), stay_end: 'nonsense' })), 'an unreadable end date is not a time');
  ok(Number.isNaN(stayEndsAt({ ...overnight(B2, '2026-10-06'), stay_end: null })), 'a missing end date is not a time');

  // The rule and the checkout time shown on the reservation must agree.
  for (let late = 0; late <= 4; late++) {
    const at = new Date(stayEndsAt(overnight(B2, '2026-10-06', { late_checkout_hours: late })));
    const istanbul = new Intl.DateTimeFormat('tr-TR', {
      timeZone: 'Europe/Istanbul',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(at);
    eq(istanbul, checkoutTimeLabel(late), `Geç Çıkış ${late}: same hour as the label on the reservation`);
  }
  // The status plays no part in when a stay ends.
  for (const status of ['pending', 'upcoming', 'active', 'completed', 'cancelled']) {
    eq(stayEndsAt(overnight(B2, '2026-10-06', { status })), ist('2026-10-06T11:00'), `end time does not depend on status (${status})`);
  }
}

// ── 2. The latest ended stay per unit ────────────────────────────────────────
{
  const now = ist('2026-10-06T11:00');
  const stays = [
    overnight(B2, '2026-10-06', { status: 'completed' }), // ends exactly now
    overnight(B2, '2026-09-27', { status: 'completed' }), // older
    overnight(B5, '2026-10-07'), // not ended yet
    overnight(D7, '2026-10-06', { status: 'cancelled' }), // never counts
    overnight(null, '2026-10-06', { status: 'completed' }), // its birim was deleted
    dayuse(NO4, '2026-10-06T10:30'),
    dayuse(NO4, '2026-10-06T12:00'), // not ended yet
  ];
  const latest = latestEndedStayPerUnit(stays, now);
  eq(latest.get(B2), ist('2026-10-06T11:00'), 'the newest ended stay wins; a stay ending exactly now has ended');
  eq(latest.has(B5), false, 'a stay whose end is still ahead does not count');
  eq(latest.has(D7), false, 'a cancelled stay never counts');
  eq(latest.get(NO4), ist('2026-10-06T10:30'), 'day-use: only the one that has ended');
  eq(latest.size, 2, 'a stay without a unit is skipped');
  eq(latestEndedStayPerUnit(stays, ist('2026-10-06T10:59')).get(B2), ist('2026-09-27T11:00'), 'one minute before checkout the stay has not ended');

  // Date, not status: every status except cancelled counts once its end passes.
  for (const status of ['pending', 'upcoming', 'active', 'completed']) {
    const m = latestEndedStayPerUnit([overnight(B2, '2026-10-06', { status })], now);
    eq(m.get(B2), ist('2026-10-06T11:00'), `an ended stay counts whatever its status (${status})`);
  }
  eq(latestEndedStayPerUnit([], now).size, 0, 'no stays: nothing');
  eq(
    latestEndedStayPerUnit([{ ...overnight(B2, '2026-10-06'), stay_end: 'nonsense' }], now).size,
    0,
    'a stay with an unreadable end date is skipped, not treated as ended',
  );
}

// ── 3. One unit: last cleaning mark versus last ended stay ───────────────────
{
  const ended = ist('2026-10-06T11:00');
  const state = (m, e) => cleaningState(m, e);

  let s = state(mark('CLEAN', '2026-10-04T13:31'), ended);
  eq(s.status, 'DIRTY', 'cleaned BEFORE the stay ended → Kirli');
  eq(s.stayEndedAt, new Date(ended).toISOString(), '…and it says when the stay ended');

  s = state(mark('CLEAN', '2026-10-06T12:30'), ended);
  eq(s.status, 'CLEAN', 'cleaned AFTER the stay ended → Temiz');
  eq(s.stayEndedAt, null, '…with no stay to blame');

  eq(state(mark('IN_PROGRESS', '2026-10-06T11:40'), ended).status, 'IN_PROGRESS', '"Temizleniyor" set after the stay ended is kept');
  eq(state(mark('IN_PROGRESS', '2026-10-06T10:00'), ended).status, 'DIRTY', '"Temizleniyor" from before the stay ended does not survive it');
  s = state(mark('DIRTY', '2026-10-06T11:02'), ended);
  eq(s.status, 'DIRTY', 'a Kirli mark after the end stays Kirli');
  eq(s.stayEndedAt, null, '…as a plain mark');

  eq(state(mark('CLEAN', '2026-10-06T11:00'), ended).status, 'CLEAN', 'a mark at the very end moment wins');

  s = state(undefined, ended);
  eq(s.status, 'DIRTY', 'no mark at all, a stay ended → Kirli');
  eq(s.stayEndedAt, new Date(ended).toISOString(), '…because of that stay');

  s = state(undefined, undefined);
  eq(s.status, DEFAULT_CLEANING_STATUS, 'no mark and no stay → the default');
  eq(DEFAULT_CLEANING_STATUS, 'DIRTY', 'the default is Kirli, as before');
  eq(s.stayEndedAt, null, '…with no stay to blame');

  eq(state(mark('CLEAN', '2026-10-06T09:00'), undefined).status, 'CLEAN', 'no ended stay → the mark decides');
  // Fail towards cleaning: a room cleaned twice costs less than one not cleaned.
  eq(state({ status: 'CLEAN', updated_at: 'nonsense' }, ended).status, 'DIRTY', 'a mark with an unreadable time cannot hide an ended stay');
}

// ── 4. The production cases, hour by hour ────────────────────────────────────
{
  const at = (stays, marks, now) => cleaningStateByUnit([B2, B5, D7, NO4], marks, stays, ist(now));

  // B5 — born "Tamamlandı" (after-midnight arrival), then extended to 6 Oct.
  // The old rule never marked it. Last mark: "Temiz" on 4 Oct 13:31.
  const b5 = [overnight(B5, '2026-10-06', { status: 'completed' })];
  const b5marks = new Map([[B5, mark('CLEAN', '2026-10-04T13:31')]]);
  eq(at(b5, b5marks, '2026-10-05T12:00').get(B5).status, 'CLEAN', 'B5: Temiz while the guest is staying');
  eq(at(b5, b5marks, '2026-10-06T10:59').get(B5).status, 'CLEAN', 'B5: still Temiz one minute before checkout');
  eq(at(b5, b5marks, '2026-10-06T11:00').get(B5).status, 'DIRTY', 'B5: Kirli at 11:00 on the checkout day — although it was "Tamamlandı" all along');
  eq(at(b5, b5marks, '2026-10-07T09:00').get(B5).status, 'DIRTY', 'B5: stays Kirli until someone cleans it');
  const b5cleaned = new Map([[B5, mark('CLEAN', '2026-10-06T12:30')]]);
  eq(at(b5, b5cleaned, '2026-10-07T09:00').get(B5).status, 'CLEAN', 'B5: Temiz once it is cleaned after checkout');

  // B2 — one night (28→29 Sep), completed by the job on the 29th at 11:02 (which
  // wrote a Kirli mark), then extended step by step to 6 Oct while "Tamamlandı".
  const b2short = [overnight(B2, '2026-09-29', { status: 'completed' })];
  const b2long = [overnight(B2, '2026-10-06', { status: 'completed' })];
  const cleanBefore = new Map([[B2, mark('CLEAN', '2026-09-28T03:22')]]);
  eq(at(b2short, cleanBefore, '2026-09-29T11:00').get(B2).status, 'DIRTY', 'B2: Kirli at its first checkout');
  // After the extension the stay has not ended any more, so it no longer makes
  // the unit Kirli on its own — the last mark decides again.
  eq(at(b2long, cleanBefore, '2026-10-03T12:00').get(B2).status, 'CLEAN', 'B2: once extended, the stay no longer counts as ended');
  eq(at(b2long, cleanBefore, '2026-10-06T10:59').get(B2).status, 'CLEAN', 'B2: Temiz until the real checkout');
  eq(at(b2long, cleanBefore, '2026-10-06T11:00').get(B2).status, 'DIRTY', 'B2: Kirli at the REAL checkout — the case the old rule missed');
  // If a cleaner tidied the room mid-stay, the real checkout still dirties it.
  const cleanedMidStay = new Map([[B2, mark('CLEAN', '2026-10-02T15:00')]]);
  eq(at(b2long, cleanedMidStay, '2026-10-06T11:00').get(B2).status, 'DIRTY', 'B2: a mid-stay cleaning does not cover the checkout');

  // D7 and No.4 — the two stays that were "Tamamlandı" with the guest inside on
  // the morning of 7 Oct (entered just after midnight, checkout the same day).
  const tonight = [
    overnight(D7, '2026-10-07', { status: 'completed' }),
    overnight(NO4, '2026-10-07', { status: 'completed' }),
  ];
  const cleanYesterday = new Map([
    [D7, mark('CLEAN', '2026-10-06T14:00')],
    [NO4, mark('CLEAN', '2026-10-06T15:00')],
  ]);
  let s = at(tonight, cleanYesterday, '2026-10-07T09:00');
  eq(s.get(D7).status, 'CLEAN', 'D7: Temiz in the morning, guest still in');
  eq(s.get(NO4).status, 'CLEAN', 'No.4: Temiz in the morning, guest still in');
  s = at(tonight, cleanYesterday, '2026-10-07T11:00');
  eq(s.get(D7).status, 'DIRTY', 'D7: Kirli at 11:00');
  eq(s.get(NO4).status, 'DIRTY', 'No.4: Kirli at 11:00');

  // A normal stay — completed by the job, which also writes its own Kirli mark
  // at 11:02. Both rules agree; nothing changes for the ordinary case.
  const normal = [overnight(B2, '2026-10-06', { status: 'completed' })];
  const jobMark = new Map([[B2, mark('DIRTY', '2026-10-06T11:02')]]);
  eq(at(normal, jobMark, '2026-10-06T11:05').get(B2).status, 'DIRTY', 'normal stay: Kirli, as before');
  const cleanedAfter = new Map([[B2, mark('CLEAN', '2026-10-06T13:00')]]);
  eq(at(normal, cleanedAfter, '2026-10-06T13:05').get(B2).status, 'CLEAN', 'normal stay: Temiz after cleaning, as before');

  // A guest who leaves early: staff set "Tamamlandı" by hand, the trigger writes
  // a Kirli mark at once. That still works — the mark is simply the latest thing.
  const early = [overnight(B2, '2026-10-08', { status: 'completed' })];
  const earlyMark = new Map([[B2, mark('DIRTY', '2026-10-06T09:10')]]);
  eq(at(early, earlyMark, '2026-10-06T09:15').get(B2).status, 'DIRTY', 'early checkout by hand: Kirli straight away, as before');

  // Late checkout moves the moment.
  const late = [overnight(B2, '2026-10-06', { late_checkout_hours: 3 })];
  eq(at(late, cleanBefore, '2026-10-06T13:59').get(B2).status, 'CLEAN', 'Geç Çıkış +3: not yet at 13:59');
  eq(at(late, cleanBefore, '2026-10-06T14:00').get(B2).status, 'DIRTY', 'Geç Çıkış +3: Kirli at 14:00');

  // Back-to-back: A leaves at 11:00, the room is cleaned, B arrives the same day.
  const turnover = [
    overnight(B2, '2026-10-06', { status: 'completed' }),
    overnight(B2, '2026-10-08', { status: 'active' }),
  ];
  const turnoverMarks = new Map([[B2, mark('CLEAN', '2026-10-06T12:15')]]);
  eq(at(turnover, turnoverMarks, '2026-10-06T16:00').get(B2).status, 'CLEAN', 'same-day turnover: Temiz for the next guest');
  eq(at(turnover, turnoverMarks, '2026-10-08T11:00').get(B2).status, 'DIRTY', 'same-day turnover: Kirli again when the next guest leaves');

  // A cancelled stay never dirties a room.
  const cancelled = [overnight(B2, '2026-10-06', { status: 'cancelled' })];
  eq(at(cancelled, cleanBefore, '2026-10-06T12:00').get(B2).status, 'CLEAN', 'a cancelled stay does not make the unit Kirli');

  // Every unit asked for gets an answer; units with nothing known get the default.
  const all = at([], new Map(), '2026-10-06T12:00');
  eq(all.size, 4, 'one state per unit asked for');
  eq([...all.values()].every((v) => v.status === 'DIRTY' && v.stayEndedAt === null), true, 'nothing known → default Kirli');
  // Stays and marks of other units do not leak in.
  const other = cleaningStateByUnit([B2], new Map([[B5, mark('CLEAN', '2026-10-06T12:00')]]), [overnight(B5, '2026-10-06')], ist('2026-10-06T12:00'));
  eq(other.size, 1, 'only the units asked for');
  eq(other.get(B2).status, 'DIRTY', 'another unit’s mark or stay does not affect this one');
}

done();
