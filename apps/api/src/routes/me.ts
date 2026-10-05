/**
 * The caller's own account.
 */

import { Hono } from "hono";
import { privacySettingsSchema, updateMeRequestSchema } from "@whosonbreak/contracts";
import type { AppBindings } from "../context.ts";
import { parseBody } from "../http/middleware.ts";
import { unauthenticated } from "../http/errors.ts";
import {
  deleteUser,
  findUserById,
  rotateFriendCode,
  toPrivateUser,
  updateUser,
  type UserRow,
} from "../repositories/users.ts";
import { exportAccount } from "../repositories/account.ts";

/**
 * An access token outlives the account it was issued for by up to its TTL,
 * because verifying one never touches the database. Every route here does, and
 * reports a missing user as what it is to the client: not signed in.
 */
function present(user: UserRow | undefined): UserRow {
  if (!user) throw unauthenticated("This account no longer exists");
  return user;
}

export function meRoutes(): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  routes.get("/", async (c) => {
    const ctx = c.get("ctx");
    const user = present(await findUserById(ctx.db, c.get("user").id));
    return c.json(toPrivateUser(user));
  });

  routes.patch("/", async (c) => {
    const ctx = c.get("ctx");
    const body = await parseBody(c, updateMeRequestSchema);
    const user = present(await updateUser(ctx.db, c.get("user").id, body));
    return c.json(toPrivateUser(user));
  });

  /**
   * Erases the account. Everything goes with it except groups other people are
   * still in, which pass to their longest-standing member.
   */
  routes.delete("/", async (c) => {
    const ctx = c.get("ctx");
    if (!(await deleteUser(ctx.db, c.get("user").id))) {
      throw unauthenticated("This account no longer exists");
    }
    return c.body(null, 204);
  });

  routes.get("/privacy", async (c) => {
    const ctx = c.get("ctx");
    const user = present(await findUserById(ctx.db, c.get("user").id));
    return c.json({ defaultVisibility: user.default_visibility });
  });

  routes.put("/privacy", async (c) => {
    const ctx = c.get("ctx");
    const body = await parseBody(c, privacySettingsSchema);
    const user = present(await updateUser(ctx.db, c.get("user").id, body));
    return c.json({ defaultVisibility: user.default_visibility });
  });

  routes.post("/friend-code/rotate", async (c) => {
    const ctx = c.get("ctx");
    const user = present(await rotateFriendCode(ctx.db, c.get("user").id));
    return c.json(toPrivateUser(user));
  });

  /** A copy of everything we hold, as a download. */
  routes.get("/export", async (c) => {
    const ctx = c.get("ctx");
    const data = await exportAccount(ctx.db, c.get("user").id, ctx.now());
    if (!data) throw unauthenticated("This account no longer exists");

    c.header("content-disposition", `attachment; filename="whosonbreak-export.json"`);
    c.header("cache-control", "no-store");
    return c.json(data);
  });

  return routes;
}
