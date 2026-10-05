/**
 * The login exchange.
 *
 * Google proves who someone is; we decide what that means in our system. The
 * client sends us a Google ID token exactly once per sign-in, and from then on
 * talks to us with our own tokens. Nothing downstream of this file knows or
 * cares that Google was involved, which is what makes adding Apple sign-in a
 * new value in `authProviderSchema` rather than a refactor.
 */

import { z } from "zod";
import { publicUserSchema, timeZoneSchema, visibilitySchema } from "./common";

export const authProviderSchema = z.enum(["google"]);
export type AuthProvider = z.infer<typeof authProviderSchema>;

export const googleSignInRequestSchema = z.object({
  /** The `id_token` from Google Sign-In. Verified against Google's JWKS. */
  idToken: z.string().min(1),
  /**
   * The device's zone, used to seed the first schedule so a new user is not
   * asked a timezone question before they have seen the app work.
   */
  timeZone: timeZoneSchema.optional(),
});

export type GoogleSignInRequest = z.infer<typeof googleSignInRequestSchema>;

/** The caller's own profile, which unlike PublicUser does include the email. */
export const privateUserSchema = publicUserSchema.extend({
  email: z.string().email(),
  defaultVisibility: visibilitySchema,
  /** Shown as text and as a QR code; anyone holding it can send a request. */
  friendCode: z.string(),
  createdAt: z.string().datetime(),
});

export type PrivateUser = z.infer<typeof privateUserSchema>;

export const sessionSchema = z.object({
  /** Short-lived; sent as a bearer token on every request. */
  accessToken: z.string(),
  /** Seconds until `accessToken` stops being accepted. */
  expiresIn: z.number().int().positive(),
  /** Long-lived, single-use. Rotated on every refresh. */
  refreshToken: z.string(),
  user: privateUserSchema,
});

export type Session = z.infer<typeof sessionSchema>;

export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1),
});

export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

export const logoutRequestSchema = z.object({
  /**
   * Optional: without it we revoke only the token family this request is
   * authenticated as, which logs out this device and leaves the others alone.
   */
  refreshToken: z.string().min(1).optional(),
  /** Sign out everywhere, for a lost phone. */
  allDevices: z.boolean().default(false),
});

export type LogoutRequest = z.infer<typeof logoutRequestSchema>;

export const updateMeRequestSchema = z
  .object({
    displayName: z.string().trim().min(1).max(60).optional(),
    defaultVisibility: visibilitySchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Nothing to update",
  });

export type UpdateMeRequest = z.infer<typeof updateMeRequestSchema>;
