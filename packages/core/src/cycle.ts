/**
 * Multi-week timetables: "Week A" and "Week B".
 *
 * Many schools run a timetable that repeats every two weeks rather than every
 * one. The minute-of-week axis stays exactly as it is; a schedule simply holds
 * one set of blocks per week of its cycle, and the only new question is which
 * of those sets applies to a given calendar week.
 *
 * That is answered by counting whole weeks from an anchor -- a Monday the user
 * has said is Week A -- and taking the remainder. Schools that restart at Week
 * A after a holiday break the pure count, which is why the anchor is something
 * the user can reset rather than something we derive once and keep.
 */

import type { CalendarDate } from "./timezone";

const MS_PER_DAY = 24 * 60 * 60_000;

/** Days from `from` to `to`, negative when `to` is earlier. */
export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  const a = Date.UTC(from.year, from.month - 1, from.day);
  const b = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((b - a) / MS_PER_DAY);
}

/** `date` moved by a whole number of days. */
export function addDays(date: CalendarDate, days: number): CalendarDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day) + days * MS_PER_DAY);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** The Monday on or before `date`. */
export function mondayOf(date: CalendarDate): CalendarDate {
  const utcDay = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  // getUTCDay counts from Sunday; our weeks start on Monday.
  const sinceMonday = (utcDay + 6) % 7;
  return addDays(date, -sinceMonday);
}

/**
 * Which week of a `cycleWeeks`-long cycle the week starting `weekStart` is,
 * when the week starting on `anchor`'s Monday is week 0.
 *
 * Works in either direction from the anchor: the week before a Week A anchor
 * in a two-week cycle is Week B, not an error.
 */
export function cycleWeekIndex(
  anchor: CalendarDate,
  weekStart: CalendarDate,
  cycleWeeks: number,
): number {
  if (!Number.isInteger(cycleWeeks) || cycleWeeks < 1) {
    throw new Error(`A cycle has to be a whole number of weeks, got ${cycleWeeks}`);
  }
  if (cycleWeeks === 1) return 0;

  const weeks = Math.floor(daysBetween(mondayOf(anchor), mondayOf(weekStart)) / 7);
  // JavaScript's % keeps the sign of the dividend; a cycle index never should.
  return ((weeks % cycleWeeks) + cycleWeeks) % cycleWeeks;
}

/**
 * The anchor that makes the week starting `weekStart` be week `index`.
 *
 * This is the "this week is Week B" button: rather than asking someone what
 * date term started, ask what this week is and work backwards.
 */
export function anchorForCurrentWeek(weekStart: CalendarDate, index: number): CalendarDate {
  return addDays(mondayOf(weekStart), -7 * index);
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses `YYYY-MM-DD`, rejecting dates that do not exist such as 2026-02-30. */
export function parseCalendarDate(value: string): CalendarDate {
  const match = DATE_PATTERN.exec(value);
  if (!match) throw new Error(`Expected YYYY-MM-DD, got "${value}"`);

  const date = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  const roundTrip = new Date(Date.UTC(date.year, date.month - 1, date.day));
  if (
    roundTrip.getUTCFullYear() !== date.year ||
    roundTrip.getUTCMonth() + 1 !== date.month ||
    roundTrip.getUTCDate() !== date.day
  ) {
    throw new Error(`"${value}" is not a real date`);
  }
  return date;
}

export function formatCalendarDate(date: CalendarDate): string {
  const month = String(date.month).padStart(2, "0");
  const day = String(date.day).padStart(2, "0");
  return `${date.year}-${month}-${day}`;
}
