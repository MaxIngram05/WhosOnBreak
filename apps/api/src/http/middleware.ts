/**
 * Cross-cutting request handling: identity, request ids, rate limiting, and the
 * one place errors become responses.
 */

import type { Context, ErrorHandler, MiddlewareHandler, Next } from "hono";
import { ZodError, type ZodTypeAny, type z } from "zod";
import type { AppBindings } from "../context.ts";
import { ApiProblem, badRequest, notFound, rateLimited, unauthenticated } from "./errors.ts";
import { verifyAccessToken } from "../auth/tokens.ts";
import { memoryRateLimiter } from "./rate-limit.ts";

/**
 * Tags every request so a log line can be traced to a client report. Honours a
 * client-supplied id when there is one, which is how a mobile crash report and
 * a server log get stitched together.
 */
export function requestId(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const incoming = c.req.header("x-request-id");
    const id = incoming && incoming.length <= 64 ? incoming : crypto.randomUUID();
    c.set("requestId", id);
    c.header("x-request-id", id);
    await next();
  };
}

/**
 * Turns anything thrown into the single error shape from the contracts package.
 *
 * Registered with `app.onError` rather than as a try/catch middleware: Hono
 * catches whatever a handler throws before it can propagate back up through
 * `await next()`, so a wrapping middleware would never see it.
 *
 * Unexpected errors are logged in full and reported as a bare 500. Echoing an
 * internal message back would leak table names and query fragments to anyone
 * who can trigger a bug.
 */
export const handleError: ErrorHandler<AppBindings> = (error, c) => {
  if (error instanceof ApiProblem) {
    return c.json(error.toBody(), error.status as 400);
  }

  if (error instanceof ZodError) {
    const problem = fromZodError(error);
    return c.json(problem.toBody(), problem.status as 400);
  }

  console.error(
    JSON.stringify({
      level: "error",
      requestId: c.get("requestId"),
      path: c.req.path,
      method: c.req.method,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }),
  );

  return c.json({ error: { code: "internal", message: "Something went wrong" } }, 500);
};

function fromZodError(error: ZodError): ApiProblem {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    (fields[key] ??= []).push(issue.message);
  }
  return badRequest("That request was not valid", fields);
}

/** Parses a JSON body against a schema, or throws a 400 listing every problem. */
export async function parseBody<Schema extends ZodTypeAny>(
  c: Context<AppBindings>,
  schema: Schema,
): Promise<z.infer<Schema>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw badRequest("Expected a JSON body");
  }

  const result = schema.safeParse(raw);
  if (!result.success) throw fromZodError(result.error);
  return result.data;
}

/** Same, for query strings. Repeated keys arrive as arrays. */
export function parseQuery<Schema extends ZodTypeAny>(
  c: Context<AppBindings>,
  schema: Schema,
): z.infer<Schema> {
  const raw: Record<string, string | string[]> = {};
  for (const [key, value] of new URL(c.req.url).searchParams.entries()) {
    const existing = raw[key];
    if (existing === undefined) raw[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else raw[key] = [existing, value];
  }

  const result = schema.safeParse(raw);
  if (!result.success) throw fromZodError(result.error);
  return result.data;
}

/**
 * Requires a valid bearer token and puts the user id on the context.
 *
 * Reads check only the signature, with no database lookup, which is the point
 * of using a JWT for the short-lived half of the pair. Writes also confirm the
 * account still exists, because deleting an account leaves its access token
 * validly signed for up to fifteen minutes. The refresh token is revoked
 * immediately, so the session cannot outlive that.
 */
export function requireAuth(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const header = c.req.header("authorization");
    if (!header?.toLowerCase().startsWith("bearer ")) {
      throw unauthenticated("Expected a bearer token");
    }

    const token = header.slice("bearer ".length).trim();
    if (!token) throw unauthenticated("Expected a bearer token");

    const ctx = c.get("ctx");
    const { userId, sessionId } = await verifyAccessToken(ctx.config, token);

    // A write by a deleted account would otherwise reach a foreign key and
    // come back as a 500. One primary-key lookup on writes only; reads by a
    // deleted account simply find nothing.
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      const exists = await ctx.db.query("SELECT 1 FROM users WHERE id = $1", [userId]);
      if (exists.length === 0) throw unauthenticated("This account no longer exists");
    }

    c.set("user", { id: userId, sessionId });
    await next();
  };
}

/**
 * A token bucket, keyed by user when we know them and by IP when we do not.
 *
 * `durable` limits go through the context's limiter -- a Durable Object in
 * production, so the count holds across every isolate. The rest use a bucket
 * local to this process; see rate-limit.ts for why both exist.
 */
export function rateLimit(options: {
  name: string;
  capacity: number;
  refillPerSecond: number;
  durable?: boolean;
}): MiddlewareHandler<AppBindings> {
  const local = memoryRateLimiter();

  return async (c, next) => {
    const who =
      c.get("user")?.id ??
      c.req.header("cf-connecting-ip") ??
      c.req.header("x-forwarded-for") ??
      "anonymous";

    const limiter = options.durable ? c.get("ctx").rateLimiter : local;
    const allowed = await limiter.take(
      `${options.name}:${who}`,
      options.capacity,
      options.refillPerSecond,
    );
    if (!allowed) throw rateLimited();

    await next();
  };
}

/**
 * Hands the per-request context to every handler.
 *
 * The factory sees the request because on Workers that is where the
 * environment lives. Whatever it returns as `release` runs once the response
 * is ready -- how a per-request database pool gets closed.
 */
export function withContext(
  factory: (c: Context<AppBindings>) => {
    ctx: AppBindings["Variables"]["ctx"];
    release?: () => void;
  },
): MiddlewareHandler<AppBindings> {
  return async (c: Context<AppBindings>, next: Next) => {
    const { ctx, release } = factory(c);
    c.set("ctx", ctx);
    try {
      await next();
    } finally {
      release?.();
    }
  };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A path segment that has to be a UUID. Anything else is reported as not
 * found, which is what it is, rather than reaching Postgres as a malformed
 * literal and coming back as a 500.
 */
export function uuidParam(c: Context<AppBindings>, name: string): string {
  const value = c.req.param(name);
  if (!value || !UUID_PATTERN.test(value)) throw notFound();
  return value;
}
