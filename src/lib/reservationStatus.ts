import type { ReservationStatus, StayType } from '@/types/database';
import { stayEndsAt } from '@/lib/cleaningState';

/**
 * When a reservation may be "Tamamlandı".
 *
 * A stay must not be completed while the guest is still in the room. A completed
 * stay does not block another booking on the same unit (the EXCLUDE constraint
 * skips completed stays — migration 066), is not charged by nightly auto-debit
 * (088 charges only 'active' stays), and never got its unit marked for cleaning.
 * Production had such stays, two ways; the two functions here close them
 * (owner decision, 2026-10-07). Both use stayEndsAt(), i.e. the very moment the
 * auto-complete job (075) flips a stay — so the form, "Uzat" and the job can
 * never disagree about whether a stay is over.
 */

/** Istanbul is UTC+3 all year (no DST since 2016). */
const ISTANBUL_OFFSET_MS = 3 * 3600_000;

/** "YYYY-MM-DD" of an instant on the Istanbul calendar. */
function istanbulDate(at: number): string {
  return new Date(at + ISTANBUL_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Default status for a NEW reservation, from its dates: a future stay is
 * 'upcoming', one in progress 'active', one that is over 'completed'.
 * (A daily cron later promotes 'upcoming' → 'active' on the check-in day.)
 *
 * An overnight stay is over at its checkout HOUR (11:00 Istanbul on the
 * checkout date), not at the first minute of that date. The old rule said
 * "checkout <= today → completed", which saved a stay as completed for the whole
 * of its checkout day — including the guest who arrives after midnight and is
 * entered with yesterday as the check-in date and one night. That stay was
 * "Tamamlandı" from the minute it was created, with the guest in the room.
 *
 * Day-use stays are single-day, so checkout-date equals checkin-date: an
 * overnight-style rule would wrongly mark a day-use booking on today as already
 * finished. They are active for their single day; the job completes them at
 * their end time.
 *
 * `checkinStr` / `checkoutStr` are "YYYY-MM-DD" as the form holds them.
 */
export function defaultStatusForNewStay(
  checkinStr: string,
  checkoutStr: string,
  stayType: StayType,
  now: Date,
): ReservationStatus {
  const today = istanbulDate(now.getTime());
  if (stayType === 'DAYUSE') {
    if (checkinStr > today) return 'upcoming';
    if (checkinStr < today) return 'completed';
    return 'active';
  }
  if (checkinStr > today) return 'upcoming';

  // Same stay_end the form will save: UTC midnight of the checkout date. A new
  // reservation has no Geç Çıkış yet (it is set later, on the reservation).
  const endsAt = stayEndsAt({
    stay_end: `${checkoutStr}T00:00:00Z`,
    stay_type: 'OVERNIGHT',
    late_checkout_hours: 0,
  });
  // A date that cannot be read is the form's validation to refuse, not this
  // function's to interpret: answer exactly as the old date-only rule did.
  if (Number.isNaN(endsAt)) return checkoutStr <= today ? 'completed' : 'active';
  return endsAt <= now.getTime() ? 'completed' : 'active';
}

/**
 * The status a stay must take when "Uzat" / "Kısalt" moves its checkout to
 * `newStayEnd` — or null when the status must be left alone.
 *
 * Only one case changes anything: EXTENDING a 'completed' stay to a checkout
 * that is still ahead. The guest is staying on, so the stay is running again:
 * 'active' (or 'upcoming' in the odd case that it has not started yet — the
 * same split the form makes). Left completed, it would stay completed for good:
 * the job only completes 'active' / 'upcoming' stays.
 *
 * Everything else is deliberately untouched:
 *   - any other status — Uzat never revives a cancelled or pending stay;
 *   - an extension whose new checkout has already passed (correcting an old
 *     record) — the stay is still over;
 *   - Kısalt — a guest checked out early by hand keeps "Tamamlandı" while the
 *     record is shortened to the real date;
 *   - unreadable dates — never a reason to reopen a stay.
 *
 * Setting the status back makes the stay count for double-booking again, so the
 * database may refuse the extension when the unit has been booked by someone
 * else in the meantime. That refusal is the point.
 */
export function statusAfterStayShift(
  stay: {
    status: ReservationStatus;
    stay_start: string;
    stay_type: StayType;
    late_checkout_hours: number | null;
  },
  newStayEnd: string,
  deltaDays: number,
  now: number,
): ReservationStatus | null {
  if (deltaDays <= 0 || stay.status !== 'completed') return null;

  const endsAt = stayEndsAt({
    stay_end: newStayEnd,
    stay_type: stay.stay_type,
    late_checkout_hours: stay.late_checkout_hours,
  });
  if (Number.isNaN(endsAt) || endsAt <= now) return null;

  return runningStatus(stay.stay_start, now);
}

/**
 * The status of a stay that is running (or about to): 'upcoming' when its
 * check-in falls on a later Istanbul day, else 'active' — the same split
 * defaultStatusForNewStay makes. Null when the check-in cannot be read.
 */
function runningStatus(stayStart: string, now: number): ReservationStatus | null {
  const startsAt = Date.parse(stayStart);
  if (Number.isNaN(startsAt)) return null;
  return istanbulDate(startsAt) > istanbulDate(now) ? 'upcoming' : 'active';
}

/**
 * The shared rule behind the other two ways a stay's end can move — changing
 * the dates in Düzenle, and Geç Çıkış: a 'completed' stay whose end is moved
 * LATER, to a moment still ahead, is running again. Returns the status it must
 * take, or null when the status must be left alone.
 *
 * `before` is the stay as it was, `after` as the change will save it; the end
 * moment of each comes from stayEndsAt(), so stay_end, the stay type and the
 * Geç Çıkış hours all count.
 *
 * "Moved later" is the heart of it. A completed stay whose end is merely still
 * ahead is NOT reopened: that is the guest checked out early by hand, and
 * editing its note or tutar — or re-saving it untouched — must leave it
 * "Tamamlandı". Only an actual extension says the guest is staying on.
 *
 * Also left alone, as with Uzat: any other status; an end moved earlier; an
 * extension to a moment already past (correcting an old record); unreadable
 * dates.
 */
export function statusAfterEndMoved(
  before: {
    status: ReservationStatus;
    stay_end: string;
    stay_type: StayType;
    late_checkout_hours: number | null;
  },
  after: {
    stay_start: string;
    stay_end: string;
    stay_type: StayType;
    late_checkout_hours: number | null;
  },
  now: number,
): ReservationStatus | null {
  if (before.status !== 'completed') return null;

  const endedAt = stayEndsAt(before);
  const endsAt = stayEndsAt(after);
  if (Number.isNaN(endedAt) || Number.isNaN(endsAt)) return null;
  if (endsAt <= endedAt) return null; // not an extension
  if (endsAt <= now) return null; // extended, but still over

  return runningStatus(after.stay_start, now);
}
