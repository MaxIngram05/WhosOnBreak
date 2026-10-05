import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { at, createHarness, giveSchedule, type Harness } from "./harness.ts";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

const SUNDAY = 6;
const MONDAY = 0;

describe("blocks", () => {
  it("are stored split when they run past the end of the week", async () => {
    const user = await h.signIn();
    const id = await giveSchedule(h, user, "Europe/London", [
      { start: at(SUNDAY, 23), end: at(SUNDAY, 23) + 120, label: "Night shift" },
    ]);

    const rows = await h.db.query<{ start_minute: number; end_minute: number }>(
      `SELECT start_minute, end_minute FROM blocks WHERE schedule_id = $1 ORDER BY start_minute`,
      [id],
    );
    expect(rows).toEqual([
      { start_minute: 0, end_minute: 60 },
      { start_minute: at(SUNDAY, 23), end_minute: 10080 },
    ]);
  });

  it("carry a wrapped piece into the next week of a two-week cycle", async () => {
    const user = await h.signIn();
    const id = await giveSchedule(
      h,
      user,
      "Europe/London",
      [{ start: at(SUNDAY, 23), end: at(SUNDAY, 23) + 120, weekIndex: 1 }],
      { cycleWeeks: 2 },
    );

    const blocks = await h.request("GET", `/v1/schedules/${id}/blocks`, { token: user.token });
    expect(blocks.body.blocks.map((b: any) => [b.weekIndex, b.start, b.end])).toEqual([
      // Week B's Sunday night ends on Week A's Monday morning.
      [0, 0, 60],
      [1, at(SUNDAY, 23), 10080],
    ]);
  });

  it("cannot be put in a week the schedule does not have", async () => {
    const user = await h.signIn();
    const response = await h.request("POST", "/v1/schedules", {
      token: user.token,
      body: {
        name: "Term",
        timeZone: "Europe/London",
        blocks: [{ start: at(MONDAY, 9), end: at(MONDAY, 10), weekIndex: 1 }],
      },
    });
    expect(response.status).toBe(400);
  });

  it("are replaced as a whole set, and a stale editor is told so", async () => {
    const user = await h.signIn();
    const id = await giveSchedule(h, user, "Europe/London", [
      { start: at(MONDAY, 9), end: at(MONDAY, 10) },
    ]);
    const before = await h.request("GET", `/v1/schedules/${id}/blocks`, { token: user.token });

    const saved = await h.request("PUT", `/v1/schedules/${id}/blocks`, {
      token: user.token,
      body: {
        blocks: [{ start: at(MONDAY, 11), end: at(MONDAY, 12) }],
        expectedUpdatedAt: before.body.updatedAt,
      },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.blocks.map((b: any) => b.start)).toEqual([at(MONDAY, 11)]);

    // A second device still holding the old version.
    const stale = await h.request("PUT", `/v1/schedules/${id}/blocks`, {
      token: user.token,
      body: { blocks: [], expectedUpdatedAt: before.body.updatedAt },
    });
    expect(stale.status).toBe(409);
  });
});

describe("schedules", () => {
  it("are invisible to everyone but their owner", async () => {
    const owner = await h.signIn();
    const other = await h.signIn();
    const id = await giveSchedule(h, owner, "Europe/London", []);

    const read = await h.request("GET", `/v1/schedules/${id}/blocks`, { token: other.token });
    const write = await h.request("PUT", `/v1/schedules/${id}/blocks`, {
      token: other.token,
      body: { blocks: [] },
    });
    const missing = await h.request(
      "GET",
      `/v1/schedules/00000000-0000-4000-8000-000000000000/blocks`,
      { token: other.token },
    );

    expect(read.status).toBe(404);
    expect(write.status).toBe(404);
    // Indistinguishable from one that does not exist.
    expect(read.body).toEqual(missing.body);
  });

  it("have exactly one active per person", async () => {
    const user = await h.signIn();
    const first = await giveSchedule(h, user, "Europe/London", []);
    const second = await giveSchedule(h, user, "Europe/London", []);

    let list = await h.request("GET", "/v1/schedules", { token: user.token });
    expect(list.body.filter((s: any) => s.isActive).map((s: any) => s.id)).toEqual([second]);

    await h.request("PATCH", `/v1/schedules/${first}`, {
      token: user.token,
      body: { isActive: true },
    });
    list = await h.request("GET", "/v1/schedules", { token: user.token });
    expect(list.body.filter((s: any) => s.isActive).map((s: any) => s.id)).toEqual([first]);
  });
});

describe("week A / week B", () => {
  it("start with this week as Week A when nothing is said", async () => {
    // Wednesday 7 October 2026.
    h.setNow("2026-10-07T12:00:00Z");
    const user = await h.signIn();
    const id = await giveSchedule(h, user, "Europe/London", [], { cycleWeeks: 2 });

    const schedule = await h.request("GET", `/v1/schedules/${id}/blocks`, { token: user.token });
    expect(schedule.body).toMatchObject({
      cycleWeeks: 2,
      cycleAnchor: "2026-10-05",
      currentWeekIndex: 0,
    });
  });

  it("can be told which week this is, and keeps counting from there", async () => {
    h.setNow("2026-10-07T12:00:00Z");
    const user = await h.signIn();
    const id = await giveSchedule(h, user, "Europe/London", [], { cycleWeeks: 2 });

    const patched = await h.request("PATCH", `/v1/schedules/${id}`, {
      token: user.token,
      body: { currentWeekIndex: 1 },
    });
    expect(patched.body).toMatchObject({ cycleAnchor: "2026-09-28", currentWeekIndex: 1 });

    h.setNow("2026-10-14T12:00:00Z");
    const nextWeek = await h.request("GET", "/v1/schedules", { token: user.token });
    expect(nextWeek.body[0].currentWeekIndex).toBe(0);
  });

  it("decides 'this week' by the schedule's clock, not the server's", async () => {
    // Sunday 23:30 UTC is already Monday in Tokyo.
    h.setNow("2026-10-11T23:30:00Z");
    const user = await h.signIn();
    const id = await giveSchedule(h, user, "Asia/Tokyo", [], {
      cycleWeeks: 2,
      currentWeekIndex: 0,
    });
    const schedule = await h.request("GET", `/v1/schedules/${id}/blocks`, { token: user.token });
    expect(schedule.body.cycleAnchor).toBe("2026-10-12");
  });

  it("will not drop a week that still has blocks in it", async () => {
    const user = await h.signIn();
    const id = await giveSchedule(
      h,
      user,
      "Europe/London",
      [{ start: at(MONDAY, 9), end: at(MONDAY, 10), weekIndex: 1 }],
      { cycleWeeks: 2 },
    );

    const refused = await h.request("PATCH", `/v1/schedules/${id}`, {
      token: user.token,
      body: { cycleWeeks: 1 },
    });
    expect(refused.status).toBe(409);

    await h.request("PUT", `/v1/schedules/${id}/blocks`, { token: user.token, body: { blocks: [] } });
    const allowed = await h.request("PATCH", `/v1/schedules/${id}`, {
      token: user.token,
      body: { cycleWeeks: 1 },
    });
    expect(allowed.status).toBe(200);
    expect(allowed.body).toMatchObject({ cycleWeeks: 1, cycleAnchor: null });
  });

  it("is protected by the database as well as the API", async () => {
    const user = await h.signIn();
    const id = await giveSchedule(h, user, "Europe/London", [], { cycleWeeks: 2 });

    // A Tuesday anchor is meaningless and the CHECK constraint says so.
    await expect(
      h.db.query(`UPDATE schedules SET cycle_anchor = '2026-10-06' WHERE id = $1`, [id]),
    ).rejects.toThrow();
  });
});
