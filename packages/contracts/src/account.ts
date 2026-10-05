/**
 * The caller's control over their own account: what others see, and the two
 * data-protection rights the API serves directly -- a copy of everything, and
 * deletion of everything.
 */

import { z } from "zod";
import { visibilitySchema } from "./common";
import { privateUserSchema } from "./auth";
import { blockSchema, scheduleSchema } from "./schedules";
import { friendshipStatusSchema, groupRoleSchema } from "./social";

export const privacySettingsSchema = z.object({
  defaultVisibility: visibilitySchema,
});

export type PrivacySettings = z.infer<typeof privacySettingsSchema>;

/**
 * Everything we hold about the caller, in one document.
 *
 * Built for a person, not for re-import: names are resolved, ids are kept so
 * entries can be cross-referenced, and nothing is redacted, because none of it
 * is anyone else's. Secrets are the one exception -- refresh tokens are stored
 * only as hashes and are listed here by device, never by value.
 */
export const accountExportSchema = z.object({
  exportedAt: z.string().datetime(),
  user: privateUserSchema,
  identities: z.array(
    z.object({
      provider: z.string(),
      providerSubject: z.string(),
      createdAt: z.string().datetime(),
    }),
  ),
  schedules: z.array(scheduleSchema.extend({ blocks: z.array(blockSchema) })),
  friendships: z.array(
    z.object({
      userId: z.string().uuid(),
      displayName: z.string(),
      status: friendshipStatusSchema,
      requestedByMe: z.boolean(),
      createdAt: z.string().datetime(),
    }),
  ),
  groups: z.array(
    z.object({
      groupId: z.string().uuid(),
      name: z.string(),
      role: groupRoleSchema,
      joinedAt: z.string().datetime(),
    }),
  ),
  sessions: z.array(
    z.object({
      createdAt: z.string().datetime(),
      expiresAt: z.string().datetime(),
      revokedAt: z.string().datetime().nullable(),
      userAgent: z.string().nullable(),
    }),
  ),
});

export type AccountExport = z.infer<typeof accountExportSchema>;
