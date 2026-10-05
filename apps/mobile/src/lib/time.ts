/**
 * Display helpers over the minute-of-week axis from @whosonbreak/core.
 */

import {
  MINUTES_PER_DAY,
  WEEKDAY_SHORT_NAMES,
  formatDuration,
  formatTime,
  minuteOfDayOf,
  weekdayOf,
} from '@whosonbreak/core';

export { formatDuration, formatTime };

/** "Mon 12:30" */
export function formatSlot(minuteOfWeek: number): string {
  const day = WEEKDAY_SHORT_NAMES[weekdayOf(minuteOfWeek)] ?? '';
  return `${day} ${formatTime(minuteOfDayOf(minuteOfWeek), false)}`;
}

/** "12:30–13:15", with the end shown as 24:00 rather than 00:00 at midnight. */
export function formatRange(start: number, end: number): string {
  const startDay = Math.floor(start / MINUTES_PER_DAY);
  const endOfDay = end - startDay * MINUTES_PER_DAY;
  const endText = endOfDay >= MINUTES_PER_DAY ? '24:00' : formatTime(endOfDay, false);
  return `${formatTime(minuteOfDayOf(start), false)}–${endText}`;
}

export function dayName(day: number): string {
  return WEEKDAY_SHORT_NAMES[day] ?? '';
}

/** Today's position on the week, Monday = 0, in the phone's own clock. */
export function todayIndex(): number {
  return (new Date().getDay() + 6) % 7;
}

/** YYYY-MM-DD for a date `weeks` weeks from today, for picking a week. */
export function weekParam(weeks: number): string {
  const date = new Date();
  date.setDate(date.getDate() + weeks * 7);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** "AB12-CD34": the friend code the way people read it. */
export function displayCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

/** What a friend QR code contains: a link that opens the app on "add friend". */
export function friendLink(code: string): string {
  return `whosonbreak://friend/${code}`;
}

/** Pulls a friend code out of a scanned QR, whether it is a link or bare text. */
export function codeFromScan(data: string): string | null {
  const match = /friend\/([A-Za-z0-9-]{8,9})/.exec(data) ?? /^([A-Za-z0-9-]{8,9})$/.exec(data.trim());
  return match?.[1]?.replace(/-/g, '').toUpperCase() ?? null;
}
