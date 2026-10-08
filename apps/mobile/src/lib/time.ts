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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The Monday of the week `weeks` weeks from this one, on the phone's calendar. */
function mondayOf(weeks: number): Date {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - todayIndex() + weeks * 7);
  return date;
}

/** "This week", "Next week", "Last week", or "Week of 19 Oct". */
export function weekLabel(weeks: number): string {
  if (weeks === 0) return 'This week';
  if (weeks === 1) return 'Next week';
  if (weeks === -1) return 'Last week';
  const monday = mondayOf(weeks);
  return `Week of ${monday.getDate()} ${MONTHS[monday.getMonth()]}`;
}

/** "5 – 11 Oct", or "29 Sep – 5 Oct" across a month. */
export function weekRange(weeks: number): string {
  const monday = mondayOf(weeks);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const start =
    monday.getMonth() === sunday.getMonth()
      ? `${monday.getDate()}`
      : `${monday.getDate()} ${MONTHS[monday.getMonth()]}`;
  return `${start} – ${sunday.getDate()} ${MONTHS[sunday.getMonth()]}`;
}

/** The calendar date of a day in the week `weeks` from this one: "Tue 14". */
export function dayDate(weeks: number, day: number): string {
  const date = mondayOf(weeks);
  date.setDate(date.getDate() + day);
  return `${dayName(day)} ${date.getDate()}`;
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
