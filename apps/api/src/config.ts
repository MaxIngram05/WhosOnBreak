/**
 * Configuration, validated once at startup rather than read ad hoc.
 *
 * A Worker gets its environment as an argument to fetch() and Node gets it on
 * process.env, so nothing below reads a global. Everything that needs config
 * is handed it, which is also why the tests can run the real app with a real
 * database and a throwaway signing key.
 */

import { z } from "zod";

const configSchema = z.object({
  databaseUrl: z.string().min(1, "DATABASE_URL is required"),

  /**
   * Signs our own access tokens. Must be long enough that brute-forcing a
   * signature is hopeless; 32 bytes of randomness is the floor.
   */
  jwtSecret: z.string().min(32, "JWT_SECRET must be at least 32 characters"),

  /**
   * Every OAuth client id that may present an ID token: the Android app, and
   * later the web app. A token minted for somebody else's client is not proof
   * that its holder meant to sign in to us, so this list is the audience check
   * and it is not optional.
   */
  googleClientIds: z.array(z.string().min(1)),

  /** Short, because a leaked access token cannot be revoked, only outlived. */
  accessTokenTtlSeconds: z.number().int().min(60).max(3600).default(900),

  /** Long, because these are revocable and rotated on every use. */
  refreshTokenTtlDays: z.number().int().min(1).max(365).default(60),

  environment: z.enum(["development", "test", "production"]).default("production"),

  /** Origins the web client may call from. Empty means same-origin only. */
  corsOrigins: z.array(z.string()).default([]),
}).refine(
  // Development has the dev sign-in route and can do without Google. Anywhere
  // else, no client ids would mean nobody can sign in at all.
  (config) => config.environment === "development" || config.googleClientIds.length > 0,
  { message: "GOOGLE_CLIENT_IDS is required", path: ["googleClientIds"] },
);

export type Config = z.infer<typeof configSchema>;

/** The shape of the raw environment, however the runtime supplies it. */
export interface RawEnv {
  DATABASE_URL?: string;
  JWT_SECRET?: string;
  GOOGLE_CLIENT_IDS?: string;
  ACCESS_TOKEN_TTL_SECONDS?: string;
  REFRESH_TOKEN_TTL_DAYS?: string;
  ENVIRONMENT?: string;
  CORS_ORIGINS?: string;
}

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * Throws on bad config, at startup, with every problem listed at once. A
 * service that boots with a missing signing key and only fails at the first
 * login is worse than one that refuses to boot.
 */
export function loadConfig(env: RawEnv): Config {
  const result = configSchema.safeParse({
    databaseUrl: env.DATABASE_URL,
    jwtSecret: env.JWT_SECRET,
    googleClientIds: splitList(env.GOOGLE_CLIENT_IDS),
    accessTokenTtlSeconds: env.ACCESS_TOKEN_TTL_SECONDS
      ? Number(env.ACCESS_TOKEN_TTL_SECONDS)
      : undefined,
    refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS
      ? Number(env.REFRESH_TOKEN_TTL_DAYS)
      : undefined,
    environment: env.ENVIRONMENT,
    corsOrigins: splitList(env.CORS_ORIGINS),
  });

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join(".") || "config"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid configuration -- ${problems}`);
  }

  return result.data;
}
