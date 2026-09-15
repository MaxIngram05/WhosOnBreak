import {
  DAYS_PER_WEEK,
  MINUTES_PER_DAY,
  clock,
  type MinuteOfDay,
  type MinuteOfWeek,
} from "./time";
import {
  duration,
  normalize,
  splitWeekWrap,
  subtract,
  type Interval,
} from "./intervals";

/** One person's committed time for a repeating week. */
export interface ParticipantSchedule {
  userId: string;
  busy: Interval[];
}

/** A span where two or more participants are simultaneously free. */
export interface BreakSegment {
  start: MinuteOfWeek;
  end: MinuteOfWeek;
  /** Sorted, so segments with the same people compare equal. */
  userIds: string[];
}

/**
 * The slice of each day worth reporting on. Without it, every night counts as
 * a shared break and the results are useless.
 */
export interface DayWindow {
  startMinute: MinuteOfDay;
  endMinute: MinuteOfDay;
}

export const DEFAULT_DAY_WINDOW: DayWindow = {
  startMinute: clock(8),
  endMinute: clock(22),
};

export interface FindBreaksOptions {
  /** Waking hours to consider. Defaults to 8:00 through 22:00. */
  dayWindow?: DayWindow;
  /** Discard anything too short to be useful. Defaults to 15 minutes. */
  minDurationMinutes?: number;
  /** How many people must be free at once. Defaults to 2. */
  minParticipants?: number;
}

/** The day window expanded across all seven days of the minute-of-week axis. */
export function weekWindows(window: DayWindow = DEFAULT_DAY_WINDOW): Interval[] {
  const windows: Interval[] = [];
  for (let day = 0; day < DAYS_PER_WEEK; day++) {
    const offset = day * MINUTES_PER_DAY;
    windows.push({
      start: offset + window.startMinute,
      end: offset + window.endMinute,
    });
  }
  return normalize(windows);
}

/** One person's free time: the day windows minus everything they are busy for. */
export function freeTime(
  busy: readonly Interval[],
  window: DayWindow = DEFAULT_DAY_WINDOW,
): Interval[] {
  const bounded = busy.flatMap(splitWeekWrap);
  return subtract(weekWindows(window), bounded);
}

type SweepEvent = {
  at: MinuteOfWeek;
  /** -1 closes a free span, +1 opens one. Closes run first at a shared point. */
  delta: -1 | 1;
  userId: string;
};

/**
 * Find every span where enough participants are simultaneously free.
 *
 * This is a sweep line over the minute-of-week axis. Each participant's free
 * time contributes an open and a close event; between consecutive event points
 * the set of free people is constant, so each gap becomes a candidate segment.
 * Adjacent candidates holding the identical set are then merged back together.
 *
 * Because each segment carries the exact set of people, the partial case falls
 * out for free: "three of your five friends are free at 12:10" needs no extra
 * pass.
 */
export function findBreaks(
  participants: readonly ParticipantSchedule[],
  options: FindBreaksOptions = {},
): BreakSegment[] {
  const window = options.dayWindow ?? DEFAULT_DAY_WINDOW;
  const minDuration = options.minDurationMinutes ?? 15;
  const minParticipants = options.minParticipants ?? 2;

  if (participants.length < minParticipants) return [];

  const events: SweepEvent[] = [];
  for (const participant of participants) {
    for (const span of freeTime(participant.busy, window)) {
      events.push({ at: span.start, delta: 1, userId: participant.userId });
      events.push({ at: span.end, delta: -1, userId: participant.userId });
    }
  }
  if (events.length === 0) return [];

  events.sort((a, b) => a.at - b.at || a.delta - b.delta);

  const active = new Set<string>();
  const candidates: BreakSegment[] = [];
  let index = 0;

  while (index < events.length) {
    const at = events[index]!.at;

    // Apply every event landing on this exact minute before measuring.
    while (index < events.length && events[index]!.at === at) {
      const event = events[index]!;
      if (event.delta === 1) active.add(event.userId);
      else active.delete(event.userId);
      index++;
    }

    if (index >= events.length) break;
    const next = events[index]!.at;
    if (next > at && active.size >= minParticipants) {
      candidates.push({
        start: at,
        end: next,
        userIds: [...active].sort(),
      });
    }
  }

  return mergeAdjacent(candidates).filter(
    (segment) => duration(segment) >= minDuration,
  );
}

/** Everyone in the group free at once, which is the headline case in the UI. */
export function findCommonBreaks(
  participants: readonly ParticipantSchedule[],
  options: Omit<FindBreaksOptions, "minParticipants"> = {},
): BreakSegment[] {
  return findBreaks(participants, {
    ...options,
    minParticipants: participants.length,
  });
}

/** Group segments by weekday for rendering. Index 0 is Monday. */
export function groupByWeekday(segments: readonly BreakSegment[]): BreakSegment[][] {
  const days: BreakSegment[][] = Array.from({ length: DAYS_PER_WEEK }, () => []);
  for (const segment of segments) {
    const day = Math.floor(segment.start / MINUTES_PER_DAY);
    days[day]?.push(segment);
  }
  return days;
}

function mergeAdjacent(segments: readonly BreakSegment[]): BreakSegment[] {
  const merged: BreakSegment[] = [];
  for (const segment of segments) {
    const last = merged[merged.length - 1];
    if (last && last.end === segment.start && sameUsers(last.userIds, segment.userIds)) {
      last.end = segment.end;
    } else {
      merged.push({ ...segment, userIds: [...segment.userIds] });
    }
  }
  return merged;
}

function sameUsers(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}
