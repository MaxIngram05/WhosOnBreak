import { describe, it, expect } from "vitest";
import {
  addDays,
  anchorForCurrentWeek,
  cycleWeekIndex,
  daysBetween,
  formatCalendarDate,
  mondayOf,
  parseCalendarDate,
} from "./cycle";

const date = (value: string) => parseCalendarDate(value);

describe("mondayOf", () => {
  it("returns the date itself for a Monday", () => {
    expect(mondayOf(date("2026-10-05"))).toEqual(date("2026-10-05"));
  });

  it("steps back from Sunday to the Monday six days earlier", () => {
    expect(mondayOf(date("2026-10-11"))).toEqual(date("2026-10-05"));
  });

  it("crosses month and year boundaries", () => {
    expect(mondayOf(date("2027-01-01"))).toEqual(date("2026-12-28"));
  });
});

describe("daysBetween / addDays", () => {
  it("are inverses, including across a leap day", () => {
    const start = date("2028-02-27");
    expect(daysBetween(start, addDays(start, 3))).toBe(3);
    expect(formatCalendarDate(addDays(start, 3))).toBe("2028-03-01");
  });

  it("are not thrown off by daylight saving, because they never touch a zone", () => {
    expect(daysBetween(date("2026-03-28"), date("2026-03-30"))).toBe(2);
  });
});

describe("cycleWeekIndex", () => {
  const anchor = date("2026-09-07"); // A Monday declared to be Week A.

  it("is always zero for a one-week cycle", () => {
    expect(cycleWeekIndex(anchor, date("2026-11-16"), 1)).toBe(0);
  });

  it("alternates for a two-week cycle", () => {
    expect(cycleWeekIndex(anchor, date("2026-09-07"), 2)).toBe(0);
    expect(cycleWeekIndex(anchor, date("2026-09-14"), 2)).toBe(1);
    expect(cycleWeekIndex(anchor, date("2026-09-21"), 2)).toBe(0);
  });

  it("does not care which day of either week it is given", () => {
    expect(cycleWeekIndex(date("2026-09-10"), date("2026-09-20"), 2)).toBe(1);
  });

  it("counts backwards from the anchor without going negative", () => {
    expect(cycleWeekIndex(anchor, date("2026-08-31"), 2)).toBe(1);
    expect(cycleWeekIndex(anchor, date("2026-08-24"), 2)).toBe(0);
  });

  it("rejects a cycle that is not a positive whole number of weeks", () => {
    expect(() => cycleWeekIndex(anchor, anchor, 0)).toThrow();
    expect(() => cycleWeekIndex(anchor, anchor, 1.5)).toThrow();
  });
});

describe("anchorForCurrentWeek", () => {
  it("makes the given week come out as the requested index", () => {
    const thisWeek = date("2026-10-07");
    const anchor = anchorForCurrentWeek(thisWeek, 1);
    expect(cycleWeekIndex(anchor, thisWeek, 2)).toBe(1);
    expect(cycleWeekIndex(anchor, addDays(thisWeek, 7), 2)).toBe(0);
  });

  it("always lands on a Monday", () => {
    expect(anchorForCurrentWeek(date("2026-10-09"), 0)).toEqual(date("2026-10-05"));
  });
});

describe("parseCalendarDate", () => {
  it("round-trips through formatCalendarDate", () => {
    expect(formatCalendarDate(parseCalendarDate("2026-01-09"))).toBe("2026-01-09");
  });

  it("rejects malformed and impossible dates", () => {
    expect(() => parseCalendarDate("2026-1-9")).toThrow();
    expect(() => parseCalendarDate("2026-02-30")).toThrow();
  });
});
