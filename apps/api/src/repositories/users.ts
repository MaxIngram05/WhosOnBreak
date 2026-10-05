/**
 * Users and the external identities that map onto them.
 */

import {
  FRIEND_CODE_LENGTH,
  JOIN_CODE_ALPHABET,
  type AuthProvider,
  type PrivateUser,
  type PublicUser,
  type Visibility,
} from "@whosonbreak/contracts";
import type { Sql } from "../db/sql.ts";
import { PG_ERROR, isPgError, queryOne } from "../db/sql.ts";
import type { GoogleIdentity } from "../auth/google.ts";
import { randomCode } from "../auth/tokens.ts";

/** The columns anyone else is allowed to learn about a person. */
export interface PublicUserRow {
  id: string;
  display_name: string;
  avatar_url: string | null;
}

export interface UserRow extends PublicUserRow {
  email: string;
  default_visibility: Visibility;
  friend_code: string;
  created_at: Date | string;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function toPublicUser(row: PublicUserRow): PublicUser {
  return {
    id: row.id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
  };
}

export function toPrivateUser(row: UserRow): PrivateUser {
  return {
    ...toPublicUser(row),
    email: row.email,
    defaultVisibility: row.default_visibility,
    friendCode: row.friend_code,
    createdAt: toIsoString(row.created_at),
  };
}

const USER_COLUMNS = `id, email, display_name, avatar_url, default_visibility, friend_code, created_at`;

/** The same columns qualified for a join where `u` is the users table. */
const USER_COLUMNS_U = USER_COLUMNS.split(", ")
  .map((column) => `u.${column}`)
  .join(", ");

function newFriendCode(): string {
  return randomCode(JOIN_CODE_ALPHABET, FRIEND_CODE_LENGTH);
}

export function findUserById(sql: Sql, id: string): Promise<UserRow | undefined> {
  return queryOne<UserRow>(sql, `SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
}

export function findUserByEmail(sql: Sql, email: string): Promise<UserRow | undefined> {
  return queryOne<UserRow>(
    sql,
    `SELECT ${USER_COLUMNS} FROM users WHERE lower(email) = lower($1)`,
    [email],
  );
}

/** Expects a code already normalised by `friendCodeSchema`. */
export function findUserByFriendCode(sql: Sql, code: string): Promise<UserRow | undefined> {
  return queryOne<UserRow>(
    sql,
    `SELECT ${USER_COLUMNS} FROM users WHERE friend_code = $1`,
    [code],
  );
}

export async function findUsersByIds(
  sql: Sql,
  ids: readonly string[],
): Promise<UserRow[]> {
  if (ids.length === 0) return [];
  return sql.query<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users WHERE id = ANY($1::uuid[])`,
    [ids],
  );
}

/**
 * Turns a verified external identity into a user, creating one if this is a
 * first sign-in.
 *
 * Three cases, and the third is the interesting one:
 *
 * 1. We have seen this Google subject before, so it is a returning user.
 * 2. We have not, and no account holds that email, so create both.
 * 3. We have not, but an account already holds that email. This is the same
 *    person -- they signed up some other way, or we added a second provider --
 *    so link the identity to the existing account rather than failing on the
 *    unique email index or, worse, quietly creating a second account that owns
 *    none of their groups.
 *
 * All of it in one transaction, because two devices signing in at the same
 * moment would otherwise both decide they are case 2.
 */
export async function findOrCreateUserForIdentity(
  sql: Sql,
  provider: AuthProvider,
  identity: GoogleIdentity,
): Promise<{ user: UserRow; created: boolean }> {
  return sql.transaction(async (tx) => {
    const existing = await queryOne<UserRow>(
      tx,
      `SELECT ${USER_COLUMNS_U}
         FROM identities i
         JOIN users u ON u.id = i.user_id
        WHERE i.provider = $1 AND i.provider_subject = $2`,
      [provider, identity.subject],
    );
    if (existing) return { user: existing, created: false };

    const byEmail = await findUserByEmail(tx, identity.email);
    if (byEmail) {
      await tx.query(
        `INSERT INTO identities (user_id, provider, provider_subject)
         VALUES ($1, $2, $3)
         ON CONFLICT (provider, provider_subject) DO NOTHING`,
        [byEmail.id, provider, identity.subject],
      );
      return { user: byEmail, created: false };
    }

    // ON CONFLICT rather than catching the violation: inside a transaction a
    // failed statement poisons everything after it, so a friend code clash has
    // to be something we can retry in place.
    let inserted: UserRow | undefined;
    for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
      inserted = await queryOne<UserRow>(
        tx,
        `INSERT INTO users (email, display_name, avatar_url, friend_code)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (friend_code) DO NOTHING
         RETURNING ${USER_COLUMNS}`,
        [
          identity.email,
          // Falling back to the local part beats showing a blank name; people
          // rename themselves later anyway.
          identity.name?.trim() || identity.email.split("@")[0] || "Someone",
          identity.pictureUrl,
          newFriendCode(),
        ],
      );
    }
    if (!inserted) throw new Error("Could not allocate a unique friend code");

    await tx.query(
      `INSERT INTO identities (user_id, provider, provider_subject) VALUES ($1, $2, $3)`,
      [inserted.id, provider, identity.subject],
    );

    return { user: inserted, created: true };
  });
}

export async function updateUser(
  sql: Sql,
  id: string,
  changes: { displayName?: string; defaultVisibility?: Visibility },
): Promise<UserRow | undefined> {
  const assignments: string[] = [];
  const params: unknown[] = [];

  if (changes.displayName !== undefined) {
    params.push(changes.displayName);
    assignments.push(`display_name = $${params.length}`);
  }
  if (changes.defaultVisibility !== undefined) {
    params.push(changes.defaultVisibility);
    assignments.push(`default_visibility = $${params.length}`);
  }
  if (assignments.length === 0) return findUserById(sql, id);

  assignments.push(`updated_at = now()`);
  params.push(id);

  return queryOne<UserRow>(
    sql,
    `UPDATE users SET ${assignments.join(", ")}
      WHERE id = $${params.length}
      RETURNING ${USER_COLUMNS}`,
    params,
  );
}

/**
 * Issues a new friend code, so the old one -- posted somewhere, or in a
 * screenshot of the QR -- stops reaching this person. Requests already sent
 * with it are untouched; declining those is a separate decision.
 */
export async function rotateFriendCode(sql: Sql, id: string): Promise<UserRow | undefined> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await queryOne<UserRow>(
        sql,
        `UPDATE users SET friend_code = $2, updated_at = now()
          WHERE id = $1
          RETURNING ${USER_COLUMNS}`,
        [id, newFriendCode()],
      );
    } catch (error) {
      if (!isPgError(error, PG_ERROR.uniqueViolation)) throw error;
    }
  }
  throw new Error("Could not allocate a unique friend code");
}

/**
 * Erases an account and everything hanging off it.
 *
 * Almost all of that is the foreign keys' ON DELETE CASCADE. The exception is
 * groups the person owns: cascading those would delete a class's group out
 * from under thirty other people because one of them left. Instead ownership
 * passes to whoever has been a member longest, and only a group with nobody
 * else in it is deleted.
 */
export async function deleteUser(sql: Sql, id: string): Promise<boolean> {
  return sql.transaction(async (tx) => {
    const owned = await tx.query<{ id: string }>(
      `SELECT id FROM groups WHERE owner_id = $1 FOR UPDATE`,
      [id],
    );

    for (const group of owned) {
      const successor = await queryOne<{ user_id: string }>(
        tx,
        `SELECT user_id FROM group_members
          WHERE group_id = $1 AND user_id <> $2
          ORDER BY joined_at, user_id
          LIMIT 1`,
        [group.id, id],
      );

      if (successor) {
        await tx.query(`UPDATE groups SET owner_id = $2 WHERE id = $1`, [
          group.id,
          successor.user_id,
        ]);
        await tx.query(
          `UPDATE group_members SET role = 'owner' WHERE group_id = $1 AND user_id = $2`,
          [group.id, successor.user_id],
        );
      } else {
        await tx.query(`DELETE FROM groups WHERE id = $1`, [group.id]);
      }
    }

    const deleted = await tx.query<{ id: string }>(
      `DELETE FROM users WHERE id = $1 RETURNING id`,
      [id],
    );
    return deleted.length > 0;
  });
}
