import type { HousekeepingStatus, ReservationStatus, StayType } from '@/types/database';

/**
 * The cleaning state of a unit, DERIVED from two things:
 *   - the unit's last cleaning mark (a housekeeping_tasks row), and
 *   - the moment the last stay on it ENDED.
 *
 * A unit is "Kirli" when a stay on it has ended after its last cleaning mark.
 * The stay's END TIME decides — not its status (owner rule, 2026-10-07).
 *
 * Why not the status: the database writes a "Kirli" mark when a stay CHANGES to
 * "Tamamlandı" (migration 061). A stay that already is "Tamamlandı" while the
 * guest is still in the room never changes again, so it never produced a mark.
 * That happened in production two ways — a stay entered after midnight with
 * yesterday as its check-in date (checkout = today, so the form saves it as
 * "Tamamlandı" at once), and a stay completed by the job and then extended with
 * "Uzat", which moves the checkout but not the status. End times have neither
 * problem, and they follow an extension by themselves.
 *
 * The marks the database still writes (061) are simply marks like any other:
 * the latest one counts, unless a stay has ended since. So nothing changes for
 * the ordinary stay, and a guest checked out early by hand still turns the unit
 * "Kirli" on the spot.
 *
 * Derived, never stored — like the payment status. tests/cleaningState.check.mjs
 * replays the production cases hour by hour.
 */

/** Default for a unit nobody has marked and nobody has stayed in. */
export const DEFAULT_CLEANING_STATUS: HousekeepingStatus = 'DIRTY';

/** The part of a unit's latest housekeeping_tasks row this rule reads. */
export interface CleaningMark {
  status: HousekeepingStatus;
  updated_at: string;
}

/** The part of a reservation that decides when its unit needs cleaning. */
export interface StayForCleaning {
  unit_id: string | null;
  stay_end: string | null;
  stay_type: StayType;
  late_checkout_hours: number | null;
  status: ReservationStatus;
}

export interface CleaningState {
  status: HousekeepingStatus;
  /** Set when the unit is Kirli because a stay ended after its last mark: when that stay ended (ISO). */
  stayEndedAt: string | null;
}

const HOUR_MS = 3600_000;

/**
 * An overnight stay's stay_end is UTC midnight of the checkout date. Checkout
 * is 11:00 Istanbul (UTC+3, no DST) = 08:00 UTC, plus the Geç Çıkış hours.
 * This is the same arithmetic as the auto-complete job (migration 075):
 *   stay_end + interval '8 hours' + late_checkout_hours * interval '1 hour'
 * The two must stay in step — the test compares it with checkoutTimeLabel().
 */
const CHECKOUT_OFFSET_HOURS = 8;

/**
 * The moment (epoch ms) the guest is due out. Day-use: its own end time.
 * NaN when the end date cannot be read.
 */
export function stayEndsAt(stay: Pick<StayForCleaning, 'stay_end' | 'stay_type' | 'late_checkout_hours'>): number {
  const end = stay.stay_end ? Date.parse(stay.stay_end) : NaN;
  if (Number.isNaN(end)) return NaN;
  if (stay.stay_type === 'DAYUSE') return end;
  return end + (CHECKOUT_OFFSET_HOURS + (stay.late_checkout_hours ?? 0)) * HOUR_MS;
}

/**
 * unit_id → the latest moment (epoch ms) a stay on that unit ended, at or
 * before `now`. Every stay counts except a cancelled one: a stay whose status
 * is wrong must still dirty its room. A stay with no unit (its birim was
 * deleted) or an unreadable end date is skipped.
 */
export function latestEndedStayPerUnit(
  stays: readonly StayForCleaning[],
  now: number,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const stay of stays) {
    if (!stay.unit_id || stay.status === 'cancelled') continue;
    const endsAt = stayEndsAt(stay);
    if (Number.isNaN(endsAt) || endsAt > now) continue;
    const known = out.get(stay.unit_id);
    if (known === undefined || endsAt > known) out.set(stay.unit_id, endsAt);
  }
  return out;
}

/**
 * One unit: its last cleaning mark against the last stay that ended on it.
 * A mark made at or after the end stands; anything older is overridden by
 * "Kirli". A mark whose time cannot be read never hides an ended stay — a room
 * cleaned twice costs less than one not cleaned.
 */
export function cleaningState(
  mark: CleaningMark | undefined,
  stayEndedAt: number | undefined,
): CleaningState {
  if (stayEndedAt !== undefined) {
    const markedAt = mark ? Date.parse(mark.updated_at) : NaN;
    if (!(markedAt >= stayEndedAt)) {
      return { status: 'DIRTY', stayEndedAt: new Date(stayEndedAt).toISOString() };
    }
  }
  return { status: mark?.status ?? DEFAULT_CLEANING_STATUS, stayEndedAt: null };
}

/** The state of each unit asked for. `latestMarks` is unit_id → its newest mark. */
export function cleaningStateByUnit(
  unitIds: readonly string[],
  latestMarks: ReadonlyMap<string, CleaningMark>,
  stays: readonly StayForCleaning[],
  now: number,
): Map<string, CleaningState> {
  const ended = latestEndedStayPerUnit(stays, now);
  const out = new Map<string, CleaningState>();
  for (const unitId of unitIds) {
    out.set(unitId, cleaningState(latestMarks.get(unitId), ended.get(unitId)));
  }
  return out;
}
