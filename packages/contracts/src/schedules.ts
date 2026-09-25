/**
 * Schedules and the blocks inside them.
 *
 * A user may hold several schedules ("Term 1", "Exams") but exactly one is
 * active, and the active one is what everybody else compares against. Keeping
 * old terms around rather than making people retype them is most of the reason
 * schedules exist as their own object at all.
 */

import { z } from "zod";
import {
  blockKindSchema,
  intervalSchema,
  timeZoneSchema,
  uuidSchema,
} from "./common";

export const blockSchema = z.object({
  id: uuidSchema,
  /**
   * Nullable because a viewer without label permission gets the block with its
   * name stripped rather than not at all -- they still need to see that the
   * time is taken.
   */
  label: z.string().nullable(),
  kind: blockKindSchema,
  start: z.number().int(),
  end: z.number().int(),
});

export type Block = z.infer<typeof blockSchema>;

/** A block as the client submits it, before the server assigns an id. */
export const blockInputSchema = intervalSchema.and(
  z.object({
    label: z.string().trim().max(120).nullish(),
    kind: blockKindSchema.default("class"),
  }),
);

export type BlockInput = z.infer<typeof blockInputSchema>;

export const scheduleSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  timeZone: z.string(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Schedule = z.infer<typeof scheduleSchema>;

export const scheduleWithBlocksSchema = scheduleSchema.extend({
  blocks: z.array(blockSchema),
});

export type ScheduleWithBlocks = z.infer<typeof scheduleWithBlocksSchema>;

export const createScheduleRequestSchema = z.object({
  name: z.string().trim().min(1).max(60),
  timeZone: timeZoneSchema,
  /** Defaults to true: a first schedule that is not active is a dead end. */
  isActive: z.boolean().default(true),
  blocks: z.array(blockInputSchema).max(500).default([]),
});

export type CreateScheduleRequest = z.infer<typeof createScheduleRequestSchema>;

export const updateScheduleRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    timeZone: timeZoneSchema.optional(),
    isActive: z.literal(true).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Nothing to update",
  });

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
