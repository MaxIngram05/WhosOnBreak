/**
 * Refresh token storage, and the rotation rules that make it worth doing.
 *
 * The interesting behaviour is reuse detection. Every refresh burns the token
 * it was given and issues a new one in the same family. If a token that was
 * already burnt comes back, there are only two explanations -- it was stolen,
 * or we have a bug -- and in both cases the right move is to kill the family
 * and make the user sign in again. Silently issuing a new token instead would
 * mean a thief and the rightful owner taking turns indefinitely.
 */

import type { Sql } from "../db/sql.ts";
import { queryOne } from "../db/sql.ts";
import { hashRefreshToken } from "../auth/tokens.ts";

export interface RefreshTokenRow {
  id: string;
  user_id: string;
  family_id: string;
  expires_at: Date | string;
  revoked_at: Date | string | null;
  used_at: Date | string | null;
}

export interface StoredRefreshToken {
  id: string;
  familyId: string;
}

export async function storeRefreshToken(
  sql: Sql,
  params: {
    userId: string;
    token: string;
    /** Omitted for a fresh sign-in, which starts its own family. */
    familyId?: string;
    expiresAt: Date;
    userAgent?: string | null;
  },
): Promise<StoredRefreshToken> {
  const hash = await hashRefreshToken(params.token);

  const row = await queryOne<{ id: string; family_id: string }>(
    sql,
    `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at, user_agent)
     VALUES ($1, COALESCE($2::uuid, gen_random_uuid()), $3, $4, $5)
     RETURNING id, family_id`,
    [
      params.userId,
      params.familyId ?? null,
      hash,
      params.expiresAt.toISOString(),
      params.userAgent ?? null,
    ],
  );
  if (!row) throw new Error("Refresh token insert returned nothing");

  return { id: row.id, familyId: row.family_id };
}

export type RefreshOutcome =
  | { kind: "ok"; userId: string; familyId: string }
  /** Never seen, or belongs to nobody. */
  | { kind: "unknown" }
  | { kind: "expired" }
  /** Already used or revoked. The family has now been revoked as well. */
  | { kind: "reused" };

/**
 * Marks a refresh token used and reports what it was.
 *
 * Runs in a transaction and marks with a conditional UPDATE rather than a
 * SELECT followed by an UPDATE, so two simultaneous refreshes cannot both
 * succeed: the second finds zero rows affected and is treated as reuse.
 */
export async function consumeRefreshToken(
  sql: Sql,
  token: string,
  now: Date,
): Promise<RefreshOutcome> {
  const hash = await hashRefreshToken(token);

  return sql.transaction(async (tx) => {
    const existing = await queryOne<RefreshTokenRow>(
      tx,
      `SELECT id, user_id, family_id, expires_at, revoked_at, used_at
         FROM refresh_tokens WHERE token_hash = $1`,
      [hash],
    );
    if (!existing) return { kind: "unknown" };

    if (existing.used_at !== null || existing.revoked_at !== null) {
      await revokeFamily(tx, existing.family_id, now);
      return { kind: "reused" };
    }

    if (new Date(existing.expires_at).getTime() <= now.getTime()) {
      return { kind: "expired" };
    }

    const claimed = await tx.query<{ id: string }>(
      `UPDATE refresh_tokens
          SET used_at = $2
        WHERE id = $1 AND used_at IS NULL AND revoked_at IS NULL
        RETURNING id`,
      [existing.id, now.toISOString()],
    );

    // Somebody else claimed it between the read and the write.
    if (claimed.length === 0) {
      await revokeFamily(tx, existing.family_id, now);
      return { kind: "reused" };
    }

    return { kind: "ok", userId: existing.user_id, familyId: existing.family_id };
  });
}

/** Ends one device's session, including any token descended from it. */
export async function revokeFamily(
  sql: Sql,
  familyId: string,
  now: Date,
): Promise<void> {
  await sql.query(
    `UPDATE refresh_tokens SET revoked_at = $2
      WHERE family_id = $1 AND revoked_at IS NULL`,
    [familyId, now.toISOString()],
  );
}

/** Ends every session. What "sign out everywhere" and a lost phone need. */
export async function revokeAllForUser(
  sql: Sql,
  userId: string,
  now: Date,
): Promise<void> {
  await sql.query(
    `UPDATE refresh_tokens SET revoked_at = $2
      WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId, now.toISOString()],
  );
}

export async function revokeTokenByValue(
  sql: Sql,
  token: string,
  now: Date,
): Promise<void> {
  const hash = await hashRefreshToken(token);
  const row = await queryOne<{ family_id: string }>(
    sql,
    `SELECT family_id FROM refresh_tokens WHERE token_hash = $1`,
    [hash],
  );
  if (row) await revokeFamily(sql, row.family_id, now);
}

/**
 * Housekeeping. Expired rows are harmless but unbounded, and this table is the
 * only one in the schema that grows with use rather than with users.
 */
export async function deleteExpiredTokens(sql: Sql, now: Date): Promise<number> {
  const deleted = await sql.query<{ id: string }>(
    `DELETE FROM refresh_tokens WHERE expires_at < $1 RETURNING id`,
    [now.toISOString()],
  );
  return deleted.length;
}
