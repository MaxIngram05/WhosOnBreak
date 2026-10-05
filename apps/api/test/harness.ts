/**
 * The real app, a real Postgres, and two things replaced: Google, and the
 * clock.
 *
 * Google is swapped for a verifier that trusts tokens of the form
 * `test:<subject>`, so tests can sign in as anybody without a network. The
 * clock is a variable, so a test can stand on a DST boundary or a particular
 * Monday at will. Everything else -- routing, middleware, SQL, constraints --
 * is the code that ships.
 */

import { fileURLToPath } from "node:url";
import { createApp, type AppOptions } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { createPgliteDatabase } from "../src/db/pglite.ts";
import { applyMigrations, loadMigrations } from "../src/db/migrate.ts";
import type { Database } from "../src/db/sql.ts";
import type { GoogleVerifier } from "../src/auth/google.ts";
import { unauthenticated } from "../src/http/errors.ts";
import { memoryRateLimiter } from "../src/http/rate-limit.ts";

function configFor(environment: string) {
  return loadConfig({
    DATABASE_URL: "pglite",
    JWT_SECRET: "test-secret-test-secret-test-secret-0123456789",
    GOOGLE_CLIENT_IDS: "test-client",
    ENVIRONMENT: environment,
  });
}

export const config = configFor("test");

const fakeGoogle: GoogleVerifier = {
  async verify(idToken) {
    if (!idToken.startsWith("test:")) throw unauthenticated("Not a test token");
    const subject = idToken.slice("test:".length);
    return {
      subject,
      email: `${subject}@test.invalid`,
      emailVerified: true,
      name: subject,
      pictureUrl: null,
    };
  },
};

let migrations: Awaited<ReturnType<typeof loadMigrations>> | undefined;

export interface Response<T = any> {
  status: number;
  body: T;
}

export interface SignedIn {
  id: string;
  token: string;
  refreshToken: string;
  friendCode: string;
  name: string;
}

export interface Harness {
  db: Database;
  /** Moves the server's clock. Access tokens use real time and are unaffected. */
  setNow(instant: Date | string): void;
  request<T = any>(
    method: string,
    path: string,
    options?: { token?: string; body?: unknown; headers?: Record<string, string> },
  ): Promise<Response<T>>;
  /** Signs in a brand-new user, unique per call, optionally with a schedule zone. */
  signIn(name?: string, timeZone?: string): Promise<SignedIn>;
  close(): Promise<void>;
}

let counter = 0;

export interface HarnessOptions extends AppOptions {
  /** Defaults to "test". "development" turns on the dev sign-in route. */
  environment?: "test" | "development" | "production";
}

export async function createHarness(
  options: HarnessOptions = { rateLimits: false },
): Promise<Harness> {
  migrations ??= await loadMigrations(
    fileURLToPath(new URL("../migrations", import.meta.url)),
  );

  const db = await createPgliteDatabase();
  await applyMigrations(db, migrations);

  let now = new Date("2026-10-07T12:00:00Z");
  const harnessConfig = configFor(options.environment ?? "test");
  const rateLimiter = memoryRateLimiter();
  const app = createApp(
    () => ({
      ctx: { config: harnessConfig, db, google: fakeGoogle, rateLimiter, now: () => now },
    }),
    options,
  );

  const harness: Harness = {
    db,

    setNow(instant) {
      now = new Date(instant);
    },

    async request(method, path, { token, body, headers } = {}) {
      const response = await app.request(path, {
        method,
        headers: {
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null };
    },

    async signIn(name = "user", timeZone) {
      const subject = `${name}-${++counter}`;
      const response = await harness.request("POST", "/v1/auth/google", {
        body: { idToken: `test:${subject}`, ...(timeZone ? { timeZone } : {}) },
      });
      if (response.status !== 201) {
        throw new Error(`Sign-in failed: ${response.status} ${JSON.stringify(response.body)}`);
      }
      return {
        id: response.body.user.id,
        token: response.body.accessToken,
        refreshToken: response.body.refreshToken,
        friendCode: response.body.user.friendCode,
        name: subject,
      };
    },

    close: () => db.close(),
  };

  return harness;
}

/** Minute-of-week for a weekday (0 = Monday) and a wall-clock time. */
export function at(day: number, hours: number, minutes = 0): number {
  return day * 1440 + hours * 60 + minutes;
}

/** Creates an active schedule with the given blocks and returns its id. */
export async function giveSchedule(
  harness: Harness,
  user: SignedIn,
  timeZone: string,
  blocks: Array<{ start: number; end: number; label?: string; weekIndex?: number }>,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const response = await harness.request("POST", "/v1/schedules", {
    token: user.token,
    body: { name: "Term", timeZone, blocks, ...extra },
  });
  if (response.status !== 201) {
    throw new Error(`Schedule failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return response.body.id;
}

/** Puts every listed user into one new group owned by the first. */
export async function groupOf(harness: Harness, owner: SignedIn, ...others: SignedIn[]) {
  const created = await harness.request("POST", "/v1/groups", {
    token: owner.token,
    body: { name: "Test group" },
  });
  for (const other of others) {
    await harness.request("POST", "/v1/groups/join", {
      token: other.token,
      body: { code: created.body.joinCode },
    });
  }
  return created.body as { id: string; joinCode: string };
}
