/**
 * Verifying a Google ID token.
 *
 * This is the one place Google appears in the codebase. It turns a token into
 * three facts -- subject, email, name -- and everything downstream deals only
 * in those, which is why adding Apple sign-in later means another file like
 * this one and no changes anywhere else.
 *
 * Verification is done properly rather than by decoding the payload: fetch
 * Google's public keys, check the signature, then check that the token was
 * issued *for us*. That last part is the one people skip, and skipping it means
 * anyone with a Google token for any app in the world can log in as anyone.
 */

import { createRemoteJWKSet, jwtVerify } from "jose";
import { unauthenticated } from "../http/errors.ts";

const GOOGLE_JWKS_URL = new URL("https://www.googleapis.com/oauth2/v3/certs");

/** Google signs as both, and has for years. Both are legitimate. */
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export interface GoogleIdentity {
  /** Google's stable id for this person. Never their email, which can change. */
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  pictureUrl: string | null;
}

/**
 * Cached across requests. The key set is fetched once and refreshed when
 * Google rotates, rather than on every sign-in.
 */
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

function keySet(): ReturnType<typeof createRemoteJWKSet> {
  jwks ??= createRemoteJWKSet(GOOGLE_JWKS_URL, {
    cooldownDuration: 30_000,
    cacheMaxAge: 10 * 60_000,
  });
  return jwks;
}

export interface GoogleVerifier {
  verify(idToken: string): Promise<GoogleIdentity>;
}

export function createGoogleVerifier(allowedClientIds: readonly string[]): GoogleVerifier {
  return {
    async verify(idToken: string): Promise<GoogleIdentity> {
      let payload;
      try {
        const verified = await jwtVerify(idToken, keySet(), {
          issuer: GOOGLE_ISSUERS,
          // The audience check. A token minted for a different OAuth client is
          // not consent to sign in here.
          audience: allowedClientIds as string[],
        });
        payload = verified.payload;
      } catch {
        throw unauthenticated("Google sign-in could not be verified");
      }

      const subject = typeof payload.sub === "string" ? payload.sub : null;
      const email = typeof payload.email === "string" ? payload.email : null;

      if (!subject || !email) {
        throw unauthenticated("Google sign-in did not include an email address");
      }

      // An unverified Google email would let someone claim an address they do
      // not own, and a matching email is how a second sign-in method is linked
      // to an existing account.
      if (payload.email_verified !== true) {
        throw unauthenticated("This Google account's email is not verified");
      }

      return {
        subject,
        email,
        emailVerified: true,
        name: typeof payload.name === "string" ? payload.name : null,
        pictureUrl: typeof payload.picture === "string" ? payload.picture : null,
      };
    },
  };
}
