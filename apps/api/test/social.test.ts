import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, groupOf, type Harness } from "./harness.ts";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

describe("friend requests by code", () => {
  it("need accepting before anyone is friends", async () => {
    const sam = await h.signIn("sam");
    const priya = await h.signIn("priya");

    // Typed the way the app displays it.
    const code = `${priya.friendCode.slice(0, 4)}-${priya.friendCode.slice(4)}`.toLowerCase();
    const sent = await h.request("POST", "/v1/friends/requests", {
      token: sam.token,
      body: { friendCode: code },
    });
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ status: "pending", requestedBy: sam.id });

    const priyaSees = await h.request("GET", "/v1/friends", { token: priya.token });
    expect(priyaSees.body).toEqual([
      expect.objectContaining({ id: sent.body.id, status: "pending", requestedBy: sam.id }),
    ]);

    const accepted = await h.request("POST", `/v1/friends/requests/${sent.body.id}/accept`, {
      token: priya.token,
    });
    expect(accepted.status).toBe(200);
    expect(accepted.body.status).toBe("accepted");
    expect(accepted.body.user.id).toBe(sam.id);
  });

  it("cannot be accepted by the person who sent them", async () => {
    const a = await h.signIn();
    const b = await h.signIn();
    const sent = await h.request("POST", "/v1/friends/requests", {
      token: a.token,
      body: { friendCode: b.friendCode },
    });
    const selfAccept = await h.request("POST", `/v1/friends/requests/${sent.body.id}/accept`, {
      token: a.token,
    });
    expect(selfAccept.status).toBe(404);
  });

  it("become a friendship at once when both people ask each other", async () => {
    const a = await h.signIn();
    const b = await h.signIn();
    await h.request("POST", "/v1/friends/requests", { token: a.token, body: { friendCode: b.friendCode } });
    const crossed = await h.request("POST", "/v1/friends/requests", {
      token: b.token,
      body: { friendCode: a.friendCode },
    });
    expect(crossed.status).toBe(200);
    expect(crossed.body.status).toBe("accepted");
  });

  it("stop working with an old code once it has been rotated", async () => {
    const a = await h.signIn();
    const b = await h.signIn();
    const oldCode = b.friendCode;

    const rotated = await h.request("POST", "/v1/me/friend-code/rotate", { token: b.token });
    expect(rotated.body.friendCode).not.toBe(oldCode);

    const withOld = await h.request("POST", "/v1/friends/requests", {
      token: a.token,
      body: { friendCode: oldCode },
    });
    expect(withOld.status).toBe(404);
  });
});

describe("friend requests by user id", () => {
  it("only reach people you share a group with", async () => {
    const a = await h.signIn();
    const stranger = await h.signIn();
    const classmate = await h.signIn();
    await groupOf(h, a, classmate);

    const toStranger = await h.request("POST", "/v1/friends/requests", {
      token: a.token,
      body: { userId: stranger.id },
    });
    const toNobody = await h.request("POST", "/v1/friends/requests", {
      token: a.token,
      body: { userId: "00000000-0000-4000-8000-000000000000" },
    });
    const toClassmate = await h.request("POST", "/v1/friends/requests", {
      token: a.token,
      body: { userId: classmate.id },
    });

    expect(toStranger.status).toBe(404);
    // A stranger looks exactly like someone who does not exist.
    expect(toStranger.body).toEqual(toNobody.body);
    expect(toClassmate.status).toBe(201);
  });
});

describe("unfriending", () => {
  it("removes the friendship for both people", async () => {
    const a = await h.signIn();
    const b = await h.signIn();
    const sent = await h.request("POST", "/v1/friends/requests", {
      token: a.token,
      body: { friendCode: b.friendCode },
    });
    await h.request("POST", `/v1/friends/requests/${sent.body.id}/accept`, { token: b.token });

    const removed = await h.request("DELETE", `/v1/friends/${a.id}`, { token: b.token });
    expect(removed.status).toBe(204);

    const aSees = await h.request("GET", "/v1/friends", { token: a.token });
    expect(aSees.body).toEqual([]);
  });

  it("cannot be used to lift a block", async () => {
    const a = await h.signIn();
    const b = await h.signIn();
    const [first, second] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
    await h.db.query(
      `INSERT INTO friendships (user_a, user_b, status, requested_by) VALUES ($1, $2, 'blocked', $3)`,
      [first, second, b.id],
    );

    const unfriend = await h.request("DELETE", `/v1/friends/${b.id}`, { token: a.token });
    expect(unfriend.status).toBe(404);

    const retry = await h.request("POST", "/v1/friends/requests", {
      token: a.token,
      body: { friendCode: b.friendCode },
    });
    expect(retry.status).toBe(404);
  });
});

describe("groups", () => {
  it("are joined with a code, idempotently", async () => {
    const owner = await h.signIn();
    const member = await h.signIn();
    const group = await groupOf(h, owner);

    for (let i = 0; i < 2; i++) {
      const joined = await h.request("POST", "/v1/groups/join", {
        token: member.token,
        body: { code: group.joinCode.toLowerCase() },
      });
      expect(joined.status).toBe(200);
    }

    const detail = await h.request("GET", `/v1/groups/${group.id}`, { token: owner.token });
    expect(detail.body.members).toHaveLength(2);
  });

  it("are invisible to non-members", async () => {
    const owner = await h.signIn();
    const outsider = await h.signIn();
    const group = await groupOf(h, owner);
    const fake = "00000000-0000-4000-8000-000000000000";

    for (const path of ["", "/breaks", "/now"]) {
      const real = await h.request("GET", `/v1/groups/${group.id}${path}`, { token: outsider.token });
      const none = await h.request("GET", `/v1/groups/${fake}${path}`, { token: outsider.token });
      expect(real.status).toBe(404);
      expect(real.body).toEqual(none.body);
    }
  });

  it("let only the owner remove others or rotate the code", async () => {
    const owner = await h.signIn();
    const a = await h.signIn();
    const b = await h.signIn();
    const group = await groupOf(h, owner, a, b);

    const kick = await h.request("DELETE", `/v1/groups/${group.id}/members/${b.id}`, { token: a.token });
    const rotate = await h.request("POST", `/v1/groups/${group.id}/code/rotate`, { token: a.token });
    expect(kick.status).toBe(403);
    expect(rotate.status).toBe(403);

    const leave = await h.request("DELETE", `/v1/groups/${group.id}/members/${a.id}`, { token: a.token });
    expect(leave.status).toBe(204);

    const ownerRotate = await h.request("POST", `/v1/groups/${group.id}/code/rotate`, {
      token: owner.token,
    });
    expect(ownerRotate.body.joinCode).not.toBe(group.joinCode);

    const oldCode = await h.request("POST", "/v1/groups/join", {
      token: a.token,
      body: { code: group.joinCode },
    });
    expect(oldCode.status).toBe(404);
  });

  it("can be closed by the owner, who cannot simply leave", async () => {
    const owner = await h.signIn();
    const member = await h.signIn();
    const group = await groupOf(h, owner, member);

    const leave = await h.request("DELETE", `/v1/groups/${group.id}/members/${owner.id}`, {
      token: owner.token,
    });
    expect(leave.status).toBe(409);

    const close = await h.request("DELETE", `/v1/groups/${group.id}`, { token: owner.token });
    expect(close.status).toBe(204);

    const memberView = await h.request("GET", "/v1/groups", { token: member.token });
    expect(memberView.body).toEqual([]);
  });
});
