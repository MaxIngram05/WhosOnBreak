import { MINUTES_PER_WEEK, type MinuteOfWeek } from "./time";

/**
 * A half-open span [start, end) on the minute-of-week axis.
 *
 * Half-open matters: a class ending at 10:00 and one starting at 10:00 do not
 * overlap, and the gap between them is correctly zero rather than one minute.
 */
export interface Interval {
  start: MinuteOfWeek;
  end: MinuteOfWeek;
}

export function duration(interval: Interval): number {
  return Math.max(0, interval.end - interval.start);
}

export function isEmpty(interval: Interval): boolean {
  return interval.end <= interval.start;
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

export function contains(interval: Interval, minute: MinuteOfWeek): boolean {
  return minute >= interval.start && minute < interval.end;
}

export function totalMinutes(intervals: readonly Interval[]): number {
  return intervals.reduce((sum, interval) => sum + duration(interval), 0);
}

/**
 * A block entered as "Sunday 23:00 for two hours" runs past the end of the
 * week. Split it so every interval stays inside [0, MINUTES_PER_WEEK).
 */
export function splitWeekWrap(interval: Interval): Interval[] {
  if (isEmpty(interval)) return [];
  if (interval.end <= MINUTES_PER_WEEK) return [{ ...interval }];
  return [
    { start: interval.start, end: MINUTES_PER_WEEK },
    { start: 0, end: interval.end - MINUTES_PER_WEEK },
  ].filter((piece) => !isEmpty(piece));
}

/**
 * Sort, drop empties, and merge anything overlapping or touching into the
 * smallest equivalent set of disjoint intervals.
 */
export function normalize(intervals: readonly Interval[]): Interval[] {
  const sorted = intervals
    .filter((interval) => !isEmpty(interval))
    .map((interval) => ({ ...interval }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end);
    } else {
      merged.push(interval);
    }
  }
  return merged;
}

/** Everything in `from` that is not also in `remove`. */
export function subtract(
  from: readonly Interval[],
  remove: readonly Interval[],
): Interval[] {
  const base = normalize(from);
  const cuts = normalize(remove);
  const result: Interval[] = [];

  for (const segment of base) {
    let cursor = segment.start;
    for (const cut of cuts) {
      if (cut.end <= cursor) continue;
      if (cut.start >= segment.end) break;
      if (cut.start > cursor) {
        result.push({ start: cursor, end: Math.min(cut.start, segment.end) });
      }
      cursor = Math.max(cursor, cut.end);
      if (cursor >= segment.end) break;
    }
    if (cursor < segment.end) {
      result.push({ start: cursor, end: segment.end });
    }
  }
  return result;
}

/** Everything present in both sets. */
export function intersect(
  a: readonly Interval[],
  b: readonly Interval[],
): Interval[] {
  const left = normalize(a);
  const right = normalize(b);
  const result: Interval[] = [];

  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    const x = left[i]!;
    const y = right[j]!;
    const start = Math.max(x.start, y.start);
    const end = Math.min(x.end, y.end);
    if (start < end) result.push({ start, end });
    if (x.end < y.end) i++;
    else j++;
  }
  return result;
}
