/**
 * Our own session tokens.
 *
 * Google tells us who someone is, once. Everything after that is ours, because
 * an app that re-verified a Google token on every request would be slow, would
 * be broken whenever Google is, and would have no way to end a session.
 *
 * The split is the usual one, for the usual reason:
 *
 * - The access token is a signed JWT. Verifying it is arithmetic, no database
 *   round trip, which is what keeps a serverless request cheap. The cost is
 *   that it cannot be revoked, so it lives fifteen minutes.
 * - The refresh token is an opaque random string, stored only as a hash. It
 *   can be revoked, and it is single-use: presenting one returns a new one and
 *   burns the old. A burnt token coming back means it was copied, so the whole
 *   family dies.
 *
 * Everything here uses WebCrypto, which both Node and Workers have natively.
 */

import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import type { Config } from "../config.ts";
import { unauthenticated } from "../http/errors.ts";

const ISSUER = "whosonbreak";
const AUDIENCE = "whosonbreak-app";

/** Claims we put in, and the only ones we read back out. */
export interface AccessTokenClaims extends JWTPayload {
  sub: string;
}

function secretKey(config: Config): Uint8Array {
  return new TextEncoder().encode(config.jwtSecret);
}

export async function signAccessToken(config: Config, userId: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + config.accessTokenTtlSeconds)
    .sign(secretKey(config));
}

/** Returns the user id, or throws a 401. Never returns for an invalid token. */
export async function verifyAccessToken(config: Config, token: string): Promise<string> {
  try {
    const { payload } = await jwtVerify<AccessTokenClaims>(token, secretKey(config), {
      issuer: ISSUER,
      audience: AUDIENCE,
      // Only the algorithm we sign with. Without this, a token could ask to be
      // verified some other way.
      algorithms: ["HS256"],
    });

    if (!payload.sub) throw new Error("No subject");
    return payload.sub;
  } catch {
    // The reason is never reported back: "expired" and "forged" look the same
    // to a caller, and only one of them is anyone's business.
    throw unauthenticated("Access token is not valid");
  }
}

const REFRESH_TOKEN_BYTES = 32;

/**
 * 256 bits from the platform CSPRNG, base64url so it survives a JSON body and
 * a header without escaping.
 */
export function generateRefreshToken(): string {
  const bytes = new Uint8Array(REFRESH_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/**
 * What goes in the database. SHA-256 with no salt is right here and would be
 * wrong for a password: these are already full-entropy random strings, so
 * there is no dictionary to attack and nothing for a salt to defend against.
 */
export async function hashRefreshToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A join code, or anything else short and human-readable but unguessable. */
export function randomCode(alphabet: string, length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);

  let code = "";
  for (const byte of bytes) {
    // Modulo bias across a 31-character alphabet is a fraction of a percent,
    // and the code's job is to be unguessable enough for a classroom, not to
    // be a key.
    code += alphabet[byte % alphabet.length];
  }
  return code;
}
