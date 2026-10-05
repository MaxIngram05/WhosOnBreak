/**
 * Groups, the join codes that populate them, and direct invites.
 *
 * A group is what makes the app useful on the first day: one person makes
 * "10B Maths", reads six characters out, and the class is comparable without
 * thirty friend requests. The code is the whole onboarding story, which is
 * why it is short, unambiguous when spoken, and rotatable when it inevitably
 * ends up written on a whiteboard.
 *
 * Who may bring people in is a per-member permission. The owner always may;
 * other members may when the owner has said so. "Bring people in" means two
 * things: seeing the join code to share it, and inviting a friend directly.
 */

import {
  JOIN_CODE_ALPHABET,
  JOIN_CODE_LENGTH,
  MAX_GROUP_MEMBERS,
  type Group,
  type GroupDetail,
  type GroupInvite,
  type GroupMember,
  type GroupRole,
} from "@whosonbreak/contracts";
import type { Sql } from "../db/sql.ts";
import { PG_ERROR, isPgError, queryOne } from "../db/sql.ts";
import { conflict, forbidden, groupFull, notFound } from "../http/errors.ts";
import { randomCode } from "../auth/tokens.ts";
import { toPublicUser, type PublicUserRow } from "./users.ts";
import { filterToAcceptedFriends, isBlockedBetween } from "./friends.ts";

export interface GroupRow {
  id: string;
  name: string;
  subtitle: string | null;
  owner_id: string;
  join_code: string;
  created_at: Date | string;
}

export interface GroupWithMembership extends GroupRow {
  role: GroupRole;
  can_invite: boolean;
  member_count: number;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

const GROUP_COLUMNS = `id, name, subtitle, owner_id, join_code, created_at`;

const MEMBERSHIP_SELECT = `
  SELECT g.id, g.name, g.subtitle, g.owner_id, g.join_code, g.created_at,
         gm.role, gm.can_invite,
         (SELECT count(*)::int FROM group_members m WHERE m.group_id = g.id)
           AS member_count
    FROM group_members gm
    JOIN groups g ON g.id = gm.group_id`;

/** The owner may always invite, whatever the flag says. */
function mayInvite(group: { role: GroupRole; can_invite: boolean }): boolean {
  return group.role === "owner" || group.can_invite;
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

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
  input: { name: string; subtitle?: string },
): Promise<GroupWithMembership> {
  const maxAttempts = 5;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const code = randomCode(JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH);

    try {
      return await sql.transaction(async (tx) => {
        const group = await queryOne<GroupRow>(
          tx,
          `INSERT INTO groups (name, subtitle, owner_id, join_code)
           VALUES ($1, $2, $3, $4)
           RETURNING ${GROUP_COLUMNS}`,
          [input.name, emptyToNull(input.subtitle), ownerId, code],
        );
        if (!group) throw new Error("Group insert returned nothing");

        await tx.query(
          `INSERT INTO group_members (group_id, user_id, role, can_invite)
           VALUES ($1, $2, 'owner', true)`,
          [group.id, ownerId],
        );

        return { ...group, role: "owner" as GroupRole, can_invite: true, member_count: 1 };
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
    `${MEMBERSHIP_SELECT}
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
    `${MEMBERSHIP_SELECT}
      WHERE gm.group_id = $1 AND gm.user_id = $2 AND g.archived_at IS NULL`,
    [groupId, userId],
  );
  if (!group) throw notFound("No such group");
  return group;
}

async function requireOwner(
  sql: Sql,
  groupId: string,
  actorId: string,
  action: string,
): Promise<GroupWithMembership> {
  const group = await requireMembership(sql, groupId, actorId);
  if (group.role !== "owner") throw forbidden(`Only the group owner can ${action}`);
  return group;
}

/**
 * Adds someone, inside a transaction that holds the group row locked, so two
 * people joining at once cannot both take the thirtieth place.
 *
 * Idempotent: someone already in the group stays in it and nothing is
 * counted twice.
 */
async function addMember(tx: Sql, groupId: string, userId: string): Promise<void> {
  const locked = await queryOne<{ id: string }>(
    tx,
    `SELECT id FROM groups WHERE id = $1 AND archived_at IS NULL FOR UPDATE`,
    [groupId],
  );
  if (!locked) throw notFound("No such group");

  const already = await queryOne<{ one: number }>(
    tx,
    `SELECT 1 AS one FROM group_members WHERE group_id = $1 AND user_id = $2`,
    [groupId, userId],
  );
  if (already) return;

  const size = await queryOne<{ count: number }>(
    tx,
    `SELECT count(*)::int AS count FROM group_members WHERE group_id = $1`,
    [groupId],
  );
  if ((size?.count ?? 0) >= MAX_GROUP_MEMBERS) throw groupFull();

  await tx.query(
    `INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'member')`,
    [groupId, userId],
  );
  // Joining by any route settles any invite that was waiting.
  await tx.query(`DELETE FROM group_invites WHERE group_id = $1 AND invitee_id = $2`, [
    groupId,
    userId,
  ]);
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

    await addMember(tx, group.id, userId);
    return requireMembership(tx, group.id, userId);
  });
}

interface MemberRow extends PublicUserRow {
  role: GroupRole;
  can_invite: boolean;
  joined_at: Date | string;
  has_schedule: boolean;
}

export async function listGroupMembers(
  sql: Sql,
  groupId: string,
): Promise<GroupMember[]> {
  const rows = await sql.query<MemberRow>(
    `SELECT u.id, u.display_name, u.avatar_url, gm.role, gm.can_invite, gm.joined_at,
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
    canInvite: row.role === "owner" || row.can_invite,
    joinedAt: iso(row.joined_at),
    hasSchedule: row.has_schedule,
  }));
}

export function toGroup(group: GroupWithMembership): Group {
  const canInvite = mayInvite(group);
  return {
    id: group.id,
    name: group.name,
    subtitle: group.subtitle,
    // Only for people who may bring others in. Every path that produces a
    // GroupWithMembership has already established that the caller is a
    // member; this decides whether they are a member who can share it.
    ...(canInvite ? { joinCode: group.join_code } : {}),
    memberCount: group.member_count,
    role: group.role,
    canInvite,
    createdAt: iso(group.created_at),
  };
}

export function toGroupDetail(
  group: GroupWithMembership,
  members: GroupMember[],
): GroupDetail {
  return { ...toGroup(group), members };
}

/** Owner only. Renames, and sets or clears the subtitle. */
export async function updateGroup(
  sql: Sql,
  groupId: string,
  actorId: string,
  changes: { name?: string; subtitle?: string | null },
): Promise<GroupWithMembership> {
  const group = await requireOwner(sql, groupId, actorId, "rename the group");

  const name = changes.name ?? group.name;
  const subtitle = changes.subtitle === undefined ? group.subtitle : emptyToNull(changes.subtitle);

  await sql.query(`UPDATE groups SET name = $2, subtitle = $3 WHERE id = $1`, [
    groupId,
    name,
    subtitle,
  ]);
  return { ...group, name, subtitle };
}

/**
 * Owner only: grants or withdraws a member's permission to bring people in.
 * The owner's own permission is not a flag and cannot be withdrawn.
 */
export async function setMemberCanInvite(
  sql: Sql,
  groupId: string,
  actorId: string,
  targetId: string,
  canInvite: boolean,
): Promise<void> {
  const group = await requireOwner(sql, groupId, actorId, "change permissions");
  if (targetId === group.owner_id) {
    throw conflict("The owner can always invite");
  }

  const updated = await sql.query<{ user_id: string }>(
    `UPDATE group_members SET can_invite = $3
      WHERE group_id = $1 AND user_id = $2
      RETURNING user_id`,
    [groupId, targetId, canInvite],
  );
  if (updated.length === 0) throw notFound("They are not in this group");
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
  const group = await requireOwner(sql, groupId, actorId, "change the join code");

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
  await requireOwner(sql, groupId, actorId, "close the group");
  await sql.query(`UPDATE groups SET archived_at = now() WHERE id = $1`, [groupId]);
}

/**
 * Whether two people are in at least one open group together -- the condition
 * for sending someone a friend request by id rather than by their code, and
 * for browsing their week.
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

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

interface InviteRow {
  id: string;
  group_id: string;
  group_name: string;
  group_subtitle: string | null;
  member_count: number;
  inviter_id: string;
  inviter_name: string;
  inviter_avatar: string | null;
  invitee_id: string;
  invitee_name: string;
  invitee_avatar: string | null;
  created_at: Date | string;
}

const INVITE_SELECT = `
  SELECT i.id, i.group_id, g.name AS group_name, g.subtitle AS group_subtitle,
         (SELECT count(*)::int FROM group_members m WHERE m.group_id = g.id) AS member_count,
         i.inviter_id, inviter.display_name AS inviter_name, inviter.avatar_url AS inviter_avatar,
         i.invitee_id, invitee.display_name AS invitee_name, invitee.avatar_url AS invitee_avatar,
         i.created_at
    FROM group_invites i
    JOIN groups g       ON g.id = i.group_id
    JOIN users inviter  ON inviter.id = i.inviter_id
    JOIN users invitee  ON invitee.id = i.invitee_id`;

function toInvite(row: InviteRow): GroupInvite {
  return {
    id: row.id,
    group: {
      id: row.group_id,
      name: row.group_name,
      subtitle: row.group_subtitle,
      memberCount: row.member_count,
    },
    inviter: toPublicUser({
      id: row.inviter_id,
      display_name: row.inviter_name,
      avatar_url: row.inviter_avatar,
    }),
    invitee: toPublicUser({
      id: row.invitee_id,
      display_name: row.invitee_name,
      avatar_url: row.invitee_avatar,
    }),
    createdAt: iso(row.created_at),
  };
}

/**
 * Invites one of the inviter's friends.
 *
 * Restricted to accepted friends because an invite reveals that the group
 * exists and who is in it. A friend has already agreed to be reachable by
 * you; a stranger has not.
 */
export async function createInvite(
  sql: Sql,
  groupId: string,
  inviterId: string,
  inviteeId: string,
): Promise<GroupInvite> {
  const group = await requireMembership(sql, groupId, inviterId);
  if (!mayInvite(group)) throw forbidden("You cannot invite people to this group");

  const friends = await filterToAcceptedFriends(sql, inviterId, [inviteeId]);
  if (!friends.has(inviteeId) || (await isBlockedBetween(sql, inviterId, inviteeId))) {
    throw notFound("You can only invite your friends");
  }

  const member = await queryOne<{ one: number }>(
    sql,
    `SELECT 1 AS one FROM group_members WHERE group_id = $1 AND user_id = $2`,
    [groupId, inviteeId],
  );
  if (member) throw conflict("They are already in this group");
  if (group.member_count >= MAX_GROUP_MEMBERS) throw groupFull();

  // A second invite to the same person is not an error -- two members both
  // thought of them -- and keeps the first.
  await sql.query(
    `INSERT INTO group_invites (group_id, inviter_id, invitee_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (group_id, invitee_id) DO NOTHING`,
    [groupId, inviterId, inviteeId],
  );

  const row = await queryOne<InviteRow>(
    sql,
    `${INVITE_SELECT} WHERE i.group_id = $1 AND i.invitee_id = $2`,
    [groupId, inviteeId],
  );
  if (!row) throw new Error("Invite insert returned nothing");
  return toInvite(row);
}

/** Invites waiting for this user to answer, in open groups only. */
export async function listInvitesForUser(sql: Sql, userId: string): Promise<GroupInvite[]> {
  const rows = await sql.query<InviteRow>(
    `${INVITE_SELECT}
      WHERE i.invitee_id = $1 AND g.archived_at IS NULL
      ORDER BY i.created_at DESC`,
    [userId],
  );
  return rows.map(toInvite);
}

export async function acceptInvite(
  sql: Sql,
  inviteId: string,
  userId: string,
): Promise<GroupWithMembership> {
  return sql.transaction(async (tx) => {
    const invite = await queryOne<{ group_id: string }>(
      tx,
      `SELECT group_id FROM group_invites WHERE id = $1 AND invitee_id = $2`,
      [inviteId, userId],
    );
    if (!invite) throw notFound("No such invite");

    await addMember(tx, invite.group_id, userId);
    return requireMembership(tx, invite.group_id, userId);
  });
}

/** Declined by the invitee, or withdrawn by whoever sent it. */
export async function deleteInvite(sql: Sql, inviteId: string, userId: string): Promise<void> {
  const deleted = await sql.query<{ id: string }>(
    `DELETE FROM group_invites
      WHERE id = $1 AND (invitee_id = $2 OR inviter_id = $2)
      RETURNING id`,
    [inviteId, userId],
  );
  if (deleted.length === 0) throw notFound("No such invite");
}
