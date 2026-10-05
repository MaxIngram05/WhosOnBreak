/**
 * Ad-hoc comparison: "when are Sam, Priya and I all free", outside any group.
 *
 * The ids come from the client, so this is the endpoint where access control
 * is easiest to get wrong. Only accepted friends may be named; anyone else
 * fails the whole request rather than being silently dropped, so a client bug
 * cannot quietly show a comparison that is missing people.
 */

import { Hono } from "hono";
import { adHocBreakQuerySchema } from "@whosonbreak/contracts";
import type { AppBindings } from "../context.ts";
import { parseQuery } from "../http/middleware.ts";
import { forbidden } from "../http/errors.ts";
import { filterToAcceptedFriends } from "../repositories/friends.ts";
import { findUsersByIds, toPublicUser } from "../repositories/users.ts";
import { computeBreaks, loadCandidates } from "../services/breaks.ts";

export function breakRoutes(): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  routes.get("/", async (c) => {
    const ctx = c.get("ctx");
    const viewerId = c.get("user").id;
    const { userIds, ...query } = parseQuery(c, adHocBreakQuerySchema);

    const others = [...new Set(userIds)].filter((id) => id !== viewerId);
    const permitted = await filterToAcceptedFriends(ctx.db, viewerId, others);
    if (others.some((id) => !permitted.has(id))) {
      throw forbidden("You can only compare with accepted friends");
    }

    const users = await findUsersByIds(ctx.db, [viewerId, ...others]);
    const candidates = await loadCandidates(ctx.db, users.map(toPublicUser), viewerId);

    return c.json(computeBreaks({ candidates, viewerId, query, now: ctx.now() }));
  });

  return routes;
}
