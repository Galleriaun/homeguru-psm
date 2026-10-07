// Fixture for src/lib/reservationStatus.ts — imports the REAL module.
// Run: node tests/reservationStatus.check.mjs
//
// A stay must not be "Tamamlandı" while the guest is still in the room. A
// completed stay does not block another booking on the same unit (the
// double-booking rule ignores completed stays), is not charged by nightly
// auto-debit, and used to leave its unit unmarked for cleaning. Two rules
// (owner decision, 2026-10-07):
//
//   1. A NEW overnight stay whose checkout is today is "Aktif" until the
//      checkout hour (11:00 Istanbul) has passed. It used to be saved as
//      "Tamamlandı" from 00:00 — which caught every guest arriving after
//      midnight and entered with yesterday as the check-in date.
//   2. "Uzat" on a "Tamamlandı" stay sets it back to "Aktif" when the new
//      checkout is still ahead. "Uzat" used to move the date and leave the status.
//   3. The same for the two other ways a stay's end can move later: changing
//      the dates in Düzenle, and Geç Çıkış. One shared rule: a "Tamamlandı"
//      stay whose end is moved LATER, to a moment still ahead, is running again.
import './support/alias.mjs';
import { createHarness } from './support/harness.mjs';

const { defaultStatusForNewStay, statusAfterStayShift, statusAfterEndMoved } = await import(
  new URL('../src/lib/reservationStatus.ts', import.meta.url).href
);
const { ok, eq, done } = createHarness('reservationStatus');

/** An instant written the way people say it: Istanbul wall-clock time. */
const ist = (s) => new Date(`${s}:00+03:00`);
const checkout = (date) => `${date}T00:00:00.000Z`;

// ── 1. Default status of a new stay ──────────────────────────────────────────
{
  const at = (now, checkin, out, type = 'OVERNIGHT') => defaultStatusForNewStay(checkin, out, type, ist(now));

  // The two stays found in production on the morning of 7 Oct 2026: entered just
  // after midnight, check-in dated the day before, one night.
  eq(at('2026-10-07T00:20', '2026-10-06', '2026-10-07'), 'active', 'D7: entered 00:20, checkout today → Aktif (was Tamamlandı)');
  eq(at('2026-10-07T00:10', '2026-10-06', '2026-10-07'), 'active', 'No.4: entered 00:10, checkout today → Aktif (was Tamamlandı)');
  // B5, two days earlier.
  eq(at('2026-10-05T00:45', '2026-10-04', '2026-10-05'), 'active', 'B5: entered 00:45, checkout today → Aktif (was Tamamlandı)');

  // The boundary is the checkout hour, the same moment the job completes a stay.
  eq(at('2026-10-07T10:59', '2026-10-06', '2026-10-07'), 'active', 'checkout today, 10:59 → still Aktif');
  eq(at('2026-10-07T11:00', '2026-10-06', '2026-10-07'), 'completed', 'checkout today, 11:00 → Tamamlandı');
  eq(at('2026-10-07T15:30', '2026-10-06', '2026-10-07'), 'completed', 'checkout today, afternoon → Tamamlandı');
  eq(at('2026-10-07T23:59', '2026-10-06', '2026-10-07'), 'completed', 'checkout today, late evening → Tamamlandı');

  // Everything else is as before.
  eq(at('2026-10-07T00:20', '2026-10-05', '2026-10-06'), 'completed', 'checkout yesterday → Tamamlandı');
  eq(at('2026-10-07T09:00', '2026-10-07', '2026-10-08'), 'active', 'check-in today → Aktif');
  eq(at('2026-10-07T09:00', '2026-10-01', '2026-10-12'), 'active', 'mid-stay → Aktif');
  eq(at('2026-10-07T09:00', '2026-10-08', '2026-10-10'), 'upcoming', 'check-in tomorrow → Yakında');
  eq(at('2026-10-07T23:30', '2026-10-08', '2026-10-09'), 'upcoming', 'check-in tomorrow, late at night → Yakında');

  // "Today" is the Istanbul day: at 00:30 Istanbul it is still yesterday in UTC.
  const justAfterMidnight = new Date('2026-10-06T21:30:00Z'); // 7 Oct 00:30 Istanbul
  eq(defaultStatusForNewStay('2026-10-07', '2026-10-08', 'OVERNIGHT', justAfterMidnight), 'active', 'Istanbul date decides: check-in "today" at 00:30 Istanbul → Aktif');
  eq(defaultStatusForNewStay('2026-10-06', '2026-10-07', 'OVERNIGHT', justAfterMidnight), 'active', 'Istanbul date decides: checkout "today" at 00:30 Istanbul → Aktif');
  eq(defaultStatusForNewStay('2026-10-08', '2026-10-09', 'OVERNIGHT', justAfterMidnight), 'upcoming', 'Istanbul date decides: tomorrow is still tomorrow');

  // Day-use is untouched by this change.
  eq(at('2026-10-07T09:00', '2026-10-07', '2026-10-07', 'DAYUSE'), 'active', 'day-use today → Aktif');
  eq(at('2026-10-07T23:00', '2026-10-07', '2026-10-07', 'DAYUSE'), 'active', 'day-use today, evening → Aktif (the job completes it)');
  eq(at('2026-10-07T09:00', '2026-10-06', '2026-10-06', 'DAYUSE'), 'completed', 'day-use yesterday → Tamamlandı');
  eq(at('2026-10-07T09:00', '2026-10-08', '2026-10-08', 'DAYUSE'), 'upcoming', 'day-use tomorrow → Yakında');

  // ── Nothing else moved: compare with the OLD rule over a grid ─────────────
  // The old rule, verbatim, with "today" passed in.
  const oldRule = (checkin, out, type, today) => {
    if (type === 'DAYUSE') {
      if (checkin > today) return 'upcoming';
      if (checkin < today) return 'completed';
      return 'active';
    }
    if (checkin > today) return 'upcoming';
    if (out <= today) return 'completed';
    return 'active';
  };
  const days = ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'];
  const times = ['00:00', '00:20', '02:59', '03:00', '03:01', '10:59', '11:00', '11:01', '14:00', '20:59', '21:00', '23:59'];
  const today = '2026-10-07';
  let compared = 0;
  let differences = 0;
  let unexpected = 0;
  for (const type of ['OVERNIGHT', 'DAYUSE']) {
    for (const checkin of days) {
      for (const out of days) {
        if (type === 'OVERNIGHT' && out <= checkin) continue; // not a valid overnight stay
        if (type === 'DAYUSE' && out !== checkin) continue; // day-use is one day
        for (const time of times) {
          const now = ist(`${today}T${time}`);
          const was = oldRule(checkin, out, type, today);
          const is = defaultStatusForNewStay(checkin, out, type, now);
          compared++;
          if (was === is) continue;
          differences++;
          const intended =
            type === 'OVERNIGHT' && out === today && time < '11:00' && was === 'completed' && is === 'active';
          if (!intended) {
            unexpected++;
            console.log(`FAIL  unexpected difference: ${type} ${checkin}→${out} at ${time}: was ${was}, is ${is}`);
          }
        }
      }
    }
  }
  ok(compared > 300, `grid: ${compared} combinations compared with the old rule`);
  eq(unexpected, 0, 'grid: the ONLY differences are "overnight, checkout today, before 11:00 → Aktif"');
  ok(differences > 0, 'grid: the intended difference really occurs');
  // 3 valid check-in days before today × 6 times before 11:00.
  eq(differences, 3 * times.filter((t) => t < '11:00').length, 'grid: exactly the expected number of changed cells');

  // A malformed date is not this function's job — it answers as the old rule did.
  eq(defaultStatusForNewStay('2026-10-06', '', 'OVERNIGHT', ist('2026-10-07T09:00')), 'completed', 'empty checkout: same answer as before');
  eq(defaultStatusForNewStay('2026-10-06', 'nonsense', 'OVERNIGHT', ist('2026-10-07T09:00')), 'active', 'unreadable checkout: same answer as before');
}

// ── 2. Status after Uzat / Kısalt ────────────────────────────────────────────
{
  const stay = (extra = {}) => ({
    status: 'completed',
    stay_start: ist('2026-09-28T17:14').toISOString(),
    stay_type: 'OVERNIGHT',
    late_checkout_hours: 0,
    ...extra,
  });
  const shift = (s, newCheckoutDate, delta, now) => statusAfterStayShift(s, checkout(newCheckoutDate), delta, ist(now).getTime());

  // B2, replayed. One night (28→29 Sep), completed by the job on the 29th.
  // 30 Sep 18:41 — first Uzat, to the 30th: that checkout (11:00) has already
  // passed, so the stay is still over.
  eq(shift(stay(), '2026-09-30', +1, '2026-09-30T18:41'), null, 'B2 18:41: extended to a checkout already past → status left alone');
  // 30 Sep 18:42 — second Uzat, to 1 Oct: now the guest is staying on.
  eq(shift(stay(), '2026-10-01', +1, '2026-09-30T18:42'), 'active', 'B2 18:42: extended to tomorrow → Aktif');
  // From here on the stay is Aktif and Uzat has nothing to decide.
  eq(shift(stay({ status: 'active' }), '2026-10-02', +1, '2026-09-30T19:20'), null, 'B2 19:20: already Aktif → status left alone');

  // B5: saved as Tamamlandı at 00:45, extended at 12:29 the same day.
  const b5 = stay({ stay_start: ist('2026-10-04T00:45').toISOString() });
  eq(shift(b5, '2026-10-06', +1, '2026-10-05T12:29'), 'active', 'B5: extended to tomorrow → Aktif');

  // Only a Tamamlandı stay is ever touched.
  for (const status of ['active', 'upcoming', 'pending', 'cancelled']) {
    eq(shift(stay({ status }), '2026-10-01', +1, '2026-09-30T18:42'), null, `Uzat on a ${status} stay → status left alone`);
  }

  // Kısalt never changes the status — a guest checked out early by hand keeps
  // "Tamamlandı" while the record is shortened to the real date.
  eq(shift(stay(), '2026-10-01', -1, '2026-09-30T18:42'), null, 'Kısalt on a Tamamlandı stay → status left alone, even with the checkout ahead');
  eq(shift(stay({ status: 'active' }), '2026-10-01', -1, '2026-09-30T18:42'), null, 'Kısalt on an Aktif stay → status left alone');
  eq(shift(stay(), '2026-10-01', 0, '2026-09-30T18:42'), null, 'no change in nights → status left alone');

  // The boundary is the new checkout moment, Geç Çıkış included.
  eq(shift(stay(), '2026-10-01', +1, '2026-10-01T10:59'), 'active', 'new checkout today, 10:59 → Aktif');
  eq(shift(stay(), '2026-10-01', +1, '2026-10-01T11:00'), null, 'new checkout today, 11:00 → already over, left alone');
  eq(shift(stay({ late_checkout_hours: 3 }), '2026-10-01', +1, '2026-10-01T13:59'), 'active', 'Geç Çıkış +3: 13:59 → Aktif');
  eq(shift(stay({ late_checkout_hours: 3 }), '2026-10-01', +1, '2026-10-01T14:00'), null, 'Geç Çıkış +3: 14:00 → already over, left alone');
  eq(shift(stay({ late_checkout_hours: null }), '2026-10-01', +1, '2026-10-01T10:59'), 'active', 'no Geç Çıkış value → 11:00 applies');

  // Correcting an old record: every date is in the past, nothing is reopened.
  eq(shift(stay(), '2026-09-30', +1, '2026-10-07T09:00'), null, 'extending a stay that ended a week ago → stays Tamamlandı');

  // A Tamamlandı stay that has not started yet (set by hand): back to where the
  // form would have put it.
  const future = stay({ stay_start: ist('2026-10-09T14:00').toISOString() });
  eq(shift(future, '2026-10-12', +1, '2026-10-07T09:00'), 'upcoming', 'check-in on a later day → Yakında');
  const laterToday = stay({ stay_start: ist('2026-10-07T22:00').toISOString() });
  eq(shift(laterToday, '2026-10-09', +1, '2026-10-07T09:00'), 'active', 'check-in later today → Aktif, as the form would say');

  // Unreadable dates never reopen a stay.
  eq(statusAfterStayShift(stay(), 'nonsense', +1, ist('2026-09-30T18:42').getTime()), null, 'unreadable new checkout → status left alone');
  eq(shift(stay({ stay_start: 'nonsense' }), '2026-10-01', +1, '2026-09-30T18:42'), null, 'unreadable check-in → status left alone');
}

// ── 3. The shared rule: a completed stay whose end moves later ───────────────
ok(typeof statusAfterEndMoved === 'function', 'statusAfterEndMoved is exported');
const moved = (before, after, now) =>
  typeof statusAfterEndMoved === 'function' ? statusAfterEndMoved(before, after, ist(now).getTime()) : 'MISSING';

{
  // ---- Düzenle: the dates of a stay are changed in the edit form ----
  // A one-night stay 28→29 Sep, completed by the job on the 29th at 11:02.
  const before = {
    status: 'completed',
    stay_start: ist('2026-09-28T17:14').toISOString(),
    stay_end: checkout('2026-09-29'),
    stay_type: 'OVERNIGHT',
    late_checkout_hours: 0,
  };
  const withEnd = (date, extra = {}) => ({ ...before, stay_end: checkout(date), ...extra });

  eq(moved(before, withEnd('2026-09-30'), '2026-09-29T14:00'), 'active', 'Düzenle: Gece 1 → 2 at 14:00, guest staying on → Aktif');
  eq(moved(before, withEnd('2026-10-06'), '2026-09-29T14:00'), 'active', 'Düzenle: extended by a week → Aktif');

  // Nothing about the end changed: the status is NOT touched, even when the
  // end is still ahead. This is the guest checked out early by hand whose
  // note or tutar is edited afterwards.
  const earlyOut = withEnd('2026-10-03'); // completed by hand on the 29th, record says the 3rd
  eq(moved(earlyOut, { ...earlyOut }, '2026-09-29T14:00'), null, 'Düzenle: dates untouched (only the note / tutar edited) → status left alone');
  eq(
    moved(earlyOut, { ...earlyOut, stay_start: ist('2026-09-28T19:00').toISOString() }, '2026-09-29T14:00'),
    null,
    'Düzenle: only the check-in changed → status left alone',
  );
  // Moved earlier: never reopens.
  eq(moved(earlyOut, withEnd('2026-10-02'), '2026-09-29T14:00'), null, 'Düzenle: checkout moved EARLIER, still ahead → status left alone');
  eq(moved(earlyOut, withEnd('2026-09-29'), '2026-09-29T14:00'), null, 'Düzenle: checkout moved earlier, into the past → status left alone');
  // Moved later, but still in the past: correcting an old record.
  eq(moved(before, withEnd('2026-09-30'), '2026-10-07T09:00'), null, 'Düzenle: old stay extended to a date already past → stays Tamamlandı');
  // The boundary is the new checkout moment.
  eq(moved(before, withEnd('2026-09-30'), '2026-09-30T10:59'), 'active', 'Düzenle: new checkout today, 10:59 → Aktif');
  eq(moved(before, withEnd('2026-09-30'), '2026-09-30T11:00'), null, 'Düzenle: new checkout today, 11:00 → already over');

  // Only a Tamamlandı stay is ever touched.
  for (const status of ['active', 'upcoming', 'pending', 'cancelled']) {
    eq(moved({ ...before, status }, withEnd('2026-09-30'), '2026-09-29T14:00'), null, `Düzenle on a ${status} stay → status left alone`);
  }

  // A stay that has not started yet goes back to Yakında, as the form would say.
  const future = { ...before, stay_start: ist('2026-10-09T14:00').toISOString(), stay_end: checkout('2026-10-10') };
  eq(moved(future, { ...future, stay_end: checkout('2026-10-12') }, '2026-10-07T09:00'), 'upcoming', 'Düzenle: check-in on a later day → Yakında');
  // The check-in the edit SAVES is what counts.
  eq(
    moved(before, withEnd('2026-10-12', { stay_start: ist('2026-10-09T14:00').toISOString() }), '2026-10-07T09:00'),
    'upcoming',
    'Düzenle: check-in moved to a later day in the same edit → Yakında',
  );

  // Day-use: the end is its own end time.
  const dayuse = {
    status: 'completed',
    stay_start: ist('2026-10-07T14:00').toISOString(),
    stay_end: ist('2026-10-07T17:00').toISOString(),
    stay_type: 'DAYUSE',
    late_checkout_hours: 0,
  };
  eq(moved(dayuse, { ...dayuse, stay_end: ist('2026-10-07T19:00').toISOString() }, '2026-10-07T17:30'), 'active', 'Düzenle: day-use end 17:00 → 19:00 at 17:30 → Aktif');
  eq(moved(dayuse, { ...dayuse, stay_end: ist('2026-10-07T17:20').toISOString() }, '2026-10-07T17:30'), null, 'Düzenle: day-use end moved to a time already past → left alone');
  eq(moved(dayuse, { ...dayuse }, '2026-10-07T16:00'), null, 'Düzenle: day-use untouched → left alone');

  // Unreadable dates never reopen a stay.
  eq(moved(before, withEnd('2026-09-30', { stay_end: 'nonsense' }), '2026-09-29T14:00'), null, 'unreadable new end → left alone');
  eq(moved({ ...before, stay_end: 'nonsense' }, withEnd('2026-09-30'), '2026-09-29T14:00'), null, 'unreadable old end → left alone');
  eq(moved(before, withEnd('2026-09-30', { stay_start: 'nonsense' }), '2026-09-29T14:00'), null, 'unreadable check-in → left alone');
}

{
  // ---- Geç Çıkış: the hours past 11:00 are changed ----
  // Checkout day is 6 Oct. The job completed the stay at 11:02.
  const stay = {
    status: 'completed',
    stay_start: ist('2026-10-04T15:00').toISOString(),
    stay_end: checkout('2026-10-06'),
    stay_type: 'OVERNIGHT',
    late_checkout_hours: 0,
  };
  const late = (hours) => ({ ...stay, late_checkout_hours: hours });

  eq(moved(stay, late(2), '2026-10-06T11:10'), 'active', 'Geç Çıkış: +2 h set at 11:10 (checkout now 13:00) → Aktif');
  eq(moved(stay, late(4), '2026-10-06T11:10'), 'active', 'Geç Çıkış: +4 h set at 11:10 → Aktif');
  eq(moved(stay, late(1), '2026-10-06T11:59'), 'active', 'Geç Çıkış: +1 h set at 11:59 → Aktif');
  eq(moved(stay, late(1), '2026-10-06T12:00'), null, 'Geç Çıkış: +1 h set at 12:00 (already 12:00) → left alone');
  eq(moved(stay, late(2), '2026-10-06T13:30'), null, 'Geç Çıkış: +2 h set at 13:30 (13:00 has passed) → left alone');
  eq(moved(stay, late(0), '2026-10-06T10:00'), null, 'Geç Çıkış: same value → left alone');
  eq(moved(late(3), late(1), '2026-10-06T11:10'), null, 'Geç Çıkış: hours REDUCED → left alone');
  eq(moved(late(1), late(3), '2026-10-06T12:30'), 'active', 'Geç Çıkış: +1 → +3 at 12:30 (checkout now 14:00) → Aktif');
  eq(moved({ ...stay, late_checkout_hours: null }, late(2), '2026-10-06T11:10'), 'active', 'Geç Çıkış: no previous value counts as 0');
  // The normal case — set before the job has completed the stay — is not this
  // rule's business at all.
  eq(moved({ ...stay, status: 'active' }, { ...late(2), status: 'active' }, '2026-10-06T09:00'), null, 'Geç Çıkış on an Aktif stay → status left alone');
  // An old stay.
  eq(moved(stay, late(4), '2026-10-09T09:00'), null, 'Geç Çıkış on a stay that ended days ago → left alone');
}

done();
