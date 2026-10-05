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

import {
  anchorForCurrentWeek,
  cycleWeekIndex,
  formatCalendarDate,
  mondayOf,
  parseCalendarDate,
  splitWeekWrap,
  startOfWeekIn,
  type Interval,
} from "@whosonbreak/core";
import type {
  Block,
  BlockInput,
  BlockKind,
  Schedule,
  Visibility,
} from "@whosonbreak/contracts";
import type { Sql } from "../db/sql.ts";
import { placeholders, queryOne } from "../db/sql.ts";
import { badRequest, conflict, notFound } from "../http/errors.ts";

export interface ScheduleRow {
  id: string;
  user_id: string;
  name: string;
  time_zone: string;
  is_active: boolean;
  cycle_weeks: number;
  /** YYYY-MM-DD; selected as text so no driver turns it into a local-midnight Date. */
  cycle_anchor: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface BlockRow {
  id: string;
  schedule_id: string;
  label: string | null;
  kind: BlockKind;
  week_index: number;
  start_minute: number;
  end_minute: number;
}

const SCHEDULE_COLUMNS = `id, user_id, name, time_zone, is_active, cycle_weeks,
  cycle_anchor::text AS cycle_anchor, created_at, updated_at`;

const BLOCK_COLUMNS = `id, schedule_id, label, kind, week_index, start_minute, end_minute`;

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** Which week of its cycle a schedule is in at `instant`, by its own clock. */
export function weekIndexAt(
  schedule: { timeZone: string; cycleWeeks: number; cycleAnchor: string | null },
  instant: Date,
): number {
  if (schedule.cycleWeeks === 1 || schedule.cycleAnchor === null) return 0;
  return cycleWeekIndex(
    parseCalendarDate(schedule.cycleAnchor),
    startOfWeekIn(schedule.timeZone, instant),
    schedule.cycleWeeks,
  );
}

export function toSchedule(row: ScheduleRow, now: Date): Schedule {
  return {
    id: row.id,
    name: row.name,
    timeZone: row.time_zone,
    isActive: row.is_active,
    cycleWeeks: row.cycle_weeks,
    cycleAnchor: row.cycle_anchor,
    currentWeekIndex: weekIndexAt(
      { timeZone: row.time_zone, cycleWeeks: row.cycle_weeks, cycleAnchor: row.cycle_anchor },
      now,
    ),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export function toBlock(row: BlockRow): Block {
  return {
    id: row.id,
    label: row.label,
    kind: row.kind,
    weekIndex: row.week_index,
    start: row.start_minute,
    end: row.end_minute,
  };
}

/** Where the rotation stands, in whichever of the two forms the client used. */
export interface CyclePosition {
  currentWeekIndex?: number;
  cycleAnchor?: string;
}

/**
 * The anchor to store for a schedule, given what the client said.
 *
 * "This week is Week B" is resolved against this week *in the schedule's own
 * zone*, so a Sunday-night edit in London is not read as Monday in Tokyo.
 * With nothing said, an existing anchor is kept and a new rotation starts with
 * this week as Week A -- the most likely truth, and fixable in one tap.
 */
function resolveAnchor(
  cycleWeeks: number,
  timeZone: string,
  now: Date,
  position: CyclePosition,
  existing: string | null,
): string | null {
  if (cycleWeeks === 1) return null;

  if (position.currentWeekIndex !== undefined) {
    if (position.currentWeekIndex >= cycleWeeks) {
      throw badRequest("That week is not part of this schedule's cycle", {
        currentWeekIndex: [`Must be below ${cycleWeeks}`],
      });
    }
    return formatCalendarDate(
      anchorForCurrentWeek(startOfWeekIn(timeZone, now), position.currentWeekIndex),
    );
  }

  if (position.cycleAnchor !== undefined) {
    return formatCalendarDate(mondayOf(parseCalendarDate(position.cycleAnchor)));
  }

  return existing ?? formatCalendarDate(startOfWeekIn(timeZone, now));
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
    `SELECT ${BLOCK_COLUMNS}
       FROM blocks WHERE schedule_id = $1 ORDER BY week_index, start_minute`,
    [scheduleId],
  );
}

/**
 * Normalises submitted blocks into rows the table will accept.
 *
 * `splitWeekWrap` is the whole reason this is a function: a block running past
 * Sunday midnight becomes two rows, which keeps the CHECK constraint true and
 * means no reader downstream ever has to reason about wrap.
 *
 * In a multi-week cycle the part after midnight belongs to the *next* week of
 * the cycle -- a Week A night shift ends on a Week B Monday -- so the wrapped
 * piece moves on one week rather than back to the start of its own.
 */
function toBlockRows(
  scheduleId: string,
  cycleWeeks: number,
  blocks: readonly BlockInput[],
): unknown[][] {
  const rows: unknown[][] = [];

  blocks.forEach((block, position) => {
    if (block.weekIndex >= cycleWeeks) {
      throw badRequest("A block is in a week this schedule does not have", {
        [`blocks.${position}.weekIndex`]: [`Must be below ${cycleWeeks}`],
      });
    }

    const pieces: Interval[] = splitWeekWrap({ start: block.start, end: block.end });
    for (const piece of pieces) {
      const wrapped = piece.start < block.start;
      rows.push([
        scheduleId,
        block.label?.trim() ? block.label.trim() : null,
        block.kind,
        wrapped ? (block.weekIndex + 1) % cycleWeeks : block.weekIndex,
        piece.start,
        piece.end,
      ]);
    }
  });

  return rows;
}

async function insertBlocks(
  sql: Sql,
  scheduleId: string,
  cycleWeeks: number,
  blocks: readonly BlockInput[],
): Promise<void> {
  const rows = toBlockRows(scheduleId, cycleWeeks, blocks);
  if (rows.length === 0) return;

  // One statement for the whole week rather than one per block.
  await sql.query(
    `INSERT INTO blocks (schedule_id, label, kind, week_index, start_minute, end_minute)
     VALUES ${placeholders(rows.length, 6)}`,
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

export interface CreateScheduleInput extends CyclePosition {
  name: string;
  timeZone: string;
  isActive: boolean;
  cycleWeeks: number;
  blocks: BlockInput[];
}

export async function createSchedule(
  sql: Sql,
  userId: string,
  input: CreateScheduleInput,
  now: Date,
): Promise<{ schedule: ScheduleRow; blocks: BlockRow[] }> {
  const anchor = resolveAnchor(input.cycleWeeks, input.timeZone, now, input, null);

  return sql.transaction(async (tx) => {
    if (input.isActive) await deactivateOthers(tx, userId, null);

    const schedule = await queryOne<ScheduleRow>(
      tx,
      `INSERT INTO schedules (user_id, name, time_zone, is_active, cycle_weeks, cycle_anchor)
       VALUES ($1, $2, $3, $4, $5, $6::date)
       RETURNING ${SCHEDULE_COLUMNS}`,
      [userId, input.name, input.timeZone, input.isActive, input.cycleWeeks, anchor],
    );
    if (!schedule) throw new Error("Schedule insert returned nothing");

    await insertBlocks(tx, schedule.id, input.cycleWeeks, input.blocks);
    return { schedule, blocks: await listBlocks(tx, schedule.id) };
  });
}

export interface UpdateScheduleInput extends CyclePosition {
  name?: string;
  timeZone?: string;
  isActive?: true;
  cycleWeeks?: number;
}

export async function updateSchedule(
  sql: Sql,
  userId: string,
  scheduleId: string,
  changes: UpdateScheduleInput,
  now: Date,
): Promise<ScheduleRow> {
  return sql.transaction(async (tx) => {
    // Locked, because the block-week check below has to hold until commit: a
    // concurrent block save must not slip a Week B block in after it.
    const existing = await queryOne<ScheduleRow>(
      tx,
      `SELECT ${SCHEDULE_COLUMNS} FROM schedules
        WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [scheduleId, userId],
    );
    if (!existing) throw notFound("No such schedule");

    const cycleWeeks = changes.cycleWeeks ?? existing.cycle_weeks;
    const timeZone = changes.timeZone ?? existing.time_zone;

    if (cycleWeeks < existing.cycle_weeks) {
      // Refused rather than quietly deleting a week of someone's timetable.
      const stranded = await queryOne<{ count: number }>(
        tx,
        `SELECT count(*)::int AS count FROM blocks
          WHERE schedule_id = $1 AND week_index >= $2`,
        [scheduleId, cycleWeeks],
      );
      if (stranded && stranded.count > 0) {
        throw conflict("Remove the blocks in the weeks being dropped first");
      }
    }

    const anchor = resolveAnchor(cycleWeeks, timeZone, now, changes, existing.cycle_anchor);

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

    params.push(cycleWeeks);
    assignments.push(`cycle_weeks = $${params.length}`);
    params.push(anchor);
    assignments.push(`cycle_anchor = $${params.length}::date`);

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
    await insertBlocks(tx, scheduleId, existing.cycle_weeks, blocks);

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
  cycleWeeks: number;
  cycleAnchor: string | null;
  /** Every week of the cycle; the caller picks the week it is resolving. */
  blocks: Block[];
}

interface ComparableRow {
  user_id: string;
  schedule_id: string;
  time_zone: string;
  cycle_weeks: number;
  cycle_anchor: string | null;
  default_visibility: Visibility;
  block_id: string | null;
  label: string | null;
  kind: BlockKind | null;
  week_index: number | null;
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
            s.cycle_weeks,
            s.cycle_anchor::text AS cycle_anchor,
            u.default_visibility,
            b.id                AS block_id,
            b.label,
            b.kind,
            b.week_index,
            b.start_minute,
            b.end_minute
       FROM schedules s
       JOIN users u  ON u.id = s.user_id
       LEFT JOIN blocks b ON b.schedule_id = s.id
      WHERE s.user_id = ANY($1::uuid[]) AND s.is_active
      ORDER BY s.user_id, b.week_index, b.start_minute`,
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
        cycleWeeks: row.cycle_weeks,
        cycleAnchor: row.cycle_anchor,
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
      weekIndex: row.week_index ?? 0,
      start: row.start_minute,
      end: row.end_minute,
    });
  }

  return [...byUser.values()];
}
