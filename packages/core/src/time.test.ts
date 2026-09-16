import { describe, it, expect } from "vitest";
import {
  MINUTES_PER_WEEK,
  Weekday,
  clock,
  formatDuration,
  formatMinuteOfWeek,
  formatTime,
  minuteOfDayOf,
  parseClock,
  snapTo,
  toMinuteOfWeek,
  weekdayOf,
  wrapWeek,
} from "./time";

describe("minute-of-week conversions", () => {
  it("round-trips a weekday and time", () => {
    const minute = toMinuteOfWeek(Weekday.Wednesday, clock(14, 45));
    expect(weekdayOf(minute)).toBe(Weekday.Wednesday);
    expect(minuteOfDayOf(minute)).toBe(clock(14, 45));
  });

  it("puts Monday midnight at zero", () => {
    expect(toMinuteOfWeek(Weekday.Monday, 0)).toBe(0);
  });

  it("ends the week one minute before the axis length", () => {
    expect(toMinuteOfWeek(Weekday.Sunday, clock(23, 59))).toBe(MINUTES_PER_WEEK - 1);
  });

  it("wraps out-of-range minutes back onto the axis", () => {
    expect(wrapWeek(MINUTES_PER_WEEK + 30)).toBe(30);
    expect(wrapWeek(-30)).toBe(MINUTES_PER_WEEK - 30);
  });
});

describe("parseClock", () => {
  it("parses padded and unpadded hours", () => {
    expect(parseClock("09:30")).toBe(570);
    expect(parseClock("9:30")).toBe(570);
  });

  it("rejects malformed input", () => {
    expect(() => parseClock("9.30")).toThrow();
    expect(() => parseClock("25:00")).toThrow();
    expect(() => parseClock("09:75")).toThrow();
  });
});

describe("formatting", () => {
  it("renders 12-hour times with the right meridiem", () => {
    expect(formatTime(0)).toBe("12:00 AM");
    expect(formatTime(clock(9, 30))).toBe("9:30 AM");
    expect(formatTime(clock(12, 0))).toBe("12:00 PM");
    expect(formatTime(clock(13, 5))).toBe("1:05 PM");
  });

  it("renders 24-hour times zero-padded", () => {
    expect(formatTime(clock(9, 30), false)).toBe("09:30");
    expect(formatTime(clock(13, 5), false)).toBe("13:05");
  });

  it("labels a minute-of-week with its day", () => {
    expect(formatMinuteOfWeek(toMinuteOfWeek(Weekday.Monday, clock(9, 30)))).toBe(
      "Mon 9:30 AM",
    );
  });

  it("renders durations compactly", () => {
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(75)).toBe("1h 15m");
  });
});

describe("snapTo", () => {
  it("snaps a dragged minute to the nearest step", () => {
    expect(snapTo(722, 5)).toBe(720);
    expect(snapTo(723, 5)).toBe(725);
    expect(snapTo(728, 15)).toBe(735);
    expect(snapTo(722, 15)).toBe(720);
  });
});
