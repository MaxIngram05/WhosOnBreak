/**
 * A person's copy of their own data.
 *
 * Kept apart from the per-entity repositories on purpose: this is the one
 * read in the service that must be exhaustive rather than minimal, and a new
 * table that holds personal data should prompt an edit here. If you are adding
 * one, this is your reminder.
 */

import type { AccountExport, FriendshipStatus, GroupRole } from "@whosonbreak/contracts";
import type { Sql } from "../db/sql.ts";
import { findUserById, toPrivateUser } from "./users.ts";
import { listBlocks, listSchedulesForUser, toBlock, toSchedule } from "./schedules.ts";

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isoOrNull(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

export async function exportAccount(
  sql: Sql,
  userId: string,
  now: Date,
): Promise<AccountExport | undefined> {
  const user = await findUserById(sql, userId);
  if (!user) return undefined;

  const identities = await sql.query<{
    provider: string;
    provider_subject: string;
    created_at: Date | string;
  }>(
    `SELECT provider, provider_subject, created_at
       FROM identities WHERE user_id = $1 ORDER BY created_at`,
    [userId],
  );

  const scheduleRows = await listSchedulesForUser(sql, userId);
  const schedules = await Promise.all(
    scheduleRows.map(async (row) => ({
      ...toSchedule(row, now),
      blocks: (await listBlocks(sql, row.id)).map(toBlock),
    })),
  );

  const friendships = await sql.query<{
    other_id: string;
    display_name: string;
    status: FriendshipStatus;
    requested_by: string;
    created_at: Date | string;
  }>(
    `SELECT u.id AS other_id, u.display_name, f.status, f.requested_by, f.created_at
       FROM friendships f
       JOIN users u
         ON u.id = CASE WHEN f.user_a = $1 THEN f.user_b ELSE f.user_a END
      WHERE $1 IN (f.user_a, f.user_b)
      ORDER BY f.created_at`,
    [userId],
  );

  const groups = await sql.query<{
    group_id: string;
    name: string;
    role: GroupRole;
    joined_at: Date | string;
  }>(
    `SELECT g.id AS group_id, g.name, gm.role, gm.joined_at
       FROM group_members gm
       JOIN groups g ON g.id = gm.group_id
      WHERE gm.user_id = $1
      ORDER BY gm.joined_at`,
    [userId],
  );

  const sessions = await sql.query<{
    created_at: Date | string;
    expires_at: Date | string;
    revoked_at: Date | string | null;
    user_agent: string | null;
  }>(
    `SELECT created_at, expires_at, revoked_at, user_agent
       FROM refresh_tokens WHERE user_id = $1 ORDER BY created_at`,
    [userId],
  );

  return {
    exportedAt: now.toISOString(),
    user: toPrivateUser(user),
    identities: identities.map((row) => ({
      provider: row.provider,
      providerSubject: row.provider_subject,
      createdAt: iso(row.created_at),
    })),
    schedules,
    friendships: friendships.map((row) => ({
      userId: row.other_id,
      displayName: row.display_name,
      status: row.status,
      requestedByMe: row.requested_by === userId,
      createdAt: iso(row.created_at),
    })),
    groups: groups.map((row) => ({
      groupId: row.group_id,
      name: row.name,
      role: row.role,
      joinedAt: iso(row.joined_at),
    })),
    sessions: sessions.map((row) => ({
      createdAt: iso(row.created_at),
      expiresAt: iso(row.expires_at),
      revokedAt: isoOrNull(row.revoked_at),
      userAgent: row.user_agent,
    })),
  };
}
