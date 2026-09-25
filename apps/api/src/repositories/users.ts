/**
 * Users and the external identities that map onto them.
 */

import type { PrivateUser, PublicUser, Visibility } from "@whosonbreak/contracts";
import type { Sql } from "../db/sql.ts";
import { queryOne } from "../db/sql.ts";
import type { GoogleIdentity } from "../auth/google.ts";

export interface UserRow {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  default_visibility: Visibility;
  created_at: Date | string;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function toPublicUser(row: UserRow): PublicUser {
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
    createdAt: toIsoString(row.created_at),
  };
}

const USER_COLUMNS = `id, email, display_name, avatar_url, default_visibility, created_at`;

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
  provider: "google",
  identity: GoogleIdentity,
): Promise<{ user: UserRow; created: boolean }> {
  return sql.transaction(async (tx) => {
    const existing = await queryOne<UserRow>(
      tx,
      `SELECT u.id, u.email, u.display_name, u.avatar_url, u.default_visibility, u.created_at
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

    const inserted = await queryOne<UserRow>(
      tx,
      `INSERT INTO users (email, display_name, avatar_url)
       VALUES ($1, $2, $3)
       RETURNING ${USER_COLUMNS}`,
      [
        identity.email,
        // Falling back to the local part beats showing a blank name; people
        // rename themselves later anyway.
        identity.name?.trim() || identity.email.split("@")[0] || "Someone",
        identity.pictureUrl,
      ],
    );
    if (!inserted) throw new Error("User insert returned nothing");

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
