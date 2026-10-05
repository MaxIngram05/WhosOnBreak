/**
 * Groups, and the two comparison endpoints that make them worth joining.
 *
 * Every route that names a group goes through `requireMembership`, so a
 * non-member gets the same 404 as a group that does not exist.
 */

import { Hono } from "hono";
import {
  breakQuerySchema,
  createGroupRequestSchema,
  joinGroupRequestSchema,
} from "@whosonbreak/contracts";
import type { AppBindings } from "../context.ts";
import { parseBody, parseQuery, uuidParam } from "../http/middleware.ts";
import {
  archiveGroup,
  createGroup,
  joinGroupByCode,
  listGroupMembers,
  listGroupsForUser,
  removeGroupMember,
  requireMembership,
  rotateJoinCode,
  toGroup,
  toGroupDetail,
} from "../repositories/groups.ts";
import { computeBreaks, computeOnBreakNow, loadCandidates } from "../services/breaks.ts";

export function groupRoutes(): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  routes.get("/", async (c) => {
    const ctx = c.get("ctx");
    const groups = await listGroupsForUser(ctx.db, c.get("user").id);
    return c.json(groups.map(toGroup));
  });

  routes.post("/", async (c) => {
    const ctx = c.get("ctx");
    const body = await parseBody(c, createGroupRequestSchema);
    const group = await createGroup(ctx.db, c.get("user").id, body.name);
    return c.json(toGroup(group), 201);
  });

  routes.post("/join", async (c) => {
    const ctx = c.get("ctx");
    const body = await parseBody(c, joinGroupRequestSchema);
    const group = await joinGroupByCode(ctx.db, c.get("user").id, body.code);
    return c.json(toGroup(group));
  });

  routes.get("/:id", async (c) => {
    const ctx = c.get("ctx");
    const group = await requireMembership(ctx.db, uuidParam(c, "id"), c.get("user").id);
    const members = await listGroupMembers(ctx.db, group.id);
    return c.json(toGroupDetail(group, members));
  });

  /** Owner only: closes the group for everyone. */
  routes.delete("/:id", async (c) => {
    const ctx = c.get("ctx");
    await archiveGroup(ctx.db, uuidParam(c, "id"), c.get("user").id);
    return c.body(null, 204);
  });

  /** Leave (your own id) or remove someone (owner only). */
  routes.delete("/:id/members/:userId", async (c) => {
    const ctx = c.get("ctx");
    await removeGroupMember(
      ctx.db,
      uuidParam(c, "id"),
      c.get("user").id,
      uuidParam(c, "userId"),
    );
    return c.body(null, 204);
  });

  routes.post("/:id/code/rotate", async (c) => {
    const ctx = c.get("ctx");
    const group = await rotateJoinCode(ctx.db, uuidParam(c, "id"), c.get("user").id);
    return c.json(toGroup(group));
  });

  routes.get("/:id/breaks", async (c) => {
    const ctx = c.get("ctx");
    const viewerId = c.get("user").id;
    const query = parseQuery(c, breakQuerySchema);

    const group = await requireMembership(ctx.db, uuidParam(c, "id"), viewerId);
    const members = await listGroupMembers(ctx.db, group.id);
    const candidates = await loadCandidates(
      ctx.db,
      members.map((member) => member.user),
      viewerId,
    );

    return c.json(computeBreaks({ candidates, viewerId, query, now: ctx.now() }));
  });

  routes.get("/:id/now", async (c) => {
    const ctx = c.get("ctx");
    const viewerId = c.get("user").id;
    const query = parseQuery(c, breakQuerySchema);

    const group = await requireMembership(ctx.db, uuidParam(c, "id"), viewerId);
    const members = await listGroupMembers(ctx.db, group.id);
    const candidates = await loadCandidates(
      ctx.db,
      members.map((member) => member.user),
      viewerId,
    );

    return c.json(computeOnBreakNow({ candidates, viewerId, query, now: ctx.now() }));
  });

  return routes;
}
