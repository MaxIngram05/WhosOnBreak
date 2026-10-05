/**
 * Token buckets, behind one interface with two homes.
 *
 * In memory, a bucket lives in one process. That is exact for the Node server
 * and the tests, and useless on Workers for anything that matters: Cloudflare
 * spreads requests across many isolates, so an attacker guessing friend codes
 * gets a fresh bucket every time they land somewhere new.
 *
 * So the limits that guard something -- sign-in, sending friend requests --
 * go through a Durable Object in production. Each key is its own object, and
 * Cloudflare guarantees one instance of it worldwide, which is what makes the
 * count real. The general per-user brake stays in memory: it is there to stop
 * a runaway client, and paying a Durable Object round trip on every request
 * for that would double the cost of the API.
 */

export interface RateLimiter {
  /** Takes one token from `key`'s bucket. False means the bucket was empty. */
  take(key: string, capacity: number, refillPerSecond: number): Promise<boolean>;
}

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

/** Refills a bucket for elapsed time and tries to take a token. Mutates. */
export function takeFromBucket(
  bucket: Bucket,
  capacity: number,
  refillPerSecond: number,
  nowMs: number,
): boolean {
  const elapsedSeconds = Math.max(0, (nowMs - bucket.lastRefillMs) / 1000);
  bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSeconds * refillPerSecond);
  bucket.lastRefillMs = nowMs;

  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

export function memoryRateLimiter(): RateLimiter {
  const buckets = new Map<string, Bucket>();

  return {
    async take(key, capacity, refillPerSecond) {
      const nowMs = Date.now();
      const bucket = buckets.get(key) ?? { tokens: capacity, lastRefillMs: nowMs };
      const allowed = takeFromBucket(bucket, capacity, refillPerSecond, nowMs);
      buckets.set(key, bucket);

      // Unbounded growth would be a slow leak in a long-lived process.
      if (buckets.size > 10_000) {
        for (const [existingKey, existing] of buckets) {
          if (existing.tokens >= capacity) buckets.delete(existingKey);
        }
      }
      return allowed;
    },
  };
}

// ---------------------------------------------------------------------------
// Durable Object
// ---------------------------------------------------------------------------

/** The slice of the Workers types this file uses, declared here rather than
 * pulling in the full Workers type package for three methods. */
interface DurableObjectStub {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

export interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStub;
}

interface DurableObjectStateLike {
  storage: {
    get<T>(key: string): Promise<T | undefined>;
    put<T>(key: string, value: T): Promise<void>;
  };
}

/**
 * One bucket, as a Durable Object. Kept in the object's storage rather than a
 * field, so the count survives Cloudflare evicting an idle object -- otherwise
 * going quiet for a minute would be a way to reset the limit.
 */
export class RateLimiterObject {
  private readonly state: DurableObjectStateLike;

  constructor(state: DurableObjectStateLike) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const capacity = Number(url.searchParams.get("capacity"));
    const refillPerSecond = Number(url.searchParams.get("refill"));
    if (!(capacity > 0) || !(refillPerSecond > 0)) {
      return new Response("bad limit", { status: 400 });
    }

    const nowMs = Date.now();
    const bucket = (await this.state.storage.get<Bucket>("bucket")) ?? {
      tokens: capacity,
      lastRefillMs: nowMs,
    };
    const allowed = takeFromBucket(bucket, capacity, refillPerSecond, nowMs);
    await this.state.storage.put("bucket", bucket);

    return Response.json({ allowed });
  }
}

/**
 * Fails open. If the Durable Object cannot be reached, the request goes
 * through and the failure is logged: a rate limiter that takes the API down
 * with it has caused the outage it exists to prevent.
 */
export function durableRateLimiter(namespace: DurableObjectNamespaceLike): RateLimiter {
  return {
    async take(key, capacity, refillPerSecond) {
      try {
        const stub = namespace.get(namespace.idFromName(key));
        const response = await stub.fetch(
          `https://rate-limiter/take?capacity=${capacity}&refill=${refillPerSecond}`,
        );
        if (!response.ok) throw new Error(`Rate limiter answered ${response.status}`);
        const body = (await response.json()) as { allowed: boolean };
        return body.allowed;
      } catch (error) {
        console.error(
          JSON.stringify({
            level: "error",
            message: "rate limiter unavailable",
            detail: error instanceof Error ? error.message : String(error),
          }),
        );
        return true;
      }
    },
  };
}
