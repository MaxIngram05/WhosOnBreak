/**
 * The friend graph.
 *
 * Friendship is symmetric, so it is stored once per pair with the two ids in
 * sorted order. Every read therefore has to look in both columns, which is a
 * little more SQL in exchange for making "A is B's friend but B is not A's"
 * unrepresentable rather than merely discouraged.
 */

import type { Friend, FriendshipStatus } from "@whosonbreak/contracts";
import type { Sql } from "../db/sql.ts";
import { PG_ERROR, isPgError, queryOne } from "../db/sql.ts";
import { badRequest, conflict, notFound } from "../http/errors.ts";
import { toPublicUser, type PublicUserRow } from "./users.ts";

/** The pair in the order the table's CHECK constraint requires. */
function canonical(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export interface FriendshipRow {
  id: string;
  user_a: string;
  user_b: string;
  status: FriendshipStatus;
  requested_by: string;
  created_at: Date | string;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function findFriendship(
  sql: Sql,
  a: string,
  b: string,
): Promise<FriendshipRow | undefined> {
  const [userA, userB] = canonical(a, b);
  return queryOne<FriendshipRow>(
    sql,
    `SELECT id, user_a, user_b, status, requested_by, created_at
       FROM friendships WHERE user_a = $1 AND user_b = $2`,
    [userA, userB],
  );
}

/**
 * Sends a request, or accepts one.
 *
 * The second case is the one worth noticing: if the other person has already
 * requested you, "request" means "accept". Without that, two people who both
 * tap Add at the same time end up in a state where each is waiting for the
 * other.
 */
export async function requestFriendship(
  sql: Sql,
  fromUserId: string,
  toUserId: string,
): Promise<FriendshipRow> {
  if (fromUserId === toUserId) {
    throw badRequest("You are already on your own schedule");
  }

  return sql.transaction(async (tx) => {
    const existing = await findFriendship(tx, fromUserId, toUserId);

    if (existing) {
      if (existing.status === "blocked") {
        // Reported as "not found" on purpose: confirming a block tells the
        // blocked person they were blocked.
        throw notFound("No such user");
      }
      if (existing.status === "accepted") {
        throw conflict("You are already friends");
      }
      if (existing.requested_by === fromUserId) {
        throw conflict("You have already asked");
      }
      // They asked first, so this request is really an acceptance.
      return acceptFriendship(tx, existing.id, fromUserId);
    }

    const [userA, userB] = canonical(fromUserId, toUserId);
    try {
      const inserted = await queryOne<FriendshipRow>(
        tx,
        `INSERT INTO friendships (user_a, user_b, status, requested_by)
         VALUES ($1, $2, 'pending', $3)
         RETURNING id, user_a, user_b, status, requested_by, created_at`,
        [userA, userB, fromUserId],
      );
      if (!inserted) throw new Error("Friendship insert returned nothing");
      return inserted;
    } catch (error) {
      // Both people tapped Add in the same instant and the other one won.
      if (isPgError(error, PG_ERROR.uniqueViolation)) {
        const raced = await findFriendship(tx, fromUserId, toUserId);
        if (raced) return raced;
      }
      if (isPgError(error, PG_ERROR.foreignKeyViolation)) {
        throw notFound("No such user");
      }
      throw error;
    }
  });
}

/**
 * Accepts a pending request. `accepterId` must be the person who did *not*
 * send it, otherwise anyone could accept their own request.
 */
export async function acceptFriendship(
  sql: Sql,
  friendshipId: string,
  accepterId: string,
): Promise<FriendshipRow> {
  const updated = await queryOne<FriendshipRow>(
    sql,
    `UPDATE friendships
        SET status = 'accepted', updated_at = now()
      WHERE id = $1
        AND status = 'pending'
        AND requested_by <> $2
        AND $2 IN (user_a, user_b)
      RETURNING id, user_a, user_b, status, requested_by, created_at`,
    [friendshipId, accepterId],
  );
  if (!updated) throw notFound("No pending request to accept");
  return updated;
}

export async function removeFriendship(
  sql: Sql,
  userId: string,
  otherUserId: string,
): Promise<void> {
  const [userA, userB] = canonical(userId, otherUserId);
  // A block is not this user's to lift by "unfriending": deleting that row
  // would let the blocked person send a fresh request.
  const deleted = await sql.query<{ id: string }>(
    `DELETE FROM friendships
      WHERE user_a = $1 AND user_b = $2 AND status <> 'blocked'
      RETURNING id`,
    [userA, userB],
  );
  if (deleted.length === 0) throw notFound("You are not friends");
}

interface FriendListRow extends PublicUserRow {
  friendship_id: string;
  status: FriendshipStatus;
  requested_by: string;
  since: Date | string;
}

/**
 * Everyone connected to this user, pending included, with the other side of
 * each pair resolved regardless of which column they sit in.
 */
const FRIEND_LIST_SELECT = `
  SELECT f.id AS friendship_id, u.id, u.display_name, u.avatar_url,
         f.status, f.requested_by, f.created_at AS since
    FROM friendships f
    JOIN users u
      ON u.id = CASE WHEN f.user_a = $1 THEN f.user_b ELSE f.user_a END`;

function toFriend(row: FriendListRow): Friend {
  return {
    id: row.friendship_id,
    user: toPublicUser(row),
    status: row.status,
    requestedBy: row.requested_by,
    since: iso(row.since),
  };
}

/** One friendship as `viewerId` sees it, for answering the request that changed it. */
export async function getFriendView(
  sql: Sql,
  viewerId: string,
  friendshipId: string,
): Promise<Friend> {
  const row = await queryOne<FriendListRow>(
    sql,
    `${FRIEND_LIST_SELECT}
      WHERE f.id = $2 AND $1 IN (f.user_a, f.user_b) AND f.status <> 'blocked'`,
    [viewerId, friendshipId],
  );
  if (!row) throw notFound("No such friendship");
  return toFriend(row);
}

export async function listFriends(sql: Sql, userId: string): Promise<Friend[]> {
  const rows = await sql.query<FriendListRow>(
    `${FRIEND_LIST_SELECT}
      WHERE $1 IN (f.user_a, f.user_b)
        AND f.status <> 'blocked'
      ORDER BY f.status, u.display_name`,
    [userId],
  );

  return rows.map(toFriend);
}

/**
 * Narrows a list of ids to the ones this user may compare against.
 *
 * Used to police ad-hoc comparison: the endpoint takes ids from the client, so
 * without this anyone could ask about anyone. Returning the permitted subset
 * rather than throwing lets the caller report who was dropped.
 */
export async function filterToAcceptedFriends(
  sql: Sql,
  userId: string,
  candidateIds: readonly string[],
): Promise<Set<string>> {
  if (candidateIds.length === 0) return new Set();

  const rows = await sql.query<{ friend_id: string }>(
    `SELECT CASE WHEN f.user_a = $1 THEN f.user_b ELSE f.user_a END AS friend_id
       FROM friendships f
      WHERE $1 IN (f.user_a, f.user_b)
        AND f.status = 'accepted'
        AND CASE WHEN f.user_a = $1 THEN f.user_b ELSE f.user_a END = ANY($2::uuid[])`,
    [userId, candidateIds],
  );

  return new Set(rows.map((row) => row.friend_id));
}

// ---------------------------------------------------------------------------
// Blocking
//
// A block is the same row as a friendship, with status 'blocked' and
// requested_by naming the blocker. Reusing the row means a pair can never be
// both friends and blocked, and the unique index that stops duplicate
// requests also stops a blocked person from sending a fresh one.
// ---------------------------------------------------------------------------

/** Whether either person has blocked the other. */
export async function isBlockedBetween(sql: Sql, a: string, b: string): Promise<boolean> {
  const row = await findFriendship(sql, a, b);
  return row?.status === "blocked";
}

/**
 * Blocks someone: ends any friendship or pending request, withdraws group
 * invites between the two, and stops further requests either way.
 *
 * If they had already blocked you, their block stands -- overwriting it would
 * hand them the power to lift it by unblocking.
 */
export async function blockUser(sql: Sql, blockerId: string, targetId: string): Promise<void> {
  if (blockerId === targetId) throw badRequest("You cannot block yourself");

  const [userA, userB] = canonical(blockerId, targetId);
  await sql.transaction(async (tx) => {
    try {
      await tx.query(
        `INSERT INTO friendships (user_a, user_b, status, requested_by)
         VALUES ($1, $2, 'blocked', $3)
         ON CONFLICT (user_a, user_b) DO UPDATE
           SET status = 'blocked', requested_by = $3, updated_at = now()
           WHERE friendships.status <> 'blocked'`,
        [userA, userB, blockerId],
      );
    } catch (error) {
      if (isPgError(error, PG_ERROR.foreignKeyViolation)) throw notFound("No such user");
      throw error;
    }

    await tx.query(
      `DELETE FROM group_invites
        WHERE (inviter_id = $1 AND invitee_id = $2) OR (inviter_id = $2 AND invitee_id = $1)`,
      [blockerId, targetId],
    );
  });
}

/** Lifts a block. Only the person who placed it can. */
export async function unblockUser(sql: Sql, blockerId: string, targetId: string): Promise<void> {
  const [userA, userB] = canonical(blockerId, targetId);
  const deleted = await sql.query<{ id: string }>(
    `DELETE FROM friendships
      WHERE user_a = $1 AND user_b = $2 AND status = 'blocked' AND requested_by = $3
      RETURNING id`,
    [userA, userB, blockerId],
  );
  if (deleted.length === 0) throw notFound("You have not blocked them");
}

/** The people this user has blocked -- never the people who blocked them. */
export async function listBlocked(sql: Sql, userId: string): Promise<PublicUserRow[]> {
  return sql.query<PublicUserRow>(
    `SELECT u.id, u.display_name, u.avatar_url
       FROM friendships f
       JOIN users u
         ON u.id = CASE WHEN f.user_a = $1 THEN f.user_b ELSE f.user_a END
      WHERE $1 IN (f.user_a, f.user_b)
        AND f.status = 'blocked'
        AND f.requested_by = $1
      ORDER BY u.display_name`,
    [userId],
  );
}
