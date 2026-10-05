import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { at, createHarness, giveSchedule, groupOf, type Harness, type SignedIn } from "./harness.ts";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

const MONDAY = 0;

async function befriend(a: SignedIn, b: SignedIn) {
  const sent = await h.request("POST", "/v1/friends/requests", {
    token: a.token,
    body: { friendCode: b.friendCode },
  });
  await h.request("POST", `/v1/friends/requests/${sent.body.id}/accept`, { token: b.token });
}

describe("someone's week", () => {
  it("shows exactly as much as their visibility allows", async () => {
    const viewer = await h.signIn();
    const owner = await h.signIn();
    await giveSchedule(h, owner, "Europe/London", [
      { start: at(MONDAY, 9), end: at(MONDAY, 10), label: "Therapy" },
    ]);
    await groupOf(h, owner, viewer);
    const path = `/v1/people/${owner.id}/week?week=2026-10-07`;

    const busyOnly = await h.request("GET", path, { token: viewer.token });
    expect(busyOnly.status).toBe(200);
    expect(busyOnly.body.blocks).toEqual([
      { start: at(MONDAY, 9), end: at(MONDAY, 10), label: null, kind: null },
    ]);

    await h.request("PUT", "/v1/me/privacy", { token: owner.token, body: { defaultVisibility: "labels" } });
    const labels = await h.request("GET", path, { token: viewer.token });
    expect(labels.body.blocks[0]).toMatchObject({ label: "Therapy", kind: null });

    await h.request("PUT", "/v1/me/privacy", { token: owner.token, body: { defaultVisibility: "full" } });
    const full = await h.request("GET", path, { token: viewer.token });
    expect(full.body.blocks[0]).toMatchObject({ label: "Therapy", kind: "class" });
  });

  it("is on the viewer's clock", async () => {
    const london = await h.signIn();
    const newYork = await h.signIn();
    await giveSchedule(h, london, "Europe/London", []);
    await giveSchedule(h, newYork, "America/New_York", [{ start: at(MONDAY, 9), end: at(MONDAY, 10) }]);
    await befriend(london, newYork);

    const week = await h.request("GET", `/v1/people/${newYork.id}/week?week=2026-01-14`, {
      token: london.token,
    });
    expect(week.body.timeZone).toBe("Europe/London");
    expect(week.body.blocks.map((b: any) => [b.start, b.end])).toEqual([
      [at(MONDAY, 14), at(MONDAY, 15)],
    ]);
  });

  it("shows the right week of a Week A / Week B timetable", async () => {
    h.setNow("2026-10-07T12:00:00Z");
    const viewer = await h.signIn();
    const rotating = await h.signIn();
    await giveSchedule(
      h,
      rotating,
      "Europe/London",
      [
        { start: at(MONDAY, 9), end: at(MONDAY, 10), weekIndex: 0 },
        { start: at(MONDAY, 14), end: at(MONDAY, 15), weekIndex: 1 },
      ],
      { cycleWeeks: 2, currentWeekIndex: 0 },
    );
    await befriend(viewer, rotating);

    const b = await h.request("GET", `/v1/people/${rotating.id}/week?week=2026-10-12`, {
      token: viewer.token,
    });
    expect(b.body).toMatchObject({ weekIndex: 1, cycleWeeks: 2 });
    expect(b.body.blocks.map((x: any) => x.start)).toEqual([at(MONDAY, 14)]);
  });

  it("is hidden from strangers and from anyone they have blocked", async () => {
    const owner = await h.signIn();
    const stranger = await h.signIn();
    const blocked = await h.signIn();
    await giveSchedule(h, owner, "Europe/London", []);
    await groupOf(h, owner, blocked);

    const strangerView = await h.request("GET", `/v1/people/${owner.id}/week`, { token: stranger.token });
    expect(strangerView.status).toBe(404);

    const before = await h.request("GET", `/v1/people/${owner.id}/week`, { token: blocked.token });
    expect(before.status).toBe(200);

    await h.request("POST", `/v1/friends/${blocked.id}/block`, { token: owner.token });
    const after = await h.request("GET", `/v1/people/${owner.id}/week`, { token: blocked.token });
    expect(after.status).toBe(404);
  });

  it("reports someone without a schedule as such, not as free all week", async () => {
    const viewer = await h.signIn();
    const blank = await h.signIn();
    await befriend(viewer, blank);

    const week = await h.request("GET", `/v1/people/${blank.id}/week`, { token: viewer.token });
    expect(week.body).toMatchObject({ hasSchedule: false, blocks: [] });
  });
});

describe("blocking", () => {
  it("ends the friendship and stops new requests either way", async () => {
    const a = await h.signIn();
    const b = await h.signIn();
    await befriend(a, b);

    const block = await h.request("POST", `/v1/friends/${b.id}/block`, { token: a.token });
    expect(block.status).toBe(204);

    expect((await h.request("GET", "/v1/friends", { token: a.token })).body).toEqual([]);
    expect((await h.request("GET", "/v1/friends", { token: b.token })).body).toEqual([]);

    const fromB = await h.request("POST", "/v1/friends/requests", {
      token: b.token,
      body: { friendCode: a.friendCode },
    });
    expect(fromB.status).toBe(404);
  });

  it("is listed for the blocker only, and lifted only by them", async () => {
    const a = await h.signIn();
    const b = await h.signIn();
    await h.request("POST", `/v1/friends/${b.id}/block`, { token: a.token });

    const aList = await h.request("GET", "/v1/friends/blocked", { token: a.token });
    const bList = await h.request("GET", "/v1/friends/blocked", { token: b.token });
    expect(aList.body.map((u: any) => u.id)).toEqual([b.id]);
    expect(bList.body).toEqual([]);

    const bLifts = await h.request("DELETE", `/v1/friends/${a.id}/block`, { token: b.token });
    expect(bLifts.status).toBe(404);

    const aLifts = await h.request("DELETE", `/v1/friends/${b.id}/block`, { token: a.token });
    expect(aLifts.status).toBe(204);

    const request = await h.request("POST", "/v1/friends/requests", {
      token: b.token,
      body: { friendCode: a.friendCode },
    });
    expect(request.status).toBe(201);
  });

  it("does not let the blocked person overwrite the block with their own", async () => {
    const a = await h.signIn();
    const b = await h.signIn();
    await h.request("POST", `/v1/friends/${b.id}/block`, { token: a.token });
    await h.request("POST", `/v1/friends/${a.id}/block`, { token: b.token });

    // b's "block" changed nothing, so b cannot lift a's by unblocking.
    const lift = await h.request("DELETE", `/v1/friends/${a.id}/block`, { token: b.token });
    expect(lift.status).toBe(404);
  });
});
