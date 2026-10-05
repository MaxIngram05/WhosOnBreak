/**
 * Groups, and the join codes that populate them.
 *
 * A group is what makes the app useful on the first day: one person makes
 * "10B Maths", reads six characters out, and thirty people are comparable
 * without thirty friend requests. The code is the whole onboarding story, which
 * is why it is short, unambiguous when spoken, and rotatable when it inevitably
 * ends up written on a whiteboard.
 */

import {
  JOIN_CODE_ALPHABET,
  JOIN_CODE_LENGTH,
  type Group,
  type GroupDetail,
  type GroupMember,
  type GroupRole,
} from "@whosonbreak/contracts";
import type { Sql } from "../db/sql.ts";
import { PG_ERROR, isPgError, queryOne } from "../db/sql.ts";
import { conflict, forbidden, notFound } from "../http/errors.ts";
import { randomCode } from "../auth/tokens.ts";
import { toPublicUser, type PublicUserRow } from "./users.ts";

export interface GroupRow {
  id: string;
  name: string;
  owner_id: string;
  join_code: string;
  created_at: Date | string;
}

export interface GroupWithMembership extends GroupRow {
  role: GroupRole;
  member_count: number;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

const GROUP_COLUMNS = `id, name, owner_id, join_code, created_at`;

/**
 * Creates a group with its owner already in it.
 *
 * The retry loop is for join code collisions. With 31^6 codes a clash is
 * vanishingly rare, but "vanishingly rare" is not "impossible", and the
 * alternative to retrying is a user seeing a 500 for something we can simply
 * do again.
 */
export async function createGroup(
  sql: Sql,
  ownerId: string,
  name: string,
): Promise<GroupWithMembership> {
  const maxAttempts = 5;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const code = randomCode(JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH);

    try {
      return await sql.transaction(async (tx) => {
        const group = await queryOne<GroupRow>(
          tx,
          `INSERT INTO groups (name, owner_id, join_code)
           VALUES ($1, $2, $3)
           RETURNING ${GROUP_COLUMNS}`,
          [name, ownerId, code],
        );
        if (!group) throw new Error("Group insert returned nothing");

        await tx.query(
          `INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'owner')`,
          [group.id, ownerId],
        );

        return { ...group, role: "owner" as GroupRole, member_count: 1 };
      });
    } catch (error) {
      if (isPgError(error, PG_ERROR.uniqueViolation) && attempt < maxAttempts - 1) {
        continue;
      }
      throw error;
    }
  }

  throw new Error("Could not allocate a unique join code");
}

export function listGroupsForUser(
  sql: Sql,
  userId: string,
): Promise<GroupWithMembership[]> {
  return sql.query<GroupWithMembership>(
    `SELECT g.id, g.name, g.owner_id, g.join_code, g.created_at,
            gm.role,
            (SELECT count(*)::int FROM group_members m WHERE m.group_id = g.id)
              AS member_count
       FROM group_members gm
       JOIN groups g ON g.id = gm.group_id
      WHERE gm.user_id = $1 AND g.archived_at IS NULL
      ORDER BY g.created_at DESC`,
    [userId],
  );
}

/**
 * Fetches a group only if this user belongs to it.
 *
 * Membership is in the WHERE clause, so a non-member gets the same answer as
 * for a group that does not exist. Every group route goes through this, which
 * is the one place to look to confirm nothing is readable by id alone.
 */
export async function requireMembership(
  sql: Sql,
  groupId: string,
  userId: string,
): Promise<GroupWithMembership> {
  const group = await queryOne<GroupWithMembership>(
    sql,
    `SELECT g.id, g.name, g.owner_id, g.join_code, g.created_at,
            gm.role,
            (SELECT count(*)::int FROM group_members m WHERE m.group_id = g.id)
              AS member_count
       FROM group_members gm
       JOIN groups g ON g.id = gm.group_id
      WHERE gm.group_id = $1 AND gm.user_id = $2 AND g.archived_at IS NULL`,
    [groupId, userId],
  );
  if (!group) throw notFound("No such group");
  return group;
}

export async function joinGroupByCode(
  sql: Sql,
  userId: string,
  code: string,
): Promise<GroupWithMembership> {
  return sql.transaction(async (tx) => {
    const group = await queryOne<GroupRow>(
      tx,
      `SELECT ${GROUP_COLUMNS} FROM groups
        WHERE join_code = $1 AND archived_at IS NULL`,
      [code],
    );
    if (!group) throw notFound("That code does not match a group");

    // Idempotent: someone tapping a shared link twice should land in the group,
    // not see an error.
    await tx.query(
      `INSERT INTO group_members (group_id, user_id, role)
       VALUES ($1, $2, 'member')
       ON CONFLICT (group_id, user_id) DO NOTHING`,
      [group.id, userId],
    );

    return requireMembership(tx, group.id, userId);
  });
}

interface MemberRow extends PublicUserRow {
  role: GroupRole;
  joined_at: Date | string;
  has_schedule: boolean;
}

export async function listGroupMembers(
  sql: Sql,
  groupId: string,
): Promise<GroupMember[]> {
  const rows = await sql.query<MemberRow>(
    `SELECT u.id, u.display_name, u.avatar_url, gm.role, gm.joined_at,
            EXISTS (
              SELECT 1 FROM schedules s WHERE s.user_id = u.id AND s.is_active
            ) AS has_schedule
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
      WHERE gm.group_id = $1
      ORDER BY gm.role, u.display_name`,
    [groupId],
  );

  return rows.map((row) => ({
    user: toPublicUser(row),
    role: row.role,
    joinedAt: iso(row.joined_at),
    hasSchedule: row.has_schedule,
  }));
}

export function toGroup(group: GroupWithMembership): Group {
  return {
    id: group.id,
    name: group.name,
    // Safe to include: every path that produces a GroupWithMembership has
    // already established that the caller is a member.
    joinCode: group.join_code,
    memberCount: group.member_count,
    role: group.role,
    createdAt: iso(group.created_at),
  };
}

export function toGroupDetail(
  group: GroupWithMembership,
  members: GroupMember[],
): GroupDetail {
  return { ...toGroup(group), members };
}

export function listMemberIds(sql: Sql, groupId: string): Promise<{ user_id: string }[]> {
  return sql.query<{ user_id: string }>(
    `SELECT user_id FROM group_members WHERE group_id = $1`,
    [groupId],
  );
}

/**
 * Removes a member. Anyone may remove themselves; only the owner may remove
 * somebody else; nobody may remove the owner, because a group with no owner has
 * no one who can rotate a leaked code.
 */
export async function removeGroupMember(
  sql: Sql,
  groupId: string,
  actorId: string,
  targetId: string,
): Promise<void> {
  const group = await requireMembership(sql, groupId, actorId);

  if (targetId !== actorId && group.role !== "owner") {
    throw forbidden("Only the group owner can remove other people");
  }
  if (targetId === group.owner_id) {
    throw conflict("The owner cannot leave their own group; close it instead");
  }

  const deleted = await sql.query<{ user_id: string }>(
    `DELETE FROM group_members WHERE group_id = $1 AND user_id = $2 RETURNING user_id`,
    [groupId, targetId],
  );
  if (deleted.length === 0) throw notFound("They are not in this group");
}

/** For when the old code has been shared further than intended. */
export async function rotateJoinCode(
  sql: Sql,
  groupId: string,
  actorId: string,
): Promise<GroupWithMembership> {
  const group = await requireMembership(sql, groupId, actorId);
  if (group.role !== "owner") {
    throw forbidden("Only the group owner can change the join code");
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode(JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH);
    try {
      await sql.query(`UPDATE groups SET join_code = $2 WHERE id = $1`, [groupId, code]);
      return { ...group, join_code: code };
    } catch (error) {
      if (!isPgError(error, PG_ERROR.uniqueViolation)) throw error;
    }
  }

  throw new Error("Could not allocate a unique join code");
}

/**
 * Closes a group. Owner only, and the way an owner leaves: the group stops
 * appearing for everyone and its code stops working, but the rows stay, so an
 * accidental archive is a support fix rather than a data loss.
 */
export async function archiveGroup(sql: Sql, groupId: string, actorId: string): Promise<void> {
  const group = await requireMembership(sql, groupId, actorId);
  if (group.role !== "owner") {
    throw forbidden("Only the group owner can close the group");
  }
  await sql.query(`UPDATE groups SET archived_at = now() WHERE id = $1`, [groupId]);
}

/**
 * Whether two people are in at least one open group together -- the condition
 * for sending someone a friend request by id rather than by their code.
 */
export async function shareAGroup(sql: Sql, a: string, b: string): Promise<boolean> {
  const row = await queryOne<{ shared: boolean }>(
    sql,
    `SELECT EXISTS (
       SELECT 1
         FROM group_members mine
         JOIN group_members theirs ON theirs.group_id = mine.group_id
         JOIN groups g ON g.id = mine.group_id
        WHERE mine.user_id = $1 AND theirs.user_id = $2 AND g.archived_at IS NULL
     ) AS shared`,
    [a, b],
  );
  return row?.shared ?? false;
}
