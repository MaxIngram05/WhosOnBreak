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

export const groupSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  /** Only ever sent to members; absent for everyone else. */
  joinCode: z.string().optional(),
  memberCount: z.number().int().nonnegative(),
  role: groupRoleSchema,
  createdAt: z.string().datetime(),
});

export type Group = z.infer<typeof groupSchema>;

export const groupMemberSchema = z.object({
  user: publicUserSchema,
  role: groupRoleSchema,
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
});

export type CreateGroupRequest = z.infer<typeof createGroupRequestSchema>;

export const joinGroupRequestSchema = z.object({
  code: joinCodeSchema,
});

export type JoinGroupRequest = z.infer<typeof joinGroupRequestSchema>;
