/**
 * What a request has access to.
 *
 * Nothing in this service reaches for a module-level database handle or calls
 * `new Date()` in business logic. Both come from here, which is what makes the
 * DST behaviour testable: a test can say "it is the Sunday the clocks change"
 * without waiting for March.
 */

import type { Config } from "./config.ts";
import type { Database } from "./db/sql.ts";
import type { GoogleVerifier } from "./auth/google.ts";
import type { RateLimiter } from "./http/rate-limit.ts";

export interface AppContext {
  config: Config;
  db: Database;
  google: GoogleVerifier;
  /** For limits that must hold across every instance of the service. */
  rateLimiter: RateLimiter;
  /** Injected so tests can pin the current instant. */
  now(): Date;
}

/** Set by the auth middleware on every request that reached a protected route. */
export interface AuthenticatedUser {
  id: string;
  /** The refresh token family behind this request's access token. */
  sessionId: string;
}

/** The Hono variable map, so `c.get("user")` is typed rather than `any`. */
export interface AppBindings {
  Variables: {
    ctx: AppContext;
    user: AuthenticatedUser;
    requestId: string;
  };
}
