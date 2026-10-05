/**
 * The comparison endpoints -- the thing the app is actually for.
 *
 * Note what the query takes and what it does not. It takes a viewer time zone
 * and a reference week, because a break only means anything relative to a
 * clock and a calendar. It does not take the schedules: those are whatever the
 * members have saved, resolved server-side, so nobody can ask about a schedule
 * they are not entitled to see by simply sending it themselves.
 */

import { z } from "zod";
import {
  blockKindSchema,
  calendarDateSchema,
  minuteOfWeekSchema,
  publicUserSchema,
  timeZoneSchema,
  uuidSchema,
} from "./common";

/**
 * Night is not a shared break. Without a window the answer is "everyone, every
 * night, forever" and the feature is worthless.
 */
export const dayWindowSchema = z
  .object({
    startMinute: z.number().int().min(0).max(1440),
    endMinute: z.number().int().min(0).max(1440),
  })
  .refine((window) => window.startMinute < window.endMinute, {
    message: "The day has to end after it starts",
    path: ["endMinute"],
  });

export type DayWindow = z.infer<typeof dayWindowSchema>;

export const breakQuerySchema = z.object({
  /** The zone to express the answer in. Defaults to the caller's schedule. */
  timeZone: timeZoneSchema.optional(),
  /**
   * Any date inside the week to resolve against, as YYYY-MM-DD. Defaults to
   * this week. It matters only across a daylight saving boundary, but there it
   * matters a lot.
   */
  week: calendarDateSchema.optional(),
  dayStartMinute: z.coerce.number().int().min(0).max(1440).optional(),
  dayEndMinute: z.coerce.number().int().min(0).max(1440).optional(),
  minDurationMinutes: z.coerce.number().int().min(5).max(1440).default(15),
  /**
   * How many people have to be free at once. Two is the useful default; the
   * whole group is the stricter "when can we all meet" question.
   */
  minParticipants: z.coerce.number().int().min(2).max(100).default(2),
});

export type BreakQuery = z.infer<typeof breakQuerySchema>;

export const breakSegmentSchema = z.object({
  start: minuteOfWeekSchema,
  end: minuteOfWeekSchema,
  durationMinutes: z.number().int().positive(),
  /**
   * Everyone free for this whole span. Carried per segment rather than per
   * query, so "three of your five friends are free at 12:10" needs no second
   * request.
   */
  users: z.array(publicUserSchema),
});

export type BreakSegment = z.infer<typeof breakSegmentSchema>;

export const breaksResponseSchema = z.object({
  /** The zone every minute in this response is expressed in. */
  timeZone: z.string(),
  /** Monday of the week these were resolved against, as YYYY-MM-DD. */
  weekStart: z.string(),
  segments: z.array(breakSegmentSchema),
  /**
   * Members who were left out because they have no active schedule. Surfacing
   * them stops the app quietly implying a friend is busy when really they have
   * not signed up properly yet.
   */
  excluded: z.array(publicUserSchema),
});

export type BreaksResponse = z.infer<typeof breaksResponseSchema>;

/** The home screen: who is free at this exact minute. */
export const onBreakNowResponseSchema = z.object({
  timeZone: z.string(),
  /** Where "now" falls on the minute-of-week axis, for lining up a timeline. */
  nowMinuteOfWeek: minuteOfWeekSchema,
  onBreak: z.array(
    publicUserSchema.extend({
      /** When their current free span ends, so the UI can say "for 40m". */
      until: minuteOfWeekSchema,
      freeForMinutes: z.number().int().nonnegative(),
    }),
  ),
  busy: z.array(
    publicUserSchema.extend({
      /**
       * When they next come free, or null if that is not before the day
       * window closes -- outside the window counts as unavailable.
       */
      until: minuteOfWeekSchema.nullable(),
      /**
       * What they are in, only when their visibility setting allows labels.
       * Null otherwise, which the UI shows as plain "busy".
       */
      label: z.string().nullable(),
      /** Class, work or other -- only when their visibility is `full`. */
      kind: blockKindSchema.nullable(),
    }),
  ),
  unknown: z.array(publicUserSchema),
});

export type OnBreakNowResponse = z.infer<typeof onBreakNowResponseSchema>;

/** Ad-hoc comparison against friends, outside any group. */
export const adHocBreakQuerySchema = breakQuerySchema.extend({
  userIds: z
    .union([z.array(uuidSchema), z.string()])
    .transform((value) => (Array.isArray(value) ? value : value.split(",")))
    .pipe(z.array(uuidSchema).min(1).max(50)),
});

export type AdHocBreakQuery = z.infer<typeof adHocBreakQuerySchema>;

/**
 * One person's busy time for a week, as the viewer is allowed to see it.
 *
 * Blocks are on the viewer's axis (in `timeZone`), for whichever week of the
 * person's own cycle falls in the requested week. What each block reveals
 * follows the owner's visibility setting:
 *
 * - busy_only: start and end only; label and kind are null
 * - labels:    plus the label
 * - full:      plus the kind (class / work / other)
 */
export const weekViewQuerySchema = z.object({
  timeZone: timeZoneSchema.optional(),
  week: calendarDateSchema.optional(),
});

export type WeekViewQuery = z.infer<typeof weekViewQuerySchema>;

export const visibleBlockSchema = z.object({
  start: minuteOfWeekSchema,
  end: minuteOfWeekSchema,
  label: z.string().nullable(),
  kind: blockKindSchema.nullable(),
});

export type VisibleBlock = z.infer<typeof visibleBlockSchema>;

export const weekViewSchema = z.object({
  user: publicUserSchema,
  timeZone: z.string(),
  weekStart: z.string(),
  /** False when they have no active schedule; `blocks` is then empty. */
  hasSchedule: z.boolean(),
  /** Which week of their own cycle this is: 0 for Week A, 1 for Week B. */
  weekIndex: z.number().int().nonnegative(),
  cycleWeeks: z.number().int().positive(),
  blocks: z.array(visibleBlockSchema),
});

export type WeekView = z.infer<typeof weekViewSchema>;
