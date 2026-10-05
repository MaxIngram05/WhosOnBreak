/**
 * The production entry point: a Cloudflare Worker.
 *
 * Config and the Google key cache live for the life of the isolate. The
 * database pool does not: a Worker may not carry I/O objects from one request
 * into the next, so each request opens its own and closes it after the
 * response has gone, off the critical path.
 */

import { createApp } from "./app.ts";
import { loadConfig, type Config, type RawEnv } from "./config.ts";
import { createNeonDatabase } from "./db/neon.ts";
import { createGoogleVerifier, type GoogleVerifier } from "./auth/google.ts";
import {
  durableRateLimiter,
  type DurableObjectNamespaceLike,
  type RateLimiter,
} from "./http/rate-limit.ts";
import { deleteExpiredTokens } from "./repositories/sessions.ts";

// Wrangler finds Durable Object classes by their export from the entry point.
export { RateLimiterObject } from "./http/rate-limit.ts";

interface Env extends RawEnv {
  RATE_LIMITER: DurableObjectNamespaceLike;
}

/** The two methods of Cloudflare's ExecutionContext this file uses. */
interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

let shared: { config: Config; google: GoogleVerifier; rateLimiter: RateLimiter } | undefined;

function setup(env: Env) {
  if (!shared) {
    const config = loadConfig(env);
    shared = {
      config,
      google: createGoogleVerifier(config.googleClientIds),
      rateLimiter: durableRateLimiter(env.RATE_LIMITER),
    };
  }
  return shared;
}

const app = createApp((c) => {
  const { config, google, rateLimiter } = setup(c.env as Env);
  const db = createNeonDatabase(config.databaseUrl);

  return {
    ctx: { config, db, google, rateLimiter, now: () => new Date() },
    release: () => c.executionCtx.waitUntil(db.close()),
  };
});

export default {
  fetch: app.fetch,

  /**
   * Nightly housekeeping, on the cron in wrangler.toml. Expired refresh
   * tokens are harmless but they are the one table that grows with use rather
   * than with users, so they are cleared rather than left to accumulate.
   */
  async scheduled(_controller: unknown, env: Env, ctx: ExecutionContextLike): Promise<void> {
    const { config } = setup(env);
    const db = createNeonDatabase(config.databaseUrl);
    ctx.waitUntil(
      (async () => {
        try {
          const removed = await deleteExpiredTokens(db, new Date());
          console.log(JSON.stringify({ level: "info", message: "cleanup", removed }));
        } finally {
          await db.close();
        }
      })(),
    );
  },
};
