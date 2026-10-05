/**
 * Pieces shared by every other contract: identifiers, the error envelope, and
 * the validators that keep the minute-of-week axis honest at the edge of the
 * system.
 *
 * Validating here rather than in the API means the mobile client rejects a bad
 * block before it costs a round trip, and the two can never disagree about
 * what "valid" means.
 */

import { z } from "zod";
import { MINUTES_PER_WEEK, isValidTimeZone, parseCalendarDate } from "@whosonbreak/core";

export const uuidSchema = z.string().uuid();

/**
 * A point on the minute-of-week axis: Monday 00:00 is 0, Sunday 23:59 is 10079.
 */
export const minuteOfWeekSchema = z
  .number()
  .int("Minutes are whole numbers")
  .min(0, "Before the start of the week")
  .max(MINUTES_PER_WEEK, "Past the end of the week");

/**
 * A submitted block.
 *
 * `end` may run past the end of the week, because a shift entered as "Sunday
 * 23:00 for two hours" genuinely does. Letting the client say that plainly and
 * splitting it server-side is better than making every caller work out that it
 * is really two blocks -- and the server has to handle it anyway, since a
 * malicious client would send it regardless.
 *
 * A block may not be longer than a week, which would wrap onto itself.
 */
export const intervalSchema = z
  .object({
    start: minuteOfWeekSchema,
    end: z.number().int().min(1).max(MINUTES_PER_WEEK * 2),
  })
  .refine((interval) => interval.start < MINUTES_PER_WEEK, {
    message: "A block cannot start at the very end of the week",
    path: ["start"],
  })
  .refine((interval) => interval.start < interval.end, {
    message: "A block has to end after it starts",
    path: ["end"],
  })
  .refine((interval) => interval.end - interval.start <= MINUTES_PER_WEEK, {
    message: "A block cannot be longer than a week",
    path: ["end"],
  });

export type Interval = z.infer<typeof intervalSchema>;

/**
 * Checked against the runtime's own IANA database rather than a regex, because
 * a name that merely looks plausible would fail much later, at comparison
 * time, on someone else's device.
 */
export const timeZoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isValidTimeZone, { message: "Not a recognised IANA time zone" });

/** A calendar date with no time or zone, as YYYY-MM-DD. Must actually exist. */
export const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .refine(
    (value) => {
      try {
        parseCalendarDate(value);
        return true;
      } catch {
        return false;
      }
    },
    { message: "Not a real date" },
  );

/** How much of a person's schedule other people are allowed to see. */
export const visibilitySchema = z.enum(["busy_only", "labels", "full"]);
export type Visibility = z.infer<typeof visibilitySchema>;

export const blockKindSchema = z.enum(["class", "work", "other"]);
export type BlockKind = z.infer<typeof blockKindSchema>;

/**
 * Every failure the API returns has this shape, so the client has exactly one
 * error path to write. `code` is for the client to branch on; `message` is for
 * a human reading a log, never for display.
 */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    /** Field-level detail, present only for validation failures. */
    fields: z.record(z.string(), z.array(z.string())).optional(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

export const ERROR_CODES = {
  validationFailed: "validation_failed",
  unauthenticated: "unauthenticated",
  forbidden: "forbidden",
  notFound: "not_found",
  conflict: "conflict",
  rateLimited: "rate_limited",
  /** A group already has the maximum number of members. */
  groupFull: "group_full",
  internal: "internal",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** A person as everyone else sees them. Never carries an email address. */
export const publicUserSchema = z.object({
  id: uuidSchema,
  displayName: z.string(),
  avatarUrl: z.string().url().nullable(),
});

export type PublicUser = z.infer<typeof publicUserSchema>;

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});
