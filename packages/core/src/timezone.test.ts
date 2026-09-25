import { describe, it, expect } from "vitest";
import {
  isValidTimeZone,
  minuteOfWeekIn,
  nowAsMinuteOfWeek,
  offsetMinutesFor,
  shiftToZone,
  startOfWeekIn,
  zonedWallTimeToInstant,
} from "./timezone";
import { MINUTES_PER_WEEK, Weekday, clock, toMinuteOfWeek } from "./time";

/** 2026-03-29 is a Sunday; London moves to BST at 01:00 UTC that morning. */
const LONDON_SPRING_FORWARD = new Date("2026-03-29T01:00:00Z");
/** 2026-03-08 is a Sunday; New York moves to EDT at 07:00 UTC that morning. */
const NEW_YORK_SPRING_FORWARD = new Date("2026-03-08T07:00:00Z");

const WINTER = new Date("2026-01-15T12:00:00Z");
const SUMMER = new Date("2026-07-15T12:00:00Z");

describe("offsetMinutesFor", () => {
  it("is zero for UTC whatever the date", () => {
    expect(offsetMinutesFor("UTC", WINTER)).toBe(0);
    expect(offsetMinutesFor("UTC", SUMMER)).toBe(0);
  });

  it("follows daylight saving in both hemispheres' directions", () => {
    expect(offsetMinutesFor("Europe/London", WINTER)).toBe(0);
    expect(offsetMinutesFor("Europe/London", SUMMER)).toBe(60);
    expect(offsetMinutesFor("America/New_York", WINTER)).toBe(-300);
    expect(offsetMinutesFor("America/New_York", SUMMER)).toBe(-240);
  });

  it("handles zones that are not a whole number of hours from UTC", () => {
    expect(offsetMinutesFor("Asia/Kolkata", WINTER)).toBe(330);
    expect(offsetMinutesFor("Australia/Eucla", WINTER)).toBe(525);
  });

  it("changes at the transition instant, not before it", () => {
    const aMinuteBefore = new Date(LONDON_SPRING_FORWARD.getTime() - 60_000);
    expect(offsetMinutesFor("Europe/London", aMinuteBefore)).toBe(0);
    expect(offsetMinutesFor("Europe/London", LONDON_SPRING_FORWARD)).toBe(60);
  });
});

describe("isValidTimeZone", () => {
  it("accepts IANA names and rejects anything else", () => {
    expect(isValidTimeZone("Europe/London")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimeZone("GMT+1")).toBe(false);
  });
});

describe("minuteOfWeekIn", () => {
  it("puts Monday 00:00 at zero", () => {
    // 2026-09-21 is a Monday.
    expect(minuteOfWeekIn("UTC", new Date("2026-09-21T00:00:00Z"))).toBe(0);
  });

  it("reads the local clock, not UTC's", () => {
    const instant = new Date("2026-09-21T09:30:00Z");
    expect(minuteOfWeekIn("UTC", instant)).toBe(toMinuteOfWeek(Weekday.Monday, clock(9, 30)));
    // London is on BST in September, so the same instant is an hour later there.
    expect(minuteOfWeekIn("Europe/London", instant)).toBe(
      toMinuteOfWeek(Weekday.Monday, clock(10, 30)),
    );
    // New York is four hours behind, which is still Monday.
    expect(minuteOfWeekIn("America/New_York", instant)).toBe(
      toMinuteOfWeek(Weekday.Monday, clock(5, 30)),
    );
  });

  it("crosses the week boundary when the zone does", () => {
    // Sunday 23:30 UTC is already Monday 11:30 in Auckland.
    const instant = new Date("2026-09-20T23:30:00Z");
    expect(minuteOfWeekIn("UTC", instant)).toBe(toMinuteOfWeek(Weekday.Sunday, clock(23, 30)));
    expect(minuteOfWeekIn("Pacific/Auckland", instant)).toBe(
      toMinuteOfWeek(Weekday.Monday, clock(11, 30)),
    );
  });

  it("stays inside the axis", () => {
    const instant = new Date("2026-09-20T23:59:00Z");
    expect(minuteOfWeekIn("UTC", instant)).toBeLessThan(MINUTES_PER_WEEK);
  });
});

describe("nowAsMinuteOfWeek", () => {
  it("is minuteOfWeekIn against the supplied instant", () => {
    const instant = new Date("2026-09-23T14:05:00Z");
    expect(nowAsMinuteOfWeek("UTC", instant)).toBe(minuteOfWeekIn("UTC", instant));
  });
});

describe("startOfWeekIn", () => {
  it("returns the Monday of the containing week", () => {
    expect(startOfWeekIn("UTC", new Date("2026-09-23T14:00:00Z"))).toEqual({
      year: 2026,
      month: 9,
      day: 21,
    });
  });

  it("treats Sunday as the end of its week, not the start of the next", () => {
    expect(startOfWeekIn("UTC", new Date("2026-09-27T23:00:00Z"))).toEqual({
      year: 2026,
      month: 9,
      day: 21,
    });
  });

  it("steps back across a month boundary", () => {
    expect(startOfWeekIn("UTC", new Date("2026-10-01T09:00:00Z"))).toEqual({
      year: 2026,
      month: 9,
      day: 28,
    });
  });

  it("uses the local date, which may differ from the UTC one", () => {
    // Monday 00:30 in Auckland is still Sunday in UTC, so the two zones
    // disagree about which week this instant belongs to.
    const instant = new Date("2026-09-20T12:30:00Z");
    expect(startOfWeekIn("UTC", instant)).toEqual({ year: 2026, month: 9, day: 14 });
    expect(startOfWeekIn("Pacific/Auckland", instant)).toEqual({
      year: 2026,
      month: 9,
      day: 21,
    });
  });
});

describe("zonedWallTimeToInstant", () => {
  it("round-trips an ordinary time", () => {
    const instant = zonedWallTimeToInstant(
      "Europe/London",
      { year: 2026, month: 7, day: 15 },
      clock(9, 30),
    );
    // London is +1 in July, so 09:30 local is 08:30 UTC.
    expect(instant.toISOString()).toBe("2026-07-15T08:30:00.000Z");
  });

  it("resolves a wall time that daylight saving skipped, rather than failing", () => {
    // New York jumps 02:00 to 03:00; 02:30 never happens that day.
    const instant = zonedWallTimeToInstant(
      "America/New_York",
      { year: 2026, month: 3, day: 8 },
      clock(2, 30),
    );
    expect(instant.getTime()).toBeGreaterThanOrEqual(NEW_YORK_SPRING_FORWARD.getTime());
    expect(minuteOfWeekIn("America/New_York", instant)).toBe(
      toMinuteOfWeek(Weekday.Sunday, clock(3, 30)),
    );
  });

  it("takes the first occurrence of a wall time daylight saving repeated", () => {
    // London falls back on 2026-10-25, so 01:30 happens twice.
    const instant = zonedWallTimeToInstant(
      "Europe/London",
      { year: 2026, month: 10, day: 25 },
      clock(1, 30),
    );
    expect(instant.toISOString()).toBe("2026-10-25T00:30:00.000Z");
  });

  it("round-trips every hour of a transition day back onto a real instant", () => {
    for (let minute = 0; minute < 24 * 60; minute += 30) {
      const instant = zonedWallTimeToInstant(
        "Europe/London",
        { year: 2026, month: 3, day: 29 },
        minute,
      );
      expect(Number.isNaN(instant.getTime())).toBe(false);
    }
  });
});

describe("shiftToZone", () => {
  const mondayMorning = [
    {
      start: toMinuteOfWeek(Weekday.Monday, clock(9)),
      end: toMinuteOfWeek(Weekday.Monday, clock(10)),
    },
  ];

  it("is a copy, not a shift, when both sides share a zone", () => {
    const shifted = shiftToZone(mondayMorning, "Europe/London", "Europe/London", SUMMER);
    expect(shifted).toEqual(mondayMorning);
    expect(shifted[0]).not.toBe(mondayMorning[0]);
  });

  it("moves a block by the offset between the two zones", () => {
    // London 09:00-10:00 BST is 08:00-09:00 UTC.
    expect(shiftToZone(mondayMorning, "Europe/London", "UTC", SUMMER)).toEqual([
      {
        start: toMinuteOfWeek(Weekday.Monday, clock(8)),
        end: toMinuteOfWeek(Weekday.Monday, clock(9)),
      },
    ]);
  });

  it("uses the offset of the requested week, not of today", () => {
    // The same stored block sits an hour apart in UTC depending on whether the
    // week being viewed is inside British Summer Time.
    const winter = shiftToZone(mondayMorning, "Europe/London", "UTC", WINTER);
    const summer = shiftToZone(mondayMorning, "Europe/London", "UTC", SUMMER);
    expect(winter[0]!.start).toBe(toMinuteOfWeek(Weekday.Monday, clock(9)));
    expect(summer[0]!.start).toBe(toMinuteOfWeek(Weekday.Monday, clock(8)));
  });

  it("can move a block onto a different day", () => {
    const sundayEvening = [
      {
        start: toMinuteOfWeek(Weekday.Sunday, clock(22)),
        end: toMinuteOfWeek(Weekday.Sunday, clock(23)),
      },
    ];
    // New York is four hours behind in July, so Sunday night is Monday in UTC.
    expect(shiftToZone(sundayEvening, "America/New_York", "UTC", SUMMER)).toEqual([
      {
        start: toMinuteOfWeek(Weekday.Monday, clock(2)),
        end: toMinuteOfWeek(Weekday.Monday, clock(3)),
      },
    ]);
  });

  it("wraps a block pushed past the end of the week into two pieces", () => {
    const sundayEvening = [
      {
        start: toMinuteOfWeek(Weekday.Sunday, clock(19, 30)),
        end: toMinuteOfWeek(Weekday.Sunday, clock(20, 30)),
      },
    ];
    // 19:30-20:30 EDT is 23:30 Sunday to 00:30 Monday in UTC, which straddles
    // the boundary of the repeating week.
    expect(shiftToZone(sundayEvening, "America/New_York", "UTC", SUMMER)).toEqual([
      { start: toMinuteOfWeek(Weekday.Sunday, clock(23, 30)), end: MINUTES_PER_WEEK },
      { start: 0, end: 30 },
    ]);
  });

  it("keeps a block that ends at midnight Sunday full length", () => {
    const lateSunday = [
      {
        start: toMinuteOfWeek(Weekday.Sunday, clock(23)),
        end: MINUTES_PER_WEEK,
      },
    ];
    const shifted = shiftToZone(lateSunday, "UTC", "UTC", SUMMER);
    expect(shifted).toEqual(lateSunday);
  });

  it("reports elapsed time, so a block spanning a spring-forward shortens", () => {
    // Sunday 00:30-03:30 in London on the day the clocks go forward is three
    // hours of wall clock but only two hours of anyone's actual unavailability.
    const acrossTheGap = [
      {
        start: toMinuteOfWeek(Weekday.Sunday, clock(0, 30)),
        end: toMinuteOfWeek(Weekday.Sunday, clock(3, 30)),
      },
    ];
    const shifted = shiftToZone(
      acrossTheGap,
      "Europe/London",
      "UTC",
      LONDON_SPRING_FORWARD,
    );
    expect(shifted).toHaveLength(1);
    expect(shifted[0]!.end - shifted[0]!.start).toBe(120);
  });

  it("round-trips back to the original axis", () => {
    const there = shiftToZone(mondayMorning, "Europe/London", "Asia/Kolkata", SUMMER);
    const back = shiftToZone(there, "Asia/Kolkata", "Europe/London", SUMMER);
    expect(back).toEqual(mondayMorning);
  });
});
