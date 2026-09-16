import { describe, it, expect } from "vitest";
import {
  intersect,
  normalize,
  splitWeekWrap,
  subtract,
  totalMinutes,
} from "./intervals";
import { MINUTES_PER_WEEK } from "./time";

describe("normalize", () => {
  it("merges overlapping spans", () => {
    expect(
      normalize([
        { start: 0, end: 10 },
        { start: 5, end: 15 },
        { start: 20, end: 25 },
      ]),
    ).toEqual([
      { start: 0, end: 15 },
      { start: 20, end: 25 },
    ]);
  });

  it("merges spans that merely touch, so no phantom zero-length gap survives", () => {
    expect(
      normalize([
        { start: 0, end: 10 },
        { start: 10, end: 20 },
      ]),
    ).toEqual([{ start: 0, end: 20 }]);
  });

  it("drops empty and inverted spans", () => {
    expect(normalize([{ start: 5, end: 5 }, { start: 30, end: 10 }])).toEqual([]);
  });

  it("sorts input that arrives out of order", () => {
    expect(
      normalize([
        { start: 100, end: 120 },
        { start: 0, end: 10 },
      ]),
    ).toEqual([
      { start: 0, end: 10 },
      { start: 100, end: 120 },
    ]);
  });
});

describe("subtract", () => {
  it("punches holes in a single span", () => {
    expect(
      subtract([{ start: 0, end: 100 }], [
        { start: 20, end: 30 },
        { start: 50, end: 60 },
      ]),
    ).toEqual([
      { start: 0, end: 20 },
      { start: 30, end: 50 },
      { start: 60, end: 100 },
    ]);
  });

  it("returns nothing when fully covered", () => {
    expect(subtract([{ start: 0, end: 100 }], [{ start: 0, end: 100 }])).toEqual([]);
  });

  it("ignores cuts that miss entirely", () => {
    expect(subtract([{ start: 0, end: 10 }], [{ start: 20, end: 30 }])).toEqual([
      { start: 0, end: 10 },
    ]);
  });

  it("trims a cut that overhangs both ends", () => {
    expect(subtract([{ start: 10, end: 20 }], [{ start: 0, end: 15 }])).toEqual([
      { start: 15, end: 20 },
    ]);
  });
});

describe("intersect", () => {
  it("keeps only the shared portion", () => {
    expect(intersect([{ start: 0, end: 50 }], [{ start: 20, end: 80 }])).toEqual([
      { start: 20, end: 50 },
    ]);
  });

  it("handles one span straddling two", () => {
    expect(
      intersect(
        [
          { start: 0, end: 10 },
          { start: 20, end: 30 },
        ],
        [{ start: 5, end: 25 }],
      ),
    ).toEqual([
      { start: 5, end: 10 },
      { start: 20, end: 25 },
    ]);
  });
});

describe("splitWeekWrap", () => {
  it("leaves a normal span alone", () => {
    expect(splitWeekWrap({ start: 100, end: 200 })).toEqual([
      { start: 100, end: 200 },
    ]);
  });

  it("splits a Sunday-night span across the week boundary", () => {
    // Sunday 23:00 running two hours lands at Monday 01:00.
    expect(splitWeekWrap({ start: 10020, end: 10140 })).toEqual([
      { start: 10020, end: MINUTES_PER_WEEK },
      { start: 0, end: 60 },
    ]);
  });
});

describe("totalMinutes", () => {
  it("sums span lengths", () => {
    expect(
      totalMinutes([
        { start: 0, end: 30 },
        { start: 100, end: 145 },
      ]),
    ).toBe(75);
  });
});
