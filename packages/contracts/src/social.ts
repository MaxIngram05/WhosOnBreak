/**
 * The two ways people get connected.
 *
 * Friendships are mutual and symmetric: useful for "when are Sam and I both
 * free". Groups are named and joined with a short code: useful for "who from
 * my form is around right now", which is the screen the app opens on.
 *
 * Both exist because neither alone is enough. A group of thirty classmates is
 * the wrong unit for making lunch plans with one person, and thirty pairwise
 * friend requests is the wrong way to build a class.
 */

import { z } from "zod";
import { publicUserSchema, uuidSchema } from "./common";

export const friendshipStatusSchema = z.enum(["pending", "accepted", "blocked"]);
export type FriendshipStatus = z.infer<typeof friendshipStatusSchema>;

export const friendSchema = z.object({
  /** The friendship itself, which is what accepting a request refers to. */
  id: uuidSchema,
  user: publicUserSchema,
  status: friendshipStatusSchema,
  /**
   * Who sent the request. With `status: "pending"` this is what tells the UI
   * whether to offer Accept or to show "requested".
   */
  requestedBy: uuidSchema,
  since: z.string().datetime(),
});

export type Friend = z.infer<typeof friendSchema>;


export const groupRoleSchema = z.enum(["owner", "member"]);
export type GroupRole = z.infer<typeof groupRoleSchema>;

/**
 * Six characters from an alphabet with no 0/O/1/I/L, because this gets read
 * aloud across a classroom.
 */
export const JOIN_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const JOIN_CODE_LENGTH = 6;

export const joinCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(JOIN_CODE_LENGTH)
  .regex(new RegExp(`^[${JOIN_CODE_ALPHABET}]+$`), "Not a valid join code");

/**
 * Everyone has a personal friend code: typed in, or scanned from the QR code
 * the app draws from it. Eight characters rather than a group's six, because a
 * friend code reaches one specific person and should not be stumbled on by
 * guessing.
 */
export const FRIEND_CODE_LENGTH = 8;

/**
 * Accepts the code however it was copied -- lower case, with the hyphen the
 * app displays it with ("ABCD-EFGH"), or with stray spaces.
 */
export const friendCodeSchema = z
  .string()
  .transform((value) => value.replace(/[\s-]/g, "").toUpperCase())
  .pipe(
    z
      .string()
      .length(FRIEND_CODE_LENGTH, "Friend codes are eight characters")
      .regex(new RegExp(`^[${JOIN_CODE_ALPHABET}]+$`), "Not a valid friend code"),
  );

/**
 * A request is addressed by friend code, or by user id for someone you share
 * a group with. There is deliberately no search: the only people you can reach
 * are ones who gave you their code or are already in a group with you.
 */
export const createFriendRequestSchema = z
  .object({
    friendCode: friendCodeSchema.optional(),
    userId: uuidSchema.optional(),
  })
  .refine((body) => (body.friendCode === undefined) !== (body.userId === undefined), {
    message: "Give exactly one of friendCode or userId",
  });

export type CreateFriendRequest = z.infer<typeof createFriendRequestSchema>;

/**
 * A group stays small enough that browsing each member's week one by one is
 * a reasonable thing to do -- a class, not a year group.
 */
export const MAX_GROUP_MEMBERS = 30;

export const groupSubtitleSchema = z.string().trim().max(80);

export const groupSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  /** Free text to tell same-named groups apart: "Mr Smith, Room 4". */
  subtitle: z.string().nullable(),
  /**
   * Present only for the owner and members who may invite. Everyone else is
   * in the group without being able to bring anyone else into it.
   */
  joinCode: z.string().optional(),
  memberCount: z.number().int().nonnegative(),
  role: groupRoleSchema,
  /** Whether the caller may share the code and send invites. */
  canInvite: z.boolean(),
  createdAt: z.string().datetime(),
});

export type Group = z.infer<typeof groupSchema>;

export const groupMemberSchema = z.object({
  user: publicUserSchema,
  role: groupRoleSchema,
  canInvite: z.boolean(),
  joinedAt: z.string().datetime(),
  /** False when someone has joined but not entered a schedule yet. */
  hasSchedule: z.boolean(),
});

export type GroupMember = z.infer<typeof groupMemberSchema>;

export const groupDetailSchema = groupSchema.extend({
  members: z.array(groupMemberSchema),
});

export type GroupDetail = z.infer<typeof groupDetailSchema>;

export const createGroupRequestSchema = z.object({
  name: z.string().trim().min(1).max(60),
  subtitle: groupSubtitleSchema.optional(),
});

export type CreateGroupRequest = z.infer<typeof createGroupRequestSchema>;

/** Owner only. A null or empty subtitle clears it. */
export const updateGroupRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    subtitle: groupSubtitleSchema.nullable().optional(),
  })
  .refine((body) => body.name !== undefined || body.subtitle !== undefined, {
    message: "Nothing to update",
  });

export type UpdateGroupRequest = z.infer<typeof updateGroupRequestSchema>;

/** Owner only: who besides the owner may bring people in. */
export const updateGroupMemberRequestSchema = z.object({
  canInvite: z.boolean(),
});

export type UpdateGroupMemberRequest = z.infer<typeof updateGroupMemberRequestSchema>;

export const joinGroupRequestSchema = z.object({
  code: joinCodeSchema,
});

export type JoinGroupRequest = z.infer<typeof joinGroupRequestSchema>;

/** A member who may invite asks one of their friends to join. */
export const createGroupInviteRequestSchema = z.object({
  userId: uuidSchema,
});

export type CreateGroupInviteRequest = z.infer<typeof createGroupInviteRequestSchema>;

export const groupInviteSchema = z.object({
  id: uuidSchema,
  group: z.object({
    id: uuidSchema,
    name: z.string(),
    subtitle: z.string().nullable(),
    memberCount: z.number().int().nonnegative(),
  }),
  inviter: publicUserSchema,
  invitee: publicUserSchema,
  createdAt: z.string().datetime(),
});

export type GroupInvite = z.infer<typeof groupInviteSchema>;

