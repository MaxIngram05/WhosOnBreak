/**
 * Signing in, staying signed in, and signing out.
 */

import { Hono } from "hono";
import {
  googleSignInRequestSchema,
  logoutRequestSchema,
  refreshRequestSchema,
} from "@whosonbreak/contracts";
import type { AppBindings } from "../context.ts";
import { parseBody, requireAuth } from "../http/middleware.ts";
import { unauthenticated } from "../http/errors.ts";
import { findOrCreateUserForIdentity, findUserById } from "../repositories/users.ts";
import {
  consumeRefreshToken,
  revokeAllForUser,
  revokeFamily,
  revokeTokenByValue,
} from "../repositories/sessions.ts";
import { createSchedule } from "../repositories/schedules.ts";
import { issueSession } from "../services/session.ts";

export function authRoutes(): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  routes.post("/google", async (c) => {
    const ctx = c.get("ctx");
    const body = await parseBody(c, googleSignInRequestSchema);

    const identity = await ctx.google.verify(body.idToken);
    const { user, created } = await findOrCreateUserForIdentity(ctx.db, "google", identity);

    // A first sign-in lands on an empty schedule already in the right zone,
    // so the app can go straight to "add your classes".
    if (created && body.timeZone) {
      await createSchedule(
        ctx.db,
        user.id,
        { name: "My schedule", timeZone: body.timeZone, isActive: true, cycleWeeks: 1, blocks: [] },
        ctx.now(),
      );
    }

    const session = await issueSession(ctx, user, {
      userAgent: c.req.header("user-agent"),
    });
    return c.json(session, created ? 201 : 200);
  });

  routes.post("/refresh", async (c) => {
    const ctx = c.get("ctx");
    const body = await parseBody(c, refreshRequestSchema);

    const outcome = await consumeRefreshToken(ctx.db, body.refreshToken, ctx.now());
    if (outcome.kind !== "ok") {
      // One answer for every failure. The client's response is the same --
      // sign in again -- and the distinction is only useful to an attacker.
      throw unauthenticated("Refresh token is not valid");
    }

    const user = await findUserById(ctx.db, outcome.userId);
    if (!user) throw unauthenticated("Refresh token is not valid");

    const session = await issueSession(ctx, user, {
      familyId: outcome.familyId,
      userAgent: c.req.header("user-agent"),
    });
    return c.json(session);
  });

  routes.post("/logout", requireAuth(), async (c) => {
    const ctx = c.get("ctx");
    const user = c.get("user");
    const body = await parseBody(c, logoutRequestSchema);
    const now = ctx.now();

    if (body.allDevices) {
      await revokeAllForUser(ctx.db, user.id, now);
    } else if (body.refreshToken) {
      await revokeTokenByValue(ctx.db, body.refreshToken, now);
    } else {
      await revokeFamily(ctx.db, user.sessionId, now);
    }

    return c.body(null, 204);
  });

  return routes;
}
