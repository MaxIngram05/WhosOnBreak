import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { at, createHarness, giveSchedule, groupOf, type Harness } from "./harness.ts";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

describe("profile", () => {
  it("can be renamed and its privacy changed", async () => {
    const user = await h.signIn();

    const renamed = await h.request("PATCH", "/v1/me", {
      token: user.token,
      body: { displayName: "  New Name  " },
    });
    expect(renamed.body.displayName).toBe("New Name");

    const privacy = await h.request("PUT", "/v1/me/privacy", {
      token: user.token,
      body: { defaultVisibility: "labels" },
    });
    expect(privacy.body).toEqual({ defaultVisibility: "labels" });

    const me = await h.request("GET", "/v1/me", { token: user.token });
    expect(me.body).toMatchObject({ displayName: "New Name", defaultVisibility: "labels" });
  });
});

describe("data export", () => {
  it("contains everything about the caller, labels included, and no secrets", async () => {
    const user = await h.signIn();
    const friend = await h.signIn();
    await giveSchedule(h, user, "Europe/London", [
      { start: at(0, 9), end: at(0, 10), label: "Private appointment" },
    ]);
    await h.request("POST", "/v1/friends/requests", {
      token: user.token,
      body: { friendCode: friend.friendCode },
    });
    await groupOf(h, user);

    const response = await h.request("GET", "/v1/me/export", { token: user.token });

    expect(response.status).toBe(200);
    expect(response.body.user.id).toBe(user.id);
    expect(response.body.identities).toHaveLength(1);
    expect(response.body.schedules[0].blocks[0].label).toBe("Private appointment");
    expect(response.body.friendships).toEqual([
      expect.objectContaining({ userId: friend.id, status: "pending", requestedByMe: true }),
    ]);
    expect(response.body.groups).toEqual([expect.objectContaining({ role: "owner" })]);
    expect(response.body.sessions.length).toBeGreaterThan(0);

    const text = JSON.stringify(response.body);
    expect(text).not.toContain(user.refreshToken);
    expect(text).not.toContain("token_hash");
  });
});

describe("account deletion", () => {
  it("erases the account and everything that was only theirs", async () => {
    const user = await h.signIn();
    const scheduleId = await giveSchedule(h, user, "Europe/London", [
      { start: at(0, 9), end: at(0, 10) },
    ]);

    const deleted = await h.request("DELETE", "/v1/me", { token: user.token });
    expect(deleted.status).toBe(204);

    const leftovers = await h.db.query(
      `SELECT 'user' FROM users WHERE id = $1
       UNION ALL SELECT 'schedule' FROM schedules WHERE id = $2
       UNION ALL SELECT 'block' FROM blocks WHERE schedule_id = $2
       UNION ALL SELECT 'session' FROM refresh_tokens WHERE user_id = $1
       UNION ALL SELECT 'identity' FROM identities WHERE user_id = $1`,
      [user.id, scheduleId],
    );
    expect(leftovers).toEqual([]);

    // The access token is still validly signed, but there is nobody behind it.
    const me = await h.request("GET", "/v1/me", { token: user.token });
    expect(me.status).toBe(401);
    const refresh = await h.request("POST", "/v1/auth/refresh", {
      body: { refreshToken: user.refreshToken },
    });
    expect(refresh.status).toBe(401);
  });

  it("hands a group to its longest-standing member instead of deleting it", async () => {
    const owner = await h.signIn();
    const first = await h.signIn();
    const second = await h.signIn();
    const group = await groupOf(h, owner, first, second);

    await h.request("DELETE", "/v1/me", { token: owner.token });

    const detail = await h.request("GET", `/v1/groups/${group.id}`, { token: second.token });
    expect(detail.status).toBe(200);
    expect(detail.body.members).toHaveLength(2);
    expect(detail.body.members.find((m: any) => m.role === "owner").user.id).toBe(first.id);
  });

  it("deletes a group nobody else is in", async () => {
    const loner = await h.signIn();
    const group = await groupOf(h, loner);

    await h.request("DELETE", "/v1/me", { token: loner.token });

    const rows = await h.db.query(`SELECT id FROM groups WHERE id = $1`, [group.id]);
    expect(rows).toEqual([]);
  });
});
