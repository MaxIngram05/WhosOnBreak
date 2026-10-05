/**
 * Group invites, from the invitee's side: what am I invited to, yes, no.
 * Sending one is under /groups/:id/invites, where the permission check lives.
 */

import { Hono } from "hono";
import type { AppBindings } from "../context.ts";
import { uuidParam } from "../http/middleware.ts";
import {
  acceptInvite,
  deleteInvite,
  listInvitesForUser,
  toGroup,
} from "../repositories/groups.ts";

export function inviteRoutes(): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  routes.get("/", async (c) => {
    const ctx = c.get("ctx");
    return c.json(await listInvitesForUser(ctx.db, c.get("user").id));
  });

  routes.post("/:id/accept", async (c) => {
    const ctx = c.get("ctx");
    const group = await acceptInvite(ctx.db, uuidParam(c, "id"), c.get("user").id);
    return c.json(toGroup(group));
  });

  /** Decline (invitee) or withdraw (inviter). */
  routes.delete("/:id", async (c) => {
    const ctx = c.get("ctx");
    await deleteInvite(ctx.db, uuidParam(c, "id"), c.get("user").id);
    return c.body(null, 204);
  });

  return routes;
}
