import { describe, it, expect } from "vitest";
import {
  blockInputSchema,
  calendarDateSchema,
  createFriendRequestSchema,
  createScheduleRequestSchema,
  friendCodeSchema,
} from "./index";

describe("friendCodeSchema", () => {
  it("accepts the code however it was copied", () => {
    expect(friendCodeSchema.parse("abcd-efgh")).toBe("ABCDEFGH");
    expect(friendCodeSchema.parse(" ABCD EFGH ")).toBe("ABCDEFGH");
  });

  it("rejects the characters left out for being easy to misread", () => {
    expect(friendCodeSchema.safeParse("ABCD-EFG0").success).toBe(false);
    expect(friendCodeSchema.safeParse("ABCD-EFGI").success).toBe(false);
  });

  it("rejects the wrong length", () => {
    expect(friendCodeSchema.safeParse("ABCDEF").success).toBe(false);
  });
});

describe("createFriendRequestSchema", () => {
  it("needs exactly one way of naming the person", () => {
    expect(createFriendRequestSchema.safeParse({}).success).toBe(false);
    expect(
      createFriendRequestSchema.safeParse({
        friendCode: "ABCDEFGH",
        userId: "6f1c1b7e-8f0a-4a52-9b6c-2b1f0f0e9c11",
      }).success,
    ).toBe(false);
    expect(createFriendRequestSchema.safeParse({ friendCode: "abcd-efgh" }).success).toBe(true);
  });
});

describe("createScheduleRequestSchema", () => {
  it("defaults to a one-week cycle", () => {
    const parsed = createScheduleRequestSchema.parse({ name: "Term 1", timeZone: "Europe/London" });
    expect(parsed.cycleWeeks).toBe(1);
  });

  it("refuses two different statements of where the rotation stands", () => {
    const result = createScheduleRequestSchema.safeParse({
      name: "Term 1",
      timeZone: "Europe/London",
      cycleWeeks: 2,
      currentWeekIndex: 1,
      cycleAnchor: "2026-09-07",
    });
    expect(result.success).toBe(false);
  });
});

describe("blockInputSchema", () => {
  it("puts a block in Week A unless told otherwise", () => {
    expect(blockInputSchema.parse({ start: 540, end: 600 }).weekIndex).toBe(0);
  });

  it("rejects a week beyond the longest supported cycle", () => {
    expect(blockInputSchema.safeParse({ start: 540, end: 600, weekIndex: 2 }).success).toBe(false);
  });
});

describe("calendarDateSchema", () => {
  it("rejects dates that look right but do not exist", () => {
    expect(calendarDateSchema.safeParse("2026-02-29").success).toBe(false);
    expect(calendarDateSchema.safeParse("2028-02-29").success).toBe(true);
  });
});
