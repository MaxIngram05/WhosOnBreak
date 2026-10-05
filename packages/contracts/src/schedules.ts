/**
 * Schedules and the blocks inside them.
 *
 * A user may hold several schedules ("Term 1", "Exams") but exactly one is
 * active, and the active one is what everybody else compares against. Keeping
 * old terms around rather than making people retype them is most of the reason
 * schedules exist as their own object at all.
 *
 * A schedule repeats every `cycleWeeks` weeks. For most people that is one;
 * for a school running a Week A / Week B timetable it is two, and every block
 * says which of those weeks it belongs to.
 */

import { z } from "zod";
import {
  blockKindSchema,
  calendarDateSchema,
  intervalSchema,
  timeZoneSchema,
  uuidSchema,
} from "./common";

/** The longest rotation supported. Two covers Week A / Week B. */
export const MAX_CYCLE_WEEKS = 2;

export const cycleWeeksSchema = z.number().int().min(1).max(MAX_CYCLE_WEEKS);

/** 0 is Week A, 1 is Week B. */
export const weekIndexSchema = z
  .number()
  .int()
  .min(0)
  .max(MAX_CYCLE_WEEKS - 1);

export const blockSchema = z.object({
  id: uuidSchema,
  /**
   * Nullable because a viewer without label permission gets the block with its
   * name stripped rather than not at all -- they still need to see that the
   * time is taken.
   */
  label: z.string().nullable(),
  kind: blockKindSchema,
  weekIndex: weekIndexSchema,
  start: z.number().int(),
  end: z.number().int(),
});

export type Block = z.infer<typeof blockSchema>;

/**
 * A block as the client submits it, before the server assigns an id.
 *
 * A block in the last week of the cycle that runs past Sunday midnight
 * continues into the first week, not back into its own -- the server splits it
 * accordingly.
 */
export const blockInputSchema = intervalSchema.and(
  z.object({
    label: z.string().trim().max(120).nullish(),
    kind: blockKindSchema.default("class"),
    weekIndex: weekIndexSchema.default(0),
  }),
);

export type BlockInput = z.infer<typeof blockInputSchema>;

export const scheduleSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  timeZone: z.string(),
  isActive: z.boolean(),
  cycleWeeks: cycleWeeksSchema,
  /** The Monday that was Week A. Null for a one-week schedule. */
  cycleAnchor: calendarDateSchema.nullable(),
  /**
   * Which week of the cycle it is right now in the schedule's own zone,
   * worked out by the server so the app never has to repeat the arithmetic.
   */
  currentWeekIndex: weekIndexSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Schedule = z.infer<typeof scheduleSchema>;

export const scheduleWithBlocksSchema = scheduleSchema.extend({
  blocks: z.array(blockSchema),
});

export type ScheduleWithBlocks = z.infer<typeof scheduleWithBlocksSchema>;

/**
 * Two ways to say where the rotation stands, and at most one may be given:
 *
 * - `currentWeekIndex`: "this week is Week B". What the app asks, because
 *   people know what this week is far more reliably than what date term began.
 * - `cycleAnchor`: any date in a week that was Week A, for an importer or a
 *   group-wide setting that already knows it.
 *
 * Neither, on a two-week schedule, means this week is Week A.
 */
const cyclePositionShape = {
  currentWeekIndex: weekIndexSchema.optional(),
  cycleAnchor: calendarDateSchema.optional(),
};

function atMostOnePosition(body: { currentWeekIndex?: number; cycleAnchor?: string }) {
  return body.currentWeekIndex === undefined || body.cycleAnchor === undefined;
}

const onePositionMessage = {
  message: "Give currentWeekIndex or cycleAnchor, not both",
  path: ["cycleAnchor"],
};

export const createScheduleRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    timeZone: timeZoneSchema,
    /** Defaults to true: a first schedule that is not active is a dead end. */
    isActive: z.boolean().default(true),
    cycleWeeks: cycleWeeksSchema.default(1),
    ...cyclePositionShape,
    blocks: z.array(blockInputSchema).max(500).default([]),
  })
  .refine(atMostOnePosition, onePositionMessage);

export type CreateScheduleRequest = z.infer<typeof createScheduleRequestSchema>;

export const updateScheduleRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    timeZone: timeZoneSchema.optional(),
    isActive: z.literal(true).optional(),
    cycleWeeks: cycleWeeksSchema.optional(),
    ...cyclePositionShape,
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Nothing to update",
  })
  .refine(atMostOnePosition, onePositionMessage);

export type UpdateScheduleRequest = z.infer<typeof updateScheduleRequestSchema>;

/**
 * Blocks are replaced wholesale rather than patched one at a time.
 *
 * The editor this serves is a week grid: a person drags three things and
 * expects one save. Sending the whole set makes that one transaction and one
 * obvious meaning, where per-block diffing would have the client reconstruct
 * server state it does not own.
 *
 * `expectedUpdatedAt` is how a second device finds out it was working from a
 * stale copy instead of silently winning.
 */
export const replaceBlocksRequestSchema = z.object({
  blocks: z.array(blockInputSchema).max(500),
  expectedUpdatedAt: z.string().datetime().optional(),
});

export type ReplaceBlocksRequest = z.infer<typeof replaceBlocksRequestSchema>;
