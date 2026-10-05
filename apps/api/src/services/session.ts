/**
 * Minting a session: one access token, one refresh token, and the stored hash
 * that makes the second one revocable.
 *
 * Shared by sign-in and refresh so the two can never drift apart on what a
 * session contains.
 */

import type { Session } from "@whosonbreak/contracts";
import type { AppContext } from "../context.ts";
import { generateRefreshToken, signAccessToken } from "../auth/tokens.ts";
import { storeRefreshToken } from "../repositories/sessions.ts";
import { toPrivateUser, type UserRow } from "../repositories/users.ts";

const MS_PER_DAY = 24 * 60 * 60_000;

export async function issueSession(
  ctx: AppContext,
  user: UserRow,
  options: {
    /** The family a refreshed token continues. Omitted for a new sign-in. */
    familyId?: string;
    userAgent?: string | null;
  } = {},
): Promise<Session> {
  const refreshToken = generateRefreshToken();
  const stored = await storeRefreshToken(ctx.db, {
    userId: user.id,
    token: refreshToken,
    familyId: options.familyId,
    expiresAt: new Date(ctx.now().getTime() + ctx.config.refreshTokenTtlDays * MS_PER_DAY),
    // Bounded: it is a client-supplied string going into a table.
    userAgent: options.userAgent?.slice(0, 200) ?? null,
  });

  return {
    accessToken: await signAccessToken(ctx.config, user.id, stored.familyId),
    expiresIn: ctx.config.accessTokenTtlSeconds,
    refreshToken,
    user: toPrivateUser(user),
  };
}
