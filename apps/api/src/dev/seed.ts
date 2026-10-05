/**
 * Demo data for trying the API by hand: three people, one group, one
 * friendship, and schedules whose shared breaks can be checked on paper.
 *
 *   Ada    Europe/London    Mon-Fri 09:00-12:00 and 13:00-16:00
 *   Ben    Europe/London    Mon-Fri 09:00-11:00 and 12:30-16:00
 *   Cleo   America/New_York Mon-Fri 08:00-10:00 (13:00-15:00 London time in winter)
 *
 * All three are in "Demo group". In London time on a winter weekday, Ada and
 * Ben are both free 08:00-09:00, 12:00-12:30 and 16:00-22:00, and Cleo is free
 * through all of those too -- her shift falls inside Ada's lab and Ben's
 * studio -- so every shared break has all three in it.
 *
 * Users are created as if they had signed in with Google, through the same
 * repository function a real sign-in uses, so nothing here is a back door.
 */

import { Weekday, clock, toMinuteOfWeek } from "@whosonbreak/core";
import type { BlockInput } from "@whosonbreak/contracts";
import type { Config } from "../config.ts";
import type { Sql } from "../db/sql.ts";
import { generateRefreshToken, signAccessToken } from "../auth/tokens.ts";
import { findOrCreateUserForIdentity, type UserRow } from "../repositories/users.ts";
import { createSchedule, listSchedulesForUser } from "../repositories/schedules.ts";
import { createGroup, joinGroupByCode } from "../repositories/groups.ts";
import { acceptFriendship, requestFriendship } from "../repositories/friends.ts";
import { storeRefreshToken } from "../repositories/sessions.ts";

const WEEKDAYS = [
  Weekday.Monday,
  Weekday.Tuesday,
  Weekday.Wednesday,
  Weekday.Thursday,
  Weekday.Friday,
];

function everyWeekday(label: string, from: [number, number], to: [number, number]): BlockInput[] {
  return WEEKDAYS.map((day) => ({
    label,
    kind: "class" as const,
    weekIndex: 0,
    start: toMinuteOfWeek(day, clock(...from)),
    end: toMinuteOfWeek(day, clock(...to)),
  }));
}

const PEOPLE = [
  {
    key: "ada",
    name: "Ada (demo)",
    zone: "Europe/London",
    blocks: [
      ...everyWeekday("Morning lectures", [9, 0], [12, 0]),
      ...everyWeekday("Lab", [13, 0], [16, 0]),
    ],
  },
  {
    key: "ben",
    name: "Ben (demo)",
    zone: "Europe/London",
    blocks: [
      ...everyWeekday("Seminar", [9, 0], [11, 0]),
      ...everyWeekday("Studio", [12, 30], [16, 0]),
    ],
  },
  {
    key: "cleo",
    name: "Cleo (demo)",
    zone: "America/New_York",
    blocks: everyWeekday("Shift", [8, 0], [10, 0]),
  },
] as const;

export interface SeedResult {
  users: Record<string, UserRow>;
  groupId: string;
  joinCode: string;
}

/** Idempotent for users and schedules; a second run adds a second group. */
export async function seed(db: Sql, now: Date): Promise<SeedResult> {
  const users: Record<string, UserRow> = {};

  for (const person of PEOPLE) {
    const { user } = await findOrCreateUserForIdentity(db, "google", {
      subject: `seed-${person.key}`,
      email: `${person.key}@example.invalid`,
      emailVerified: true,
      name: person.name,
      pictureUrl: null,
    });
    users[person.key] = user;

    const existing = await listSchedulesForUser(db, user.id);
    if (existing.length === 0) {
      await createSchedule(
        db,
        user.id,
        {
          name: "Demo term",
          timeZone: person.zone,
          isActive: true,
          cycleWeeks: 1,
          blocks: [...person.blocks],
        },
        now,
      );
    }
  }

  const ada = users.ada as UserRow;
  const ben = users.ben as UserRow;
  const cleo = users.cleo as UserRow;

  const group = await createGroup(db, ada.id, "Demo group");
  await joinGroupByCode(db, ben.id, group.join_code);
  await joinGroupByCode(db, cleo.id, group.join_code);

  try {
    const request = await requestFriendship(db, ada.id, ben.id);
    if (request.status === "pending") await acceptFriendship(db, request.id, ben.id);
  } catch {
    // Already friends from an earlier run.
  }

  return { users, groupId: group.id, joinCode: group.join_code };
}

/**
 * A working access token for a seeded user, backed by a real stored session so
 * logout and refresh behave exactly as they would after a real sign-in.
 */
export async function devSession(
  db: Sql,
  config: Config,
  user: UserRow,
  now: Date,
): Promise<{ accessToken: string; refreshToken: string }> {
  const refreshToken = generateRefreshToken();
  const stored = await storeRefreshToken(db, {
    userId: user.id,
    token: refreshToken,
    expiresAt: new Date(now.getTime() + config.refreshTokenTtlDays * 24 * 60 * 60_000),
    userAgent: "seed script",
  });
  return {
    accessToken: await signAccessToken(config, user.id, stored.familyId),
    refreshToken,
  };
}

export function describeSeed(result: SeedResult, tokens: Record<string, string>, base: string) {
  const lines = [
    "",
    `Seeded "Demo group" (${result.groupId}), join code ${result.joinCode}.`,
    "",
  ];
  for (const [key, user] of Object.entries(result.users)) {
    lines.push(`${user.display_name}  friend code ${user.friend_code}`);
    lines.push(`  TOKEN_${key.toUpperCase()}=${tokens[key]}`);
  }
  lines.push(
    "",
    "Try:",
    `  curl -H "Authorization: Bearer $TOKEN_ADA" "${base}/v1/groups/${result.groupId}/breaks?week=2026-01-14"`,
    "",
  );
  return lines.join("\n");
}
