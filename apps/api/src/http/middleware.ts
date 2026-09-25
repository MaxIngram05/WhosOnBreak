/**
 * Cross-cutting request handling: identity, request ids, rate limiting, and the
 * one place errors become responses.
 */

import type { Context, MiddlewareHandler, Next } from "hono";
import { ZodError, type ZodTypeAny, type z } from "zod";
import type { AppBindings } from "../context.ts";
import { ApiProblem, badRequest, rateLimited, unauthenticated } from "./errors.ts";
import { verifyAccessToken } from "../auth/tokens.ts";

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
 * Unexpected errors are logged in full and reported as a bare 500. Echoing an
 * internal message back would leak table names and query fragments to anyone
 * who can trigger a bug.
 */
export function errorHandler(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    try {
      await next();
    } catch (error) {
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

      return c.json(
        { error: { code: "internal", message: "Something went wrong" } },
        500,
      );
    }
  };
}

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
 * Only the signature is checked, with no database lookup, which is the point of
 * using a JWT for the short-lived half of the pair. The cost is that deleting
 * an account leaves its access token working for up to fifteen minutes; the
 * refresh token is revoked immediately, so the session cannot outlive that.
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
    const userId = await verifyAccessToken(ctx.config, token);

    c.set("user", { id: userId });
    await next();
  };
}

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

/**
 * A token bucket, keyed by user when we know them and by IP when we do not.
 *
 * In-process, which is honest about what it is: with a single Worker isolate it
 * is a useful brake on a runaway client and a stolen-token guessing loop, and
 * it is not a defence against a distributed attacker. The interface is one
 * function, so moving the counters into a Durable Object or Redis later does
 * not touch any route.
 */
export function rateLimit(options: {
  capacity: number;
  refillPerSecond: number;
}): MiddlewareHandler<AppBindings> {
  const buckets = new Map<string, Bucket>();

  return async (c, next) => {
    const key =
      c.get("user")?.id ??
      c.req.header("cf-connecting-ip") ??
      c.req.header("x-forwarded-for") ??
      "anonymous";

    const nowMs = Date.now();
    const bucket = buckets.get(key) ?? {
      tokens: options.capacity,
      lastRefillMs: nowMs,
    };

    const elapsedSeconds = (nowMs - bucket.lastRefillMs) / 1000;
    bucket.tokens = Math.min(
      options.capacity,
      bucket.tokens + elapsedSeconds * options.refillPerSecond,
    );
    bucket.lastRefillMs = nowMs;

    if (bucket.tokens < 1) {
      buckets.set(key, bucket);
      throw rateLimited();
    }

    bucket.tokens -= 1;
    buckets.set(key, bucket);

    // Unbounded growth would be a slow leak in a long-lived isolate.
    if (buckets.size > 10_000) {
      for (const [existingKey, existing] of buckets) {
        if (existing.tokens >= options.capacity) buckets.delete(existingKey);
      }
    }

    await next();
  };
}

/** Hands the per-request context to every handler. */
export function withContext(
  factory: () => AppBindings["Variables"]["ctx"],
): MiddlewareHandler<AppBindings> {
  return async (c: Context<AppBindings>, next: Next) => {
    c.set("ctx", factory());
    await next();
  };
}
