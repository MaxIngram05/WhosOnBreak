/**
 * The caller's own schedules. Nobody else's schedule is ever addressed by id;
 * other people are only reachable through the comparison endpoints.
 */

import { Hono } from "hono";
import {
  createScheduleRequestSchema,
  replaceBlocksRequestSchema,
  updateScheduleRequestSchema,
} from "@whosonbreak/contracts";
import type { AppBindings } from "../context.ts";
import { parseBody, uuidParam } from "../http/middleware.ts";
import { notFound } from "../http/errors.ts";
import {
  createSchedule,
  deleteSchedule,
  findOwnedSchedule,
  listBlocks,
  listSchedulesForUser,
  replaceBlocks,
  toBlock,
  toSchedule,
  updateSchedule,
  type BlockRow,
  type ScheduleRow,
} from "../repositories/schedules.ts";

function withBlocks(schedule: ScheduleRow, blocks: BlockRow[], now: Date) {
  return { ...toSchedule(schedule, now), blocks: blocks.map(toBlock) };
}

export function scheduleRoutes(): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  routes.get("/", async (c) => {
    const ctx = c.get("ctx");
    const now = ctx.now();
    const rows = await listSchedulesForUser(ctx.db, c.get("user").id);
    return c.json(rows.map((row) => toSchedule(row, now)));
  });

  routes.post("/", async (c) => {
    const ctx = c.get("ctx");
    const now = ctx.now();
    const body = await parseBody(c, createScheduleRequestSchema);
    const { schedule, blocks } = await createSchedule(ctx.db, c.get("user").id, body, now);
    return c.json(withBlocks(schedule, blocks, now), 201);
  });

  routes.patch("/:id", async (c) => {
    const ctx = c.get("ctx");
    const now = ctx.now();
    const body = await parseBody(c, updateScheduleRequestSchema);
    const updated = await updateSchedule(ctx.db, c.get("user").id, uuidParam(c, "id"), body, now);
    return c.json(toSchedule(updated, now));
  });

  routes.delete("/:id", async (c) => {
    const ctx = c.get("ctx");
    await deleteSchedule(ctx.db, c.get("user").id, uuidParam(c, "id"));
    return c.body(null, 204);
  });

  routes.get("/:id/blocks", async (c) => {
    const ctx = c.get("ctx");
    const schedule = await findOwnedSchedule(ctx.db, uuidParam(c, "id"), c.get("user").id);
    if (!schedule) throw notFound("No such schedule");
    return c.json(withBlocks(schedule, await listBlocks(ctx.db, schedule.id), ctx.now()));
  });

  routes.put("/:id/blocks", async (c) => {
    const ctx = c.get("ctx");
    const body = await parseBody(c, replaceBlocksRequestSchema);
    const { schedule, blocks } = await replaceBlocks(
      ctx.db,
      c.get("user").id,
      uuidParam(c, "id"),
      body.blocks,
      body.expectedUpdatedAt,
    );
    return c.json(withBlocks(schedule, blocks, ctx.now()));
  });

  return routes;
}
