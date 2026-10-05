/**
 * The pieces that only matter in production -- rate limiting across isolates,
 * dev-only sign-in, writes from deleted accounts -- tested without production.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHarness, type Harness } from "./harness.ts";
import {
  RateLimiterObject,
  durableRateLimiter,
  takeFromBucket,
  type DurableObjectNamespaceLike,
} from "../src/http/rate-limit.ts";
import { deleteExpiredTokens } from "../src/repositories/sessions.ts";

describe("token buckets", () => {
  it("allow a burst up to capacity, then refill over time", () => {
    const bucket = { tokens: 3, lastRefillMs: 0 };
    const results = [0, 0, 0, 0].map(() => takeFromBucket(bucket, 3, 1, 0));
    expect(results).toEqual([true, true, true, false]);

    expect(takeFromBucket(bucket, 3, 1, 1000)).toBe(true);
    expect(takeFromBucket(bucket, 3, 1, 1000)).toBe(false);
  });
});

/** A namespace whose objects keep storage in a map, as Cloudflare's do. */
function fakeNamespace(): DurableObjectNamespaceLike {
  const objects = new Map<string, RateLimiterObject>();
  return {
    idFromName: (name) => name,
    get(id) {
      const key = id as string;
      let object = objects.get(key);
      if (!object) {
        const store = new Map<string, unknown>();
        object = new RateLimiterObject({
          storage: {
            get: async <T>(k: string) => store.get(k) as T | undefined,
            put: async <T>(k: string, v: T) => void store.set(k, v),
          },
        });
        objects.set(key, object);
      }
      const target = object;
      return { fetch: (input: string, init?: RequestInit) => target.fetch(new Request(input, init)) };
    },
  };
}

describe("the Durable Object rate limiter", () => {
  it("counts per key, in one place", async () => {
    const limiter = durableRateLimiter(fakeNamespace());

    // Sequential: a real Durable Object serialises concurrent requests with its
    // input gate, which this fake does not model.
    const first: boolean[] = [];
    for (let i = 0; i < 3; i++) first.push(await limiter.take("sign-in:1.2.3.4", 2, 0.001));
    expect(first).toEqual([true, true, false]);

    // A different caller has their own bucket.
    expect(await limiter.take("sign-in:5.6.7.8", 2, 0.001)).toBe(true);
  });

  it("lets requests through if the object cannot be reached", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken: DurableObjectNamespaceLike = {
      idFromName: (name) => name,
      get: () => ({ fetch: () => Promise.reject(new Error("unreachable")) }),
    };

    expect(await durableRateLimiter(broken).take("any", 1, 1)).toBe(true);
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe("dev sign-in", () => {
  let dev: Harness;
  let normal: Harness;
  beforeAll(async () => {
    dev = await createHarness({ rateLimits: false, environment: "development" });
    normal = await createHarness();
  });
  afterAll(async () => {
    await dev.close();
    await normal.close();
  });

  it("signs in by name in development, as the same account every time", async () => {
    const first = await dev.request("POST", "/v1/auth/dev", {
      body: { name: "Ada", timeZone: "Europe/London" },
    });
    const again = await dev.request("POST", "/v1/auth/dev", { body: { name: "ada" } });

    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.user.id).toBe(first.body.user.id);
  });

  it("does not exist anywhere else", async () => {
    const response = await normal.request("POST", "/v1/auth/dev", { body: { name: "Ada" } });
    expect(response.status).toBe(404);
  });
});

describe("a deleted account's leftover access token", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());

  it("gets a 401 on writes rather than a 500", async () => {
    const user = await h.signIn();
    await h.request("DELETE", "/v1/me", { token: user.token });

    const write = await h.request("POST", "/v1/groups", {
      token: user.token,
      body: { name: "Ghost group" },
    });
    expect(write.status).toBe(401);
  });

  it("cleans up expired refresh tokens and leaves live ones", async () => {
    const user = await h.signIn();
    await h.db.query(
      `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at)
       VALUES ($1, gen_random_uuid(), 'expired-hash', now() - interval '1 day')`,
      [user.id],
    );

    const removed = await deleteExpiredTokens(h.db, new Date());
    expect(removed).toBeGreaterThanOrEqual(1);

    const live = await h.request("POST", "/v1/auth/refresh", { body: { refreshToken: user.refreshToken } });
    expect(live.status).toBe(200);
  });
});
