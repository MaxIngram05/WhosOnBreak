/**
 * The whole app models a repeating week as a single integer axis:
 * minute-of-week, where 0 is Monday 00:00 and 10079 is Sunday 23:59.
 *
 * This keeps every schedule comparison to plain integer arithmetic and keeps
 * timezones out of stored data entirely. Conversion to a viewer's local clock
 * happens only at render time.
 */

export const MINUTES_PER_HOUR = 60;
export const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
export const DAYS_PER_WEEK = 7;
export const MINUTES_PER_WEEK = DAYS_PER_WEEK * MINUTES_PER_DAY;

/** An integer in [0, MINUTES_PER_WEEK). */
export type MinuteOfWeek = number;

/** An integer in [0, MINUTES_PER_DAY). */
export type MinuteOfDay = number;

/** Monday is 0 so that the school week reads left to right without wrapping. */
export const Weekday = {
  Monday: 0,
  Tuesday: 1,
  Wednesday: 2,
  Thursday: 3,
  Friday: 4,
  Saturday: 5,
  Sunday: 6,
} as const;

export type Weekday = (typeof Weekday)[keyof typeof Weekday];

export const WEEKDAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export const WEEKDAY_SHORT_NAMES = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
] as const;

/** Combine a weekday and a time-of-day into a single minute-of-week. */
export function toMinuteOfWeek(day: Weekday, minuteOfDay: MinuteOfDay): MinuteOfWeek {
  return day * MINUTES_PER_DAY + minuteOfDay;
}

/** Which weekday a minute-of-week falls on. */
export function weekdayOf(minute: MinuteOfWeek): Weekday {
  return (Math.floor(minute / MINUTES_PER_DAY) % DAYS_PER_WEEK) as Weekday;
}

/** How far into its own day a minute-of-week sits. */
export function minuteOfDayOf(minute: MinuteOfWeek): MinuteOfDay {
  return ((minute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/** Wrap any integer onto the [0, MINUTES_PER_WEEK) axis. */
export function wrapWeek(minute: number): MinuteOfWeek {
  return ((minute % MINUTES_PER_WEEK) + MINUTES_PER_WEEK) % MINUTES_PER_WEEK;
}

/** Build a time-of-day from hours and minutes, e.g. clock(9, 30) is 570. */
export function clock(hours: number, minutes = 0): MinuteOfDay {
  return hours * MINUTES_PER_HOUR + minutes;
}

/** Parse "09:30" or "9:30" into minutes into the day. Throws on malformed input. */
export function parseClock(value: string): MinuteOfDay {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) throw new Error(`Not a HH:MM time: "${value}"`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new Error(`Time out of range: "${value}"`);
  return clock(hours, minutes);
}

/** Render a time-of-day, e.g. "9:30 AM" or "09:30". */
export function formatTime(minuteOfDay: MinuteOfDay, hour12 = true): string {
  const total = ((minuteOfDay % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours24 = Math.floor(total / MINUTES_PER_HOUR);
  const minutes = total % MINUTES_PER_HOUR;
  const mm = String(minutes).padStart(2, "0");

  if (!hour12) return `${String(hours24).padStart(2, "0")}:${mm}`;

  const suffix = hours24 < 12 ? "AM" : "PM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${mm} ${suffix}`;
}

/** Render a minute-of-week, e.g. "Mon 9:30 AM". */
export function formatMinuteOfWeek(minute: MinuteOfWeek, hour12 = true): string {
  const day = WEEKDAY_SHORT_NAMES[weekdayOf(minute)];
  return `${day} ${formatTime(minuteOfDayOf(minute), hour12)}`;
}

/** Render a span of minutes as "45m", "1h" or "1h 15m". */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / MINUTES_PER_HOUR);
  const rest = total % MINUTES_PER_HOUR;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

/** Snap a minute to the nearest step, used when a dragged block is dropped. */
export function snapTo(minute: number, stepMinutes: number): number {
  if (stepMinutes <= 0) return minute;
  return Math.round(minute / stepMinutes) * stepMinutes;
}
