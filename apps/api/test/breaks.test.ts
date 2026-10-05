import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { at, createHarness, giveSchedule, groupOf, type Harness } from "./harness.ts";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

const MONDAY = 0;

/** The segments on one day, as [start, end, how many people]. */
function onDay(body: any, day: number) {
  return body.segments
    .filter((s: any) => Math.floor(s.start / 1440) === day)
    .map((s: any) => [s.start - day * 1440, s.end - day * 1440, s.users.length]);
}

describe("group breaks", () => {
  it("are the times members are free together", async () => {
    const a = await h.signIn();
    const b = await h.signIn();
    const late = await h.signIn();
    await giveSchedule(h, a, "Europe/London", [{ start: at(MONDAY, 9), end: at(MONDAY, 12) }]);
    await giveSchedule(h, b, "Europe/London", [{ start: at(MONDAY, 11), end: at(MONDAY, 14) }]);
    const group = await groupOf(h, a, b, late);

    const response = await h.request("GET", `/v1/groups/${group.id}/breaks?week=2026-10-07`, {
      token: a.token,
    });

    expect(response.status).toBe(200);
    expect(response.body.timeZone).toBe("Europe/London");
    expect(response.body.weekStart).toBe("2026-10-05");
    expect(onDay(response.body, MONDAY)).toEqual([
      [8 * 60, 9 * 60, 2],
      [14 * 60, 22 * 60, 2],
    ]);
    // No schedule is "has not set up yet", not "busy".
    expect(response.body.excluded.map((u: any) => u.id)).toEqual([late.id]);
  });

  it("are read from the right week of a Week A / Week B timetable", async () => {
    h.setNow("2026-10-07T12:00:00Z");
    const rotating = await h.signIn();
    const steady = await h.signIn();
    await giveSchedule(
      h,
      rotating,
      "Europe/London",
      [
        { start: at(MONDAY, 9), end: at(MONDAY, 12), weekIndex: 0 },
        { start: at(MONDAY, 13), end: at(MONDAY, 16), weekIndex: 1 },
      ],
      { cycleWeeks: 2, currentWeekIndex: 0 },
    );
    await giveSchedule(h, steady, "Europe/London", []);
    const group = await groupOf(h, rotating, steady);

    const weekA = await h.request("GET", `/v1/groups/${group.id}/breaks?week=2026-10-05`, {
      token: steady.token,
    });
    const weekB = await h.request("GET", `/v1/groups/${group.id}/breaks?week=2026-10-12`, {
      token: steady.token,
    });

    expect(onDay(weekA.body, MONDAY)).toEqual([
      [8 * 60, 9 * 60, 2],
      [12 * 60, 22 * 60, 2],
    ]);
    expect(onDay(weekB.body, MONDAY)).toEqual([
      [8 * 60, 13 * 60, 2],
      [16 * 60, 22 * 60, 2],
    ]);
  });

  it("follow daylight saving when members are in different zones", async () => {
    // London is busy 09:00-12:00. New York is busy 08:00-12:00 New York time,
    // which is 13:00-17:00 in London in January but 12:00-16:00 in the
    // fortnight of March when America has moved its clocks and Britain has not.
    const london = await h.signIn();
    const newYork = await h.signIn();
    await giveSchedule(h, london, "Europe/London", [{ start: at(MONDAY, 9), end: at(MONDAY, 12) }]);
    await giveSchedule(h, newYork, "America/New_York", [
      { start: at(MONDAY, 8), end: at(MONDAY, 12) },
    ]);
    const group = await groupOf(h, london, newYork);

    const january = await h.request("GET", `/v1/groups/${group.id}/breaks?week=2026-01-14`, {
      token: london.token,
    });
    const march = await h.request("GET", `/v1/groups/${group.id}/breaks?week=2026-03-11`, {
      token: london.token,
    });

    expect(onDay(january.body, MONDAY)).toEqual([
      [8 * 60, 9 * 60, 2],
      [12 * 60, 13 * 60, 2],
      [17 * 60, 22 * 60, 2],
    ]);
    expect(onDay(march.body, MONDAY)).toEqual([
      [8 * 60, 9 * 60, 2],
      [16 * 60, 22 * 60, 2],
    ]);
  });
});

describe("who is on break now", () => {
  it("says how long free people stay free", async () => {
    // Monday 5 October 2026, 10:00 in London (BST).
    h.setNow("2026-10-05T09:00:00Z");
    const viewer = await h.signIn();
    const free = await h.signIn();
    await giveSchedule(h, viewer, "Europe/London", [{ start: at(MONDAY, 9), end: at(MONDAY, 11) }]);
    await giveSchedule(h, free, "Europe/London", [{ start: at(MONDAY, 10, 30), end: at(MONDAY, 12) }]);
    const group = await groupOf(h, viewer, free);

    const now = await h.request("GET", `/v1/groups/${group.id}/now`, { token: viewer.token });

    expect(now.body.nowMinuteOfWeek).toBe(at(MONDAY, 10));
    expect(now.body.onBreak).toEqual([
      expect.objectContaining({ id: free.id, until: at(MONDAY, 10, 30), freeForMinutes: 30 }),
    ]);
    expect(now.body.busy).toEqual([
      expect.objectContaining({ id: viewer.id, until: at(MONDAY, 11) }),
    ]);
  });

  it("never shows a label the owner has not chosen to share", async () => {
    h.setNow("2026-10-05T09:00:00Z");
    const viewer = await h.signIn();
    const private_ = await h.signIn();
    await giveSchedule(h, viewer, "Europe/London", []);
    await giveSchedule(h, private_, "Europe/London", [
      { start: at(MONDAY, 9), end: at(MONDAY, 11), label: "Therapy" },
    ]);
    const group = await groupOf(h, viewer, private_);

    const hidden = await h.request("GET", `/v1/groups/${group.id}/now`, { token: viewer.token });
    expect(hidden.body.busy).toEqual([expect.objectContaining({ id: private_.id, label: null })]);
    expect(JSON.stringify(hidden.body)).not.toContain("Therapy");

    await h.request("PUT", "/v1/me/privacy", {
      token: private_.token,
      body: { defaultVisibility: "labels" },
    });
    const shown = await h.request("GET", `/v1/groups/${group.id}/now`, { token: viewer.token });
    expect(shown.body.busy).toEqual([expect.objectContaining({ id: private_.id, label: "Therapy" })]);
  });
});

describe("ad-hoc comparison", () => {
  it("works with accepted friends and refuses anyone else", async () => {
    const me = await h.signIn();
    const friend = await h.signIn();
    const stranger = await h.signIn();
    await giveSchedule(h, me, "Europe/London", [{ start: at(MONDAY, 9), end: at(MONDAY, 17) }]);
    await giveSchedule(h, friend, "Europe/London", []);

    const sent = await h.request("POST", "/v1/friends/requests", {
      token: me.token,
      body: { friendCode: friend.friendCode },
    });
    await h.request("POST", `/v1/friends/requests/${sent.body.id}/accept`, { token: friend.token });

    const ok = await h.request("GET", `/v1/breaks?userIds=${friend.id}&week=2026-10-07`, {
      token: me.token,
    });
    expect(ok.status).toBe(200);
    expect(onDay(ok.body, MONDAY)).toEqual([
      [8 * 60, 9 * 60, 2],
      [17 * 60, 22 * 60, 2],
    ]);

    const refused = await h.request("GET", `/v1/breaks?userIds=${friend.id},${stranger.id}`, {
      token: me.token,
    });
    expect(refused.status).toBe(403);

    // A pending request is not enough either.
    await h.request("POST", "/v1/friends/requests", {
      token: me.token,
      body: { friendCode: stranger.friendCode },
    });
    const pending = await h.request("GET", `/v1/breaks?userIds=${stranger.id}`, { token: me.token });
    expect(pending.status).toBe(403);
  });
});
