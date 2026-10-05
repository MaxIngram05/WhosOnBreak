/**
 * The whole HTTP surface, assembled.
 *
 * Runtime-agnostic: the Worker, the Node dev server and the tests all build
 * this same app and differ only in how they produce a request's context. That
 * is what makes an integration test here a test of production behaviour
 * rather than of a lookalike.
 */

import { Hono, type MiddlewareHandler } from "hono";
import type { AppBindings } from "./context.ts";
import { notFound } from "./http/errors.ts";
import {
  handleError,
  rateLimit,
  requestId,
  requireAuth,
  withContext,
} from "./http/middleware.ts";
import { authRoutes } from "./routes/auth.ts";
import { meRoutes } from "./routes/me.ts";
import { scheduleRoutes } from "./routes/schedules.ts";
import { friendRoutes } from "./routes/friends.ts";
import { groupRoutes } from "./routes/groups.ts";
import { breakRoutes } from "./routes/breaks.ts";
import { inviteRoutes } from "./routes/invites.ts";
import { peopleRoutes } from "./routes/people.ts";

export type ContextFactory = Parameters<typeof withContext>[0];

export interface AppOptions {
  /**
   * Off only in tests, which sign in dozens of users from one "address" in a
   * few milliseconds. The limiter itself has its own test.
   */
  rateLimits?: boolean;
}

const passThrough: MiddlewareHandler<AppBindings> = async (_c, next) => {
  await next();
};

export function createApp(contextFor: ContextFactory, options: AppOptions = {}) {
  const limited = options.rateLimits !== false;
  const limit = (
    name: string,
    capacity: number,
    refillPerSecond: number,
    durable = false,
  ) => (limited ? rateLimit({ name, capacity, refillPerSecond, durable }) : passThrough);

  const app = new Hono<AppBindings>();

  app.onError(handleError);
  app.notFound((c) => c.json(notFound("No such route").toBody(), 404));

  app.use("*", requestId());
  app.use("*", withContext(contextFor));

  /** For uptime checks. Deliberately does not touch the database. */
  app.get("/health", (c) => c.json({ ok: true }));

  // Unauthenticated, so limited by address, and durably: these are what a
  // credential-stuffing script would hit, and it would hit them from
  // everywhere at once.
  const auth = new Hono<AppBindings>();
  const signInLimit = limit("sign-in", 10, 0.2, true);
  auth.use("/google", signInLimit);
  auth.use("/dev", signInLimit);
  auth.use("/refresh", limit("refresh", 10, 0.2, true));
  auth.route("/", authRoutes());

  // Everything else needs a session, and is limited per user.
  const api = new Hono<AppBindings>();
  api.use("*", requireAuth(), limit("api", 120, 2));
  api.route("/me", meRoutes());
  api.route("/schedules", scheduleRoutes());
  // Durable: this is where someone guessing friend codes would knock.
  api.route("/friends", friendRoutes({ requestLimit: limit("friend-request", 20, 1 / 20, true) }));
  api.route("/groups", groupRoutes());
  api.route("/invites", inviteRoutes());
  api.route("/people", peopleRoutes());
  api.route("/breaks", breakRoutes());

  app.route("/v1/auth", auth);
  app.route("/v1", api);

  return app;
}
