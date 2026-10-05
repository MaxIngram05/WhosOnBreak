/**
 * Looking at one person: their week, as they allow it to be seen.
 *
 * Who may look is the question that matters. You may see someone's week if it
 * is yours, if you are accepted friends, or if you share an open group -- the
 * same people who already see them in a comparison. A block in either
 * direction overrides all of that. Anyone else gets the same 404 as an id that
 * does not exist.
 */

import { Hono } from "hono";
import { weekViewQuerySchema } from "@whosonbreak/contracts";
import type { AppBindings } from "../context.ts";
import type { Sql } from "../db/sql.ts";
import { parseQuery, uuidParam } from "../http/middleware.ts";
import { notFound } from "../http/errors.ts";
import { filterToAcceptedFriends, isBlockedBetween } from "../repositories/friends.ts";
import { shareAGroup } from "../repositories/groups.ts";
import { findUserById, toPublicUser } from "../repositories/users.ts";
import { loadComparableSchedules } from "../repositories/schedules.ts";
import { computeWeekView } from "../services/breaks.ts";

async function maySee(sql: Sql, viewerId: string, targetId: string): Promise<boolean> {
  if (viewerId === targetId) return true;
  if (await isBlockedBetween(sql, viewerId, targetId)) return false;
  if ((await filterToAcceptedFriends(sql, viewerId, [targetId])).has(targetId)) return true;
  return shareAGroup(sql, viewerId, targetId);
}

export function peopleRoutes(): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  routes.get("/:userId/week", async (c) => {
    const ctx = c.get("ctx");
    const viewerId = c.get("user").id;
    const targetId = uuidParam(c, "userId");
    const query = parseQuery(c, weekViewQuerySchema);

    if (!(await maySee(ctx.db, viewerId, targetId))) throw notFound("No such user");

    const target = await findUserById(ctx.db, targetId);
    if (!target) throw notFound("No such user");

    const schedules = await loadComparableSchedules(ctx.db, [targetId, viewerId], viewerId);
    const byUser = new Map(schedules.map((schedule) => [schedule.userId, schedule]));

    return c.json(
      computeWeekView({
        target: { user: toPublicUser(target), schedule: byUser.get(targetId) },
        viewerSchedule: byUser.get(viewerId),
        query,
        now: ctx.now(),
      }),
    );
  });

  return routes;
}
