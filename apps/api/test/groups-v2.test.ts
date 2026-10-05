import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_GROUP_MEMBERS } from "@whosonbreak/contracts";
import { createHarness, groupOf, type Harness, type SignedIn } from "./harness.ts";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

async function befriend(a: SignedIn, b: SignedIn) {
  const sent = await h.request("POST", "/v1/friends/requests", {
    token: a.token,
    body: { friendCode: b.friendCode },
  });
  await h.request("POST", `/v1/friends/requests/${sent.body.id}/accept`, { token: b.token });
}

describe("renaming", () => {
  it("lets the owner set a name and a subtitle, and clear the subtitle", async () => {
    const owner = await h.signIn();
    const created = await h.request("POST", "/v1/groups", {
      token: owner.token,
      body: { name: "Maths", subtitle: "Mr Smith, Room 4" },
    });
    expect(created.body).toMatchObject({ name: "Maths", subtitle: "Mr Smith, Room 4" });

    const renamed = await h.request("PATCH", `/v1/groups/${created.body.id}`, {
      token: owner.token,
      body: { name: "Further Maths", subtitle: null },
    });
    expect(renamed.body).toMatchObject({ name: "Further Maths", subtitle: null });
  });

  it("is the owner's alone", async () => {
    const owner = await h.signIn();
    const member = await h.signIn();
    const group = await groupOf(h, owner, member);

    const attempt = await h.request("PATCH", `/v1/groups/${group.id}`, {
      token: member.token,
      body: { name: "Hijacked" },
    });
    expect(attempt.status).toBe(403);
  });
});

describe("invite permission", () => {
  it("decides who sees the join code", async () => {
    const owner = await h.signIn();
    const member = await h.signIn();
    const group = await groupOf(h, owner, member);

    let seen = await h.request("GET", `/v1/groups/${group.id}`, { token: member.token });
    expect(seen.body.canInvite).toBe(false);
    expect(seen.body.joinCode).toBeUndefined();

    const granted = await h.request("PATCH", `/v1/groups/${group.id}/members/${member.id}`, {
      token: owner.token,
      body: { canInvite: true },
    });
    expect(granted.body.find((m: any) => m.user.id === member.id).canInvite).toBe(true);

    seen = await h.request("GET", `/v1/groups/${group.id}`, { token: member.token });
    expect(seen.body.canInvite).toBe(true);
    expect(seen.body.joinCode).toBe(group.joinCode);
  });

  it("can only be changed by the owner, and never for the owner", async () => {
    const owner = await h.signIn();
    const a = await h.signIn();
    const b = await h.signIn();
    const group = await groupOf(h, owner, a, b);

    const byMember = await h.request("PATCH", `/v1/groups/${group.id}/members/${b.id}`, {
      token: a.token,
      body: { canInvite: true },
    });
    expect(byMember.status).toBe(403);

    const onOwner = await h.request("PATCH", `/v1/groups/${group.id}/members/${owner.id}`, {
      token: owner.token,
      body: { canInvite: false },
    });
    expect(onOwner.status).toBe(409);
  });
});

describe("direct invites", () => {
  it("go from a member who may invite to one of their friends, who accepts", async () => {
    const owner = await h.signIn();
    const friend = await h.signIn();
    await befriend(owner, friend);
    const group = await groupOf(h, owner);

    const invite = await h.request("POST", `/v1/groups/${group.id}/invites`, {
      token: owner.token,
      body: { userId: friend.id },
    });
    expect(invite.status).toBe(201);

    const inbox = await h.request("GET", "/v1/invites", { token: friend.token });
    expect(inbox.body).toEqual([
      expect.objectContaining({
        id: invite.body.id,
        group: expect.objectContaining({ id: group.id, name: "Test group" }),
        inviter: expect.objectContaining({ id: owner.id }),
      }),
    ]);

    const accepted = await h.request("POST", `/v1/invites/${invite.body.id}/accept`, {
      token: friend.token,
    });
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({ id: group.id, role: "member", canInvite: false });

    const after = await h.request("GET", "/v1/invites", { token: friend.token });
    expect(after.body).toEqual([]);
  });

  it("cannot be sent by a member without permission", async () => {
    const owner = await h.signIn();
    const member = await h.signIn();
    const friend = await h.signIn();
    await befriend(member, friend);
    const group = await groupOf(h, owner, member);

    const attempt = await h.request("POST", `/v1/groups/${group.id}/invites`, {
      token: member.token,
      body: { userId: friend.id },
    });
    expect(attempt.status).toBe(403);
  });

  it("only reach friends", async () => {
    const owner = await h.signIn();
    const stranger = await h.signIn();
    const group = await groupOf(h, owner);

    const attempt = await h.request("POST", `/v1/groups/${group.id}/invites`, {
      token: owner.token,
      body: { userId: stranger.id },
    });
    expect(attempt.status).toBe(404);
  });

  it("can be declined by the invitee, and only answered by them", async () => {
    const owner = await h.signIn();
    const friend = await h.signIn();
    const nosy = await h.signIn();
    await befriend(owner, friend);
    const group = await groupOf(h, owner);
    const invite = await h.request("POST", `/v1/groups/${group.id}/invites`, {
      token: owner.token,
      body: { userId: friend.id },
    });

    const hijack = await h.request("POST", `/v1/invites/${invite.body.id}/accept`, {
      token: nosy.token,
    });
    expect(hijack.status).toBe(404);

    const declined = await h.request("DELETE", `/v1/invites/${invite.body.id}`, {
      token: friend.token,
    });
    expect(declined.status).toBe(204);

    const detail = await h.request("GET", `/v1/groups/${group.id}`, { token: owner.token });
    expect(detail.body.members).toHaveLength(1);
  });
});

describe("the size cap", () => {
  it(`stops a group at ${MAX_GROUP_MEMBERS} members, by code and by invite`, async () => {
    const owner = await h.signIn();
    const group = await groupOf(h, owner);

    // Fill directly: signing in 29 people over HTTP would only slow the test.
    const filler = await h.db.query<{ id: string }>(
      `INSERT INTO users (email, display_name, friend_code)
       SELECT 'cap-' || g || '-' || $2 || '@test.invalid', 'Filler ' || g,
              upper(substr(md5(random()::text), 1, 8))
         FROM generate_series(1, $1::int) AS g
       RETURNING id`,
      [MAX_GROUP_MEMBERS - 1, group.id],
    );
    for (const row of filler) {
      await h.db.query(
        `INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'member')`,
        [group.id, row.id],
      );
    }

    const late = await h.signIn();
    const byCode = await h.request("POST", "/v1/groups/join", {
      token: late.token,
      body: { code: group.joinCode },
    });
    expect(byCode.status).toBe(409);
    expect(byCode.body.error.code).toBe("group_full");

    await befriend(owner, late);
    const byInvite = await h.request("POST", `/v1/groups/${group.id}/invites`, {
      token: owner.token,
      body: { userId: late.id },
    });
    expect(byInvite.status).toBe(409);
  });
});
