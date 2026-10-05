/**
 * Friend requests, by friend code or by shared group.
 *
 * There is no way here to look anyone up. A person is reachable only by the
 * code they chose to give out (typed, or scanned from their QR) or because
 * you are already in a group together -- so the user directory cannot be
 * walked, and every connection still needs the other side to accept.
 */

import { Hono, type MiddlewareHandler } from "hono";
import { createFriendRequestSchema } from "@whosonbreak/contracts";
import type { AppBindings } from "../context.ts";
import { parseBody, uuidParam } from "../http/middleware.ts";
import { notFound } from "../http/errors.ts";
import {
  acceptFriendship,
  blockUser,
  getFriendView,
  listBlocked,
  listFriends,
  removeFriendship,
  requestFriendship,
  unblockUser,
} from "../repositories/friends.ts";
import { findUserByFriendCode, toPublicUser } from "../repositories/users.ts";
import { shareAGroup } from "../repositories/groups.ts";

export function friendRoutes(options: {
  /**
   * A tighter limit for sending requests than for the API as a whole: a code
   * is eight characters, and this is the endpoint someone guessing them would
   * hammer.
   */
  requestLimit: MiddlewareHandler<AppBindings>;
}): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  routes.get("/", async (c) => {
    const ctx = c.get("ctx");
    return c.json(await listFriends(ctx.db, c.get("user").id));
  });

  routes.post("/requests", options.requestLimit, async (c) => {
    const ctx = c.get("ctx");
    const me = c.get("user").id;
    const body = await parseBody(c, createFriendRequestSchema);

    let targetId: string;
    if (body.friendCode !== undefined) {
      const target = await findUserByFriendCode(ctx.db, body.friendCode);
      if (!target) throw notFound("No one has that friend code");
      targetId = target.id;
    } else {
      // The schema guarantees one of the two is present.
      targetId = body.userId as string;
      // The same answer as for an id that does not exist, so this cannot be
      // used to discover who has an account.
      if (!(await shareAGroup(ctx.db, me, targetId))) throw notFound("No such user");
    }

    const friendship = await requestFriendship(ctx.db, me, targetId);
    const view = await getFriendView(ctx.db, me, friendship.id);
    // 200 rather than 201 when the "request" met one coming the other way and
    // became a friendship on the spot.
    return c.json(view, view.status === "accepted" ? 200 : 201);
  });

  routes.post("/requests/:id/accept", async (c) => {
    const ctx = c.get("ctx");
    const me = c.get("user").id;
    const friendship = await acceptFriendship(ctx.db, uuidParam(c, "id"), me);
    return c.json(await getFriendView(ctx.db, me, friendship.id));
  });

  /** People you have blocked. Never tells you who has blocked you. */
  routes.get("/blocked", async (c) => {
    const ctx = c.get("ctx");
    const rows = await listBlocked(ctx.db, c.get("user").id);
    return c.json(rows.map(toPublicUser));
  });

  /**
   * Ends any friendship, withdraws invites between you, and stops them
   * reaching you by friend code or seeing your week. Shared groups still show
   * both of you in comparisons -- leaving the group is how to end that.
   */
  routes.post("/:userId/block", async (c) => {
    const ctx = c.get("ctx");
    await blockUser(ctx.db, c.get("user").id, uuidParam(c, "userId"));
    return c.body(null, 204);
  });

  routes.delete("/:userId/block", async (c) => {
    const ctx = c.get("ctx");
    await unblockUser(ctx.db, c.get("user").id, uuidParam(c, "userId"));
    return c.body(null, 204);
  });

  /** Unfriend, decline a request, or withdraw one you sent: all the same row. */
  routes.delete("/:userId", async (c) => {
    const ctx = c.get("ctx");
    await removeFriendship(ctx.db, c.get("user").id, uuidParam(c, "userId"));
    return c.body(null, 204);
  });

  return routes;
}
