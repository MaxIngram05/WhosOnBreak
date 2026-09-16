import { describe, it, expect } from "vitest";
import {
  DEFAULT_DAY_WINDOW,
  findBreaks,
  findCommonBreaks,
  freeTime,
  groupByWeekday,
  weekWindows,
  type BreakSegment,
  type ParticipantSchedule,
} from "./breaks";
import { MINUTES_PER_DAY, Weekday, clock, toMinuteOfWeek } from "./time";
import type { Interval } from "./intervals";

/** Build a Monday span from two wall-clock times, e.g. mon("09:00", "12:00"). */
function mon(startHour: number, endHour: number, startMin = 0, endMin = 0): Interval {
  return {
    start: toMinuteOfWeek(Weekday.Monday, clock(startHour, startMin)),
    end: toMinuteOfWeek(Weekday.Monday, clock(endHour, endMin)),
  };
}

function onlyMonday(segments: BreakSegment[]): BreakSegment[] {
  return segments.filter((segment) => segment.start < MINUTES_PER_DAY);
}

describe("weekWindows", () => {
  it("produces one waking window per day that never crosses midnight", () => {
    const windows = weekWindows();
    expect(windows).toHaveLength(7);
    expect(windows[0]).toEqual({ start: clock(8), end: clock(22) });
    for (const window of windows) {
      const day = Math.floor(window.start / MINUTES_PER_DAY);
      expect(Math.floor((window.end - 1) / MINUTES_PER_DAY)).toBe(day);
    }
  });
});

describe("freeTime", () => {
  it("is the waking window minus the busy blocks", () => {
    const busy = [mon(9, 12), mon(13, 15)];
    const free = onlyMondayIntervals(freeTime(busy));
    expect(free).toEqual([mon(8, 9), mon(12, 13), mon(15, 22)]);
  });

  it("gives back the whole window when nothing is scheduled", () => {
    expect(onlyMondayIntervals(freeTime([]))).toEqual([mon(8, 22)]);
  });
});

function onlyMondayIntervals(intervals: Interval[]): Interval[] {
  return intervals.filter((interval) => interval.start < MINUTES_PER_DAY);
}

describe("findBreaks", () => {
  const alice: ParticipantSchedule = {
    userId: "alice",
    busy: [mon(9, 12), mon(13, 15)],
  };
  const bob: ParticipantSchedule = {
    userId: "bob",
    busy: [mon(10, 12), mon(13, 16, 0, 0)],
  };

  it("finds the spans where both people are free", () => {
    const monday = onlyMonday(findBreaks([alice, bob]));
    expect(monday).toEqual([
      { start: clock(8), end: clock(9), userIds: ["alice", "bob"] },
      { start: clock(12), end: clock(13), userIds: ["alice", "bob"] },
      { start: clock(16), end: clock(22), userIds: ["alice", "bob"] },
    ]);
  });

  it("excludes time when only one of them is free", () => {
    // Bob is free 15:00-16:00 on Monday but Alice is not, and vice versa.
    const monday = onlyMonday(findBreaks([alice, bob]));
    const covers = (minute: number) =>
      monday.some((segment) => minute >= segment.start && minute < segment.end);
    expect(covers(clock(15, 30))).toBe(false);
  });

  it("reports who is free rather than only that someone is", () => {
    const carol: ParticipantSchedule = { userId: "carol", busy: [mon(8, 22)] };
    const monday = onlyMonday(findBreaks([alice, bob, carol]));
    for (const segment of monday) {
      expect(segment.userIds).not.toContain("carol");
    }
    expect(monday[0]?.userIds).toEqual(["alice", "bob"]);
  });

  it("merges adjacent slices that hold the same set of people", () => {
    // Carol's block ends at 17:00, inside Alice and Bob's shared 16:00-22:00
    // gap. The set of free people changes at 17:00, so the sweep must not
    // leave 16:00-22:00 chopped into pieces once Carol is excluded.
    const carol: ParticipantSchedule = { userId: "carol", busy: [mon(8, 17)] };
    const monday = onlyMonday(
      findBreaks([alice, bob, carol], { minParticipants: 2 }),
    );
    const pairOnly = monday.filter(
      (segment) => segment.userIds.length === 2 && segment.start === clock(16),
    );
    expect(pairOnly).toEqual([
      { start: clock(16), end: clock(17), userIds: ["alice", "bob"] },
    ]);
    expect(monday).toContainEqual({
      start: clock(17),
      end: clock(22),
      userIds: ["alice", "bob", "carol"],
    });
  });

  it("discards gaps shorter than the minimum", () => {
    const tenMinuteGap = [
      { userId: "a", busy: [mon(8, 12), mon(12, 22, 10, 0)] },
      { userId: "b", busy: [mon(8, 12), mon(12, 22, 10, 0)] },
    ];
    expect(onlyMonday(findBreaks(tenMinuteGap))).toEqual([]);
    expect(
      onlyMonday(findBreaks(tenMinuteGap, { minDurationMinutes: 5 })),
    ).toEqual([{ start: clock(12), end: clock(12, 10), userIds: ["a", "b"] }]);
  });

  it("never reports overnight as a shared break", () => {
    const segments = findBreaks([
      { userId: "a", busy: [] },
      { userId: "b", busy: [] },
    ]);
    expect(segments).toHaveLength(7);
    for (const segment of segments) {
      const day = Math.floor(segment.start / MINUTES_PER_DAY);
      expect(Math.floor((segment.end - 1) / MINUTES_PER_DAY)).toBe(day);
    }
  });

  it("returns nothing when there are fewer people than required", () => {
    expect(findBreaks([{ userId: "solo", busy: [] }])).toEqual([]);
  });

  it("honours a custom day window", () => {
    const window = { startMinute: clock(9), endMinute: clock(17) };
    const monday = onlyMonday(
      findBreaks(
        [
          { userId: "a", busy: [] },
          { userId: "b", busy: [] },
        ],
        { dayWindow: window },
      ),
    );
    expect(monday).toEqual([
      { start: clock(9), end: clock(17), userIds: ["a", "b"] },
    ]);
  });
});

describe("findCommonBreaks", () => {
  it("requires every participant to be free", () => {
    const participants: ParticipantSchedule[] = [
      { userId: "a", busy: [mon(8, 12)] },
      { userId: "b", busy: [mon(8, 12)] },
      { userId: "c", busy: [mon(8, 13)] },
    ];
    const monday = onlyMonday(findCommonBreaks(participants));
    expect(monday).toEqual([
      { start: clock(13), end: clock(22), userIds: ["a", "b", "c"] },
    ]);
  });
});

describe("groupByWeekday", () => {
  it("buckets segments Monday first", () => {
    const days = groupByWeekday(
      findBreaks([
        { userId: "a", busy: [] },
        { userId: "b", busy: [] },
      ]),
    );
    expect(days).toHaveLength(7);
    expect(days.every((day) => day.length === 1)).toBe(true);
  });
});

describe("DEFAULT_DAY_WINDOW", () => {
  it("covers a plausible waking day", () => {
    expect(DEFAULT_DAY_WINDOW).toEqual({
      startMinute: clock(8),
      endMinute: clock(22),
    });
  });
});
