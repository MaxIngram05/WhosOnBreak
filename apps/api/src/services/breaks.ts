/**
 * Turning stored schedules into the answer the app exists to give.
 *
 * This file does four things and deliberately not a fifth: it resolves which
 * week and whose clock we are talking about, projects everybody onto that one
 * axis, calls into packages/core, and attaches names to the result.
 *
 * The break-finding itself is not here and is not in SQL. It is the sweep line
 * in packages/core, already tested to death, and the only way to keep it that
 * way is to have exactly one implementation of it.
 */

import {
  DEFAULT_DAY_WINDOW,
  contains,
  findBreaks,
  formatCalendarDate,
  freeTime,
  MINUTES_PER_DAY,
  nowAsMinuteOfWeek,
  shiftToZone,
  startOfWeekIn,
  zonedWallTimeToInstant,
  type BreakSegment as CoreBreakSegment,
  type CalendarDate,
  type DayWindow,
  type Interval,
  type ParticipantSchedule,
} from "@whosonbreak/core";
import type {
  Block,
  BreakQuery,
  BreaksResponse,
  OnBreakNowResponse,
  PublicUser,
} from "@whosonbreak/contracts";
import type { Sql } from "../db/sql.ts";
import {
  loadComparableSchedules,
  weekIndexAt,
  type ComparableSchedule,
} from "../repositories/schedules.ts";

/** A person we were asked about, whether or not they have a schedule. */
export interface Candidate {
  user: PublicUser;
  schedule: ComparableSchedule | undefined;
}

/**
 * Pairs each person with their active schedule -- one query for all of them,
 * however many there are. Who may be asked about is the caller's decision and
 * must already have been made.
 */
export async function loadCandidates(
  sql: Sql,
  users: readonly PublicUser[],
  viewerId: string,
): Promise<Candidate[]> {
  const schedules = await loadComparableSchedules(
    sql,
    users.map((user) => user.id),
    viewerId,
  );
  const byUser = new Map(schedules.map((schedule) => [schedule.userId, schedule]));
  return users.map((user) => ({ user, schedule: byUser.get(user.id) }));
}

const WEDNESDAY_NOON = 3 * 24 * 60 + 12 * 60;

/**
 * Pins the week and the clock that the whole comparison is resolved against.
 *
 * The reference instant is the middle of Wednesday rather than the start of
 * Monday. Anchoring at a boundary means a participant fourteen hours away is
 * arguably in the previous or the next week, and each of them would then
 * project onto a different seven days. Mid-week, every zone on earth agrees
 * which week it is.
 */
function resolveWeek(
  viewerZone: string,
  now: Date,
  week: string | undefined,
): { weekStart: CalendarDate; reference: Date } {
  // Noon, so a date-only string cannot land on the wrong side of a zone shift.
  const base = week ? new Date(`${week}T12:00:00Z`) : now;
  const weekStart = startOfWeekIn(viewerZone, base);

  return {
    weekStart,
    reference: zonedWallTimeToInstant(viewerZone, weekStart, WEDNESDAY_NOON),
  };
}

function resolveDayWindow(query: BreakQuery): DayWindow {
  const startMinute = query.dayStartMinute ?? DEFAULT_DAY_WINDOW.startMinute;
  const endMinute = query.dayEndMinute ?? DEFAULT_DAY_WINDOW.endMinute;
  return { startMinute, endMinute };
}

/**
 * Which clock to answer in: what was asked for, else the viewer's own
 * schedule, else UTC. Never a participant's zone picked arbitrarily, which
 * would make the same group render differently depending on who joined first.
 */
export function resolveViewerZone(
  query: BreakQuery,
  viewerSchedule: ComparableSchedule | undefined,
): string {
  return query.timeZone ?? viewerSchedule?.timeZone ?? "UTC";
}

/**
 * The blocks that apply in the week being resolved: all of them for a one-week
 * schedule, and only Week A's or Week B's for a rotating one.
 *
 * The week is read in the schedule's own zone, which is the same week
 * `shiftToZone` projects from. One approximation is accepted: when zones differ,
 * a block shifted across the week boundary wraps onto the same cycle week
 * rather than the neighbouring one. That only touches the few hours around
 * Sunday midnight that the offset spans, which sit outside any sane day window.
 */
function blocksForWeek(schedule: ComparableSchedule, reference: Date): Block[] {
  if (schedule.cycleWeeks === 1) return schedule.blocks;
  const week = weekIndexAt(schedule, reference);
  return schedule.blocks.filter((block) => block.weekIndex === week);
}

function toIntervals(blocks: readonly Block[]): Interval[] {
  return blocks.map((block) => ({ start: block.start, end: block.end }));
}

/** Each candidate's busy time, expressed on the viewer's axis. */
function toParticipants(
  candidates: readonly Candidate[],
  viewerZone: string,
  reference: Date,
): ParticipantSchedule[] {
  const participants: ParticipantSchedule[] = [];

  for (const candidate of candidates) {
    if (!candidate.schedule) continue;

    const busy = toIntervals(blocksForWeek(candidate.schedule, reference));

    participants.push({
      userId: candidate.user.id,
      // A no-op when the zones match, which for a class of schoolmates is
      // every time.
      busy: shiftToZone(busy, candidate.schedule.timeZone, viewerZone, reference),
    });
  }

  return participants;
}

export interface ComputeBreaksInput {
  candidates: readonly Candidate[];
  viewerId: string;
  query: BreakQuery;
  now: Date;
}

export function computeBreaks(input: ComputeBreaksInput): BreaksResponse {
  const viewerSchedule = input.candidates.find(
    (candidate) => candidate.user.id === input.viewerId,
  )?.schedule;

  const viewerZone = resolveViewerZone(input.query, viewerSchedule);
  const { weekStart, reference } = resolveWeek(viewerZone, input.now, input.query.week);

  const participants = toParticipants(input.candidates, viewerZone, reference);
  const usersById = new Map(input.candidates.map((c) => [c.user.id, c.user]));

  const segments: CoreBreakSegment[] = findBreaks(participants, {
    dayWindow: resolveDayWindow(input.query),
    minDurationMinutes: input.query.minDurationMinutes,
    minParticipants: input.query.minParticipants,
  });

  return {
    timeZone: viewerZone,
    weekStart: formatCalendarDate(weekStart),
    segments: segments.map((segment) => ({
      start: segment.start,
      end: segment.end,
      durationMinutes: segment.end - segment.start,
      users: segment.userIds
        .map((id) => usersById.get(id))
        .filter((user): user is PublicUser => user !== undefined),
    })),
    // Surfaced rather than silently dropped: somebody with no schedule is not
    // busy, they have not finished signing up, and the UI should nudge them
    // instead of implying they are unavailable.
    excluded: input.candidates
      .filter((candidate) => !candidate.schedule)
      .map((candidate) => candidate.user),
  };
}

export interface OnBreakNowInput {
  candidates: readonly Candidate[];
  viewerId: string;
  query: BreakQuery;
  now: Date;
}

/**
 * The home screen: who is free at this exact minute, and for how much longer.
 *
 * Computed per person rather than by filtering the segment list, because "you
 * are free for another 40 minutes" is about *your* free span, which may be
 * longer than any segment you happen to share with someone else.
 */
export function computeOnBreakNow(input: OnBreakNowInput): OnBreakNowResponse {
  const viewerSchedule = input.candidates.find(
    (candidate) => candidate.user.id === input.viewerId,
  )?.schedule;

  const viewerZone = resolveViewerZone(input.query, viewerSchedule);
  const { reference } = resolveWeek(viewerZone, input.now, undefined);
  const window = resolveDayWindow(input.query);
  const nowMinute = nowAsMinuteOfWeek(viewerZone, input.now);

  const onBreak: OnBreakNowResponse["onBreak"] = [];
  const busy: OnBreakNowResponse["busy"] = [];
  const unknown: PublicUser[] = [];

  for (const candidate of input.candidates) {
    if (!candidate.schedule) {
      unknown.push(candidate.user);
      continue;
    }

    const { timeZone } = candidate.schedule;
    const blocks = blocksForWeek(candidate.schedule, reference);
    const shifted = shiftToZone(toIntervals(blocks), timeZone, viewerZone, reference);

    const free = freeTime(shifted, window);
    const current = free.find((span) => contains(span, nowMinute));

    if (current) {
      onBreak.push({
        ...candidate.user,
        until: current.end,
        freeForMinutes: current.end - nowMinute,
      });
    } else {
      // Either in a class, or outside the reporting window entirely -- asleep
      // counts as unavailable, which is the honest answer.
      const today = Math.floor(nowMinute / MINUTES_PER_DAY);
      const next = free.find((span) => span.start > nowMinute);

      // Shifted one at a time so a label stays attached to its own interval.
      // Labels were already stripped by the repository wherever the owner's
      // visibility forbids them, so this cannot reveal one by accident.
      const inBlock = blocks.find((block) =>
        shiftToZone([block], timeZone, viewerZone, reference).some((span) =>
          contains(span, nowMinute),
        ),
      );

      busy.push({
        ...candidate.user,
        until:
          next && Math.floor(next.start / MINUTES_PER_DAY) === today ? next.start : null,
        label: inBlock?.label ?? null,
      });
    }
  }

  // Longest remaining free time first: the most useful person to message.
  onBreak.sort((a, b) => b.freeForMinutes - a.freeForMinutes);

  return {
    timeZone: viewerZone,
    nowMinuteOfWeek: nowMinute,
    onBreak,
    busy,
    unknown,
  };
}
