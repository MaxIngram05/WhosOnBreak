/**
 * Projecting a stored week onto a viewer's clock.
 *
 * The rest of core is deliberately timezone-free: a schedule is a set of
 * intervals on the minute-of-week axis and nothing else. That is what keeps
 * comparison to integer arithmetic. The cost is that two people in different
 * zones cannot be compared until one of them is re-projected onto the other's
 * axis, and the shift is not a constant because of daylight saving.
 *
 * So the projection is always resolved against a *concrete week*. "Monday
 * 09:00" is not an instant; "Monday 09:00 in Europe/London during the week of
 * 2026-03-30" is. Only once the week is pinned can an offset be computed, and
 * only then does a DST transition land on the right side of the right block.
 *
 * Everything here goes through Intl, which carries the IANA database the host
 * already ships. No timezone table of our own, and no dependency.
 */

import {
  MINUTES_PER_DAY,
  MINUTES_PER_HOUR,
  MINUTES_PER_WEEK,
  type MinuteOfWeek,
} from "./time";
import { splitWeekWrap, type Interval } from "./intervals";

/** A calendar date with no time and no zone, as three plain numbers. */
export interface CalendarDate {
  year: number;
  month: number; // 1-12, not the 0-11 that Date uses
  day: number;
}

interface ZonedParts extends CalendarDate {
  hour: number;
  minute: number;
  /** Monday is 0, matching the Weekday enum in ./time. */
  weekday: number;
}

const MS_PER_MINUTE = 60_000;

/** Intl weekday short names in the order Date.getUTCDay uses (Sunday first). */
const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(zone);
  if (cached) return cached;

  // Constructing these is expensive relative to everything else we do, and a
  // group comparison hits the same handful of zones over and over.
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  formatterCache.set(zone, formatter);
  return formatter;
}

/** Throws if the zone is not one the runtime's IANA database knows. */
export function isValidTimeZone(zone: string): boolean {
  try {
    formatterFor(zone);
    return true;
  } catch {
    return false;
  }
}

function partsIn(zone: string, instant: Date): ZonedParts {
  const parts = formatterFor(zone).formatToParts(instant);
  const lookup: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") lookup[part.type] = part.value;
  }

  const weekday = WEEKDAY_INDEX[lookup.weekday ?? ""];
  if (weekday === undefined) {
    throw new Error(`Could not read a weekday for zone "${zone}"`);
  }

  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    hour: Number(lookup.hour),
    minute: Number(lookup.minute),
    weekday,
  };
}

/**
 * Minutes east of UTC in `zone` at a given instant. London in July is +60,
 * New York in July is -240.
 */
export function offsetMinutesFor(zone: string, instant: Date): number {
  const parts = partsIn(zone, instant);
  const asIfUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
  );
  // instant's own seconds are irrelevant to an offset, which is always whole
  // minutes for every zone still in use.
  const flooredInstant = Math.floor(instant.getTime() / MS_PER_MINUTE) * MS_PER_MINUTE;
  return (asIfUtc - flooredInstant) / MS_PER_MINUTE;
}

/**
 * The instant at which a given wall-clock time occurs in `zone`.
 *
 * Wall time to instant is the awkward direction, because the offset we need to
 * subtract depends on the answer we are computing. Worse, on two days a year
 * the question has no answer or two of them.
 *
 * We sample the offset a day either side of the naive instant, which brackets
 * any transition, and turn each sample into a candidate. A candidate is real
 * only if the zone agrees it is: converting it back must land on the wall time
 * we asked for.
 *
 * - Both real and different: the clocks went back and this time happened
 *   twice. We take the first occurrence.
 * - Neither real: the clocks went forward and this time never happened. We
 *   resolve forward, so 02:30 on a day that jumps 02:00 to 03:00 becomes
 *   03:30, which keeps a block after the gap rather than before it.
 * - Otherwise: an ordinary time, with one answer.
 */
export function zonedWallTimeToInstant(
  zone: string,
  date: CalendarDate,
  minuteOfDay: number,
): Date {
  const naive =
    Date.UTC(date.year, date.month - 1, date.day) + minuteOfDay * MS_PER_MINUTE;
  const oneDay = MINUTES_PER_DAY * MS_PER_MINUTE;

  const offsetBefore = offsetMinutesFor(zone, new Date(naive - oneDay));
  const offsetAfter = offsetMinutesFor(zone, new Date(naive + oneDay));

  const fromBefore = naive - offsetBefore * MS_PER_MINUTE;
  const fromAfter = naive - offsetAfter * MS_PER_MINUTE;

  const earlier = Math.min(fromBefore, fromAfter);
  const later = Math.max(fromBefore, fromAfter);

  const earlierIsReal = isRealInstantFor(zone, naive, earlier);
  const laterIsReal = isRealInstantFor(zone, naive, later);

  if (earlierIsReal) return new Date(earlier);
  if (laterIsReal) return new Date(later);
  return new Date(later);
}

/** Does `candidate` actually read back as the wall time `naive` describes? */
function isRealInstantFor(zone: string, naive: number, candidate: number): boolean {
  const offset = offsetMinutesFor(zone, new Date(candidate));
  return naive - offset * MS_PER_MINUTE === candidate;
}

/** Where an instant falls on `zone`'s minute-of-week axis. */
export function minuteOfWeekIn(zone: string, instant: Date): MinuteOfWeek {
  const parts = partsIn(zone, instant);
  return (
    parts.weekday * MINUTES_PER_DAY +
    parts.hour * MINUTES_PER_HOUR +
    parts.minute
  );
}

/** Where we are right now on `zone`'s axis. Drives the "on break now" screen. */
export function nowAsMinuteOfWeek(zone: string, now: Date = new Date()): MinuteOfWeek {
  return minuteOfWeekIn(zone, now);
}

/**
 * The calendar date of the Monday beginning the week that contains `instant`,
 * as read in `zone`.
 */
export function startOfWeekIn(zone: string, instant: Date): CalendarDate {
  const parts = partsIn(zone, instant);
  // Step back in whole UTC days. Day length in the zone may vary across a DST
  // boundary, but the calendar date never skips, so reading the date back out
  // of the zone after each step is safe.
  const shifted = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day) -
      parts.weekday * MINUTES_PER_DAY * MS_PER_MINUTE,
  );
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** The instant a stored minute-of-week refers to, during a particular week. */
export function minuteOfWeekToInstant(
  zone: string,
  weekStart: CalendarDate,
  minute: MinuteOfWeek,
): Date {
  return zonedWallTimeToInstant(zone, weekStart, minute);
}

/**
 * Re-project intervals stored on `fromZone`'s axis onto `toZone`'s axis, for
 * the week containing `reference`.
 *
 * Both endpoints are converted independently rather than converting the start
 * and re-adding the duration. A lesson that runs 09:00-10:00 local is an hour
 * of wall clock on both sides of a DST change, but across the change itself it
 * is not an hour of elapsed time -- and what the viewer needs to see is when
 * the other person is actually unavailable, which is elapsed time.
 *
 * An interval pushed past the end of the week wraps around, so the result may
 * hold more intervals than the input.
 */
export function shiftToZone(
  intervals: readonly Interval[],
  fromZone: string,
  toZone: string,
  reference: Date = new Date(),
): Interval[] {
  // The overwhelmingly common case: a group of classmates at one school.
  if (fromZone === toZone) return intervals.map((interval) => ({ ...interval }));

  const weekStart = startOfWeekIn(fromZone, reference);
  const result: Interval[] = [];

  for (const interval of intervals) {
    const startInstant = minuteOfWeekToInstant(fromZone, weekStart, interval.start);
    const endInstant = minuteOfWeekToInstant(fromZone, weekStart, interval.end);

    const start = minuteOfWeekIn(toZone, startInstant);
    let end = minuteOfWeekIn(toZone, endInstant);

    // An interval that ends exactly at the week boundary reads back as minute
    // 0, which would look empty rather than full-length.
    if (end === 0 && interval.end > interval.start) end = MINUTES_PER_WEEK;

    if (end > start) {
      result.push({ start, end });
    } else {
      // The shift pushed it over the week boundary, so it now occupies the end
      // of the week and the beginning of it.
      result.push(...splitWeekWrap({ start, end: end + MINUTES_PER_WEEK }));
    }
  }

  return result;
}
