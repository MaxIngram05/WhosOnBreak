/**
 * Schedules and blocks.
 *
 * The one query that matters for performance is `loadComparableSchedules`: it
 * fetches every member of a group and all of their blocks in a single round
 * trip. The obvious implementation -- loop over members, query each -- is what
 * makes a social feature slow, and on a serverless database it multiplies a
 * connection round trip by the size of the group.
 *
 * Label redaction also lives here rather than in a route, so a future endpoint
 * cannot leak a block's name by forgetting to ask.
 */

import { splitWeekWrap, type Interval } from "@whosonbreak/core";
import type {
  Block,
  BlockInput,
  BlockKind,
  Schedule,
  Visibility,
} from "@whosonbreak/contracts";
import type { Sql } from "../db/sql.ts";
import { placeholders, queryOne } from "../db/sql.ts";
import { conflict, notFound } from "../http/errors.ts";

export interface ScheduleRow {
  id: string;
  user_id: string;
  name: string;
  time_zone: string;
  is_active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface BlockRow {
  id: string;
  schedule_id: string;
  label: string | null;
  kind: BlockKind;
  start_minute: number;
  end_minute: number;
}

const SCHEDULE_COLUMNS = `id, user_id, name, time_zone, is_active, created_at, updated_at`;

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function toSchedule(row: ScheduleRow): Schedule {
  return {
    id: row.id,
    name: row.name,
    timeZone: row.time_zone,
    isActive: row.is_active,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export function toBlock(row: BlockRow): Block {
  return {
    id: row.id,
    label: row.label,
    kind: row.kind,
    start: row.start_minute,
    end: row.end_minute,
  };
}

export function listSchedulesForUser(sql: Sql, userId: string): Promise<ScheduleRow[]> {
  return sql.query<ScheduleRow>(
    `SELECT ${SCHEDULE_COLUMNS} FROM schedules
      WHERE user_id = $1
      ORDER BY is_active DESC, created_at DESC`,
    [userId],
  );
}

/**
 * Scoped by owner in the WHERE clause rather than fetched and then checked.
 * A missing row and somebody else's row come back identically, so probing ids
 * tells an attacker nothing.
 */
export function findOwnedSchedule(
  sql: Sql,
  scheduleId: string,
  userId: string,
): Promise<ScheduleRow | undefined> {
  return queryOne<ScheduleRow>(
    sql,
    `SELECT ${SCHEDULE_COLUMNS} FROM schedules WHERE id = $1 AND user_id = $2`,
    [scheduleId, userId],
  );
}

export function listBlocks(sql: Sql, scheduleId: string): Promise<BlockRow[]> {
  return sql.query<BlockRow>(
    `SELECT id, schedule_id, label, kind, start_minute, end_minute
       FROM blocks WHERE schedule_id = $1 ORDER BY start_minute`,
    [scheduleId],
  );
}

/**
 * Normalises submitted blocks into rows the table will accept.
 *
 * `splitWeekWrap` is the whole reason this is a function: a block running past
 * Sunday midnight becomes two rows, which keeps the CHECK constraint true and
 * means no reader downstream ever has to reason about wrap.
 */
function toBlockRows(scheduleId: string, blocks: readonly BlockInput[]): unknown[][] {
  const rows: unknown[][] = [];

  for (const block of blocks) {
    const pieces: Interval[] = splitWeekWrap({ start: block.start, end: block.end });
    for (const piece of pieces) {
      rows.push([
        scheduleId,
        block.label?.trim() ? block.label.trim() : null,
        block.kind,
        piece.start,
        piece.end,
      ]);
    }
  }
  return rows;
}

async function insertBlocks(
  sql: Sql,
  scheduleId: string,
  blocks: readonly BlockInput[],
): Promise<void> {
  const rows = toBlockRows(scheduleId, blocks);
  if (rows.length === 0) return;

  // One statement for the whole week rather than one per block.
  await sql.query(
    `INSERT INTO blocks (schedule_id, label, kind, start_minute, end_minute)
     VALUES ${placeholders(rows.length, 5)}`,
    rows.flat(),
  );
}

/** Clearing the flag on every other schedule first keeps the partial unique
 * index satisfied at every point, not merely at the end of the transaction. */
async function deactivateOthers(
  sql: Sql,
  userId: string,
  keepScheduleId: string | null,
): Promise<void> {
  await sql.query(
    `UPDATE schedules SET is_active = false, updated_at = now()
      WHERE user_id = $1 AND is_active AND ($2::uuid IS NULL OR id <> $2::uuid)`,
    [userId, keepScheduleId],
  );
}

export async function createSchedule(
  sql: Sql,
  userId: string,
  input: { name: string; timeZone: string; isActive: boolean; blocks: BlockInput[] },
): Promise<{ schedule: ScheduleRow; blocks: BlockRow[] }> {
  return sql.transaction(async (tx) => {
    if (input.isActive) await deactivateOthers(tx, userId, null);

    const schedule = await queryOne<ScheduleRow>(
      tx,
      `INSERT INTO schedules (user_id, name, time_zone, is_active)
       VALUES ($1, $2, $3, $4)
       RETURNING ${SCHEDULE_COLUMNS}`,
      [userId, input.name, input.timeZone, input.isActive],
    );
    if (!schedule) throw new Error("Schedule insert returned nothing");

    await insertBlocks(tx, schedule.id, input.blocks);
    return { schedule, blocks: await listBlocks(tx, schedule.id) };
  });
}

export async function updateSchedule(
  sql: Sql,
  userId: string,
  scheduleId: string,
  changes: { name?: string; timeZone?: string; isActive?: true },
): Promise<ScheduleRow> {
  return sql.transaction(async (tx) => {
    const existing = await findOwnedSchedule(tx, scheduleId, userId);
    if (!existing) throw notFound("No such schedule");

    if (changes.isActive) await deactivateOthers(tx, userId, scheduleId);

    const assignments: string[] = [];
    const params: unknown[] = [];

    if (changes.name !== undefined) {
      params.push(changes.name);
      assignments.push(`name = $${params.length}`);
    }
    if (changes.timeZone !== undefined) {
      params.push(changes.timeZone);
      assignments.push(`time_zone = $${params.length}`);
    }
    if (changes.isActive) assignments.push(`is_active = true`);

    assignments.push(`updated_at = now()`);
    params.push(scheduleId);

    const updated = await queryOne<ScheduleRow>(
      tx,
      `UPDATE schedules SET ${assignments.join(", ")}
        WHERE id = $${params.length}
        RETURNING ${SCHEDULE_COLUMNS}`,
      params,
    );
    if (!updated) throw notFound("No such schedule");
    return updated;
  });
}

export async function deleteSchedule(
  sql: Sql,
  userId: string,
  scheduleId: string,
): Promise<void> {
  const deleted = await sql.query<{ id: string }>(
    `DELETE FROM schedules WHERE id = $1 AND user_id = $2 RETURNING id`,
    [scheduleId, userId],
  );
  if (deleted.length === 0) throw notFound("No such schedule");
}

/**
 * Replaces a schedule's blocks wholesale, in one transaction.
 *
 * `expectedUpdatedAt` is optional optimistic locking. Sent, it turns a
 * second device's stale save into a 409 the client can react to; omitted, the
 * last write wins. Made opt-in because the first client is one phone and being
 * asked to thread a version through every save would be friction for nothing.
 */
export async function replaceBlocks(
  sql: Sql,
  userId: string,
  scheduleId: string,
  blocks: readonly BlockInput[],
  expectedUpdatedAt?: string,
): Promise<{ schedule: ScheduleRow; blocks: BlockRow[] }> {
  return sql.transaction(async (tx) => {
    // Locks the row for the life of the transaction, so two concurrent saves
    // serialise instead of interleaving delete and insert.
    const existing = await queryOne<ScheduleRow>(
      tx,
      `SELECT ${SCHEDULE_COLUMNS} FROM schedules
        WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [scheduleId, userId],
    );
    if (!existing) throw notFound("No such schedule");

    if (expectedUpdatedAt !== undefined) {
      const current = new Date(iso(existing.updated_at)).getTime();
      if (current !== new Date(expectedUpdatedAt).getTime()) {
        throw conflict("This schedule changed somewhere else. Reload and try again.");
      }
    }

    await tx.query(`DELETE FROM blocks WHERE schedule_id = $1`, [scheduleId]);
    await insertBlocks(tx, scheduleId, blocks);

    const updated = await queryOne<ScheduleRow>(
      tx,
      `UPDATE schedules SET updated_at = now() WHERE id = $1 RETURNING ${SCHEDULE_COLUMNS}`,
      [scheduleId],
    );
    if (!updated) throw notFound("No such schedule");

    return { schedule: updated, blocks: await listBlocks(tx, scheduleId) };
  });
}

/** A person's active schedule plus their blocks, ready for comparison. */
export interface ComparableSchedule {
  userId: string;
  scheduleId: string;
  timeZone: string;
  blocks: Block[];
}

interface ComparableRow {
  user_id: string;
  schedule_id: string;
  time_zone: string;
  default_visibility: Visibility;
  block_id: string | null;
  label: string | null;
  kind: BlockKind | null;
  start_minute: number | null;
  end_minute: number | null;
}

/**
 * Every listed user's active schedule and blocks, in one query.
 *
 * A LEFT JOIN, not an inner one: somebody who joined a group and never entered
 * a schedule has to come back as present-with-nothing, so the caller can tell
 * the difference between "busy" and "has not set this up yet". Reporting those
 * two the same way is how an app ends up quietly lying about a friend.
 *
 * Labels are stripped here according to each owner's own visibility setting.
 * The viewer's own labels always survive.
 */
export async function loadComparableSchedules(
  sql: Sql,
  userIds: readonly string[],
  viewerId: string,
): Promise<ComparableSchedule[]> {
  if (userIds.length === 0) return [];

  const rows = await sql.query<ComparableRow>(
    `SELECT s.user_id,
            s.id                AS schedule_id,
            s.time_zone,
            u.default_visibility,
            b.id                AS block_id,
            b.label,
            b.kind,
            b.start_minute,
            b.end_minute
       FROM schedules s
       JOIN users u  ON u.id = s.user_id
       LEFT JOIN blocks b ON b.schedule_id = s.id
      WHERE s.user_id = ANY($1::uuid[]) AND s.is_active
      ORDER BY s.user_id, b.start_minute`,
    [userIds],
  );

  const byUser = new Map<string, ComparableSchedule>();

  for (const row of rows) {
    let entry = byUser.get(row.user_id);
    if (!entry) {
      entry = {
        userId: row.user_id,
        scheduleId: row.schedule_id,
        timeZone: row.time_zone,
        blocks: [],
      };
      byUser.set(row.user_id, entry);
    }

    if (row.block_id === null || row.start_minute === null || row.end_minute === null) {
      continue; // An active schedule with no blocks in it yet.
    }

    const maySeeLabel =
      row.user_id === viewerId ||
      row.default_visibility === "labels" ||
      row.default_visibility === "full";

    entry.blocks.push({
      id: row.block_id,
      label: maySeeLabel ? row.label : null,
      kind: row.kind ?? "other",
      start: row.start_minute,
      end: row.end_minute,
    });
  }

  return [...byUser.values()];
}
