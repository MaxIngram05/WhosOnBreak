/**
 * A sample class to try the app with: eight people on Montreal time, in one
 * group whose join code is always BREAKS.
 *
 * Everyone is created with a dev identity named after them, so on a
 * development server you can sign in *as* any of them by typing their name --
 * "Ada" on a second phone is the sample Ada, owner of the group. That is how
 * to test both sides of anything: invites, permissions, friend requests.
 *
 *   Ada    owner, shows everything (full)
 *   Ben    shows names (labels)
 *   Cleo   on exchange in London, so her week is shifted onto Montreal time
 *   Dev    works shifts as well as classes
 *   Ella   shows everything (full)
 *   Finn   two-week timetable (Week A / Week B)
 *   Gia    shows busy times only (the default)
 *   Hugo   joined but has not added a schedule
 *
 * Safe to run on every start: people, schedules and the group are only
 * created when missing, so nobody's edits are overwritten.
 */

import { Weekday, clock, toMinuteOfWeek } from "@whosonbreak/core";
import type { BlockInput, BlockKind, Visibility } from "@whosonbreak/contracts";
import type { Sql } from "../db/sql.ts";
import { queryOne } from "../db/sql.ts";
import { findOrCreateUserForIdentity, updateUser, type UserRow } from "../repositories/users.ts";
import { createSchedule, listSchedulesForUser } from "../repositories/schedules.ts";
import { createGroup, joinGroupByCode } from "../repositories/groups.ts";
import { acceptFriendship, findFriendship, requestFriendship } from "../repositories/friends.ts";

/** The sample group's join code. Every letter is in the join-code alphabet. */
export const SAMPLE_JOIN_CODE = "BREAKS";

const MONTREAL = "America/Toronto";
const { Monday: MON, Tuesday: TUE, Wednesday: WED, Thursday: THU, Friday: FRI, Saturday: SAT } =
  Weekday;

function on(
  days: number[],
  from: [number, number],
  to: [number, number],
  label: string,
  kind: BlockKind = "class",
  weekIndex = 0,
): BlockInput[] {
  return days.map((day) => ({
    label,
    kind,
    weekIndex,
    start: toMinuteOfWeek(day as Weekday, clock(...from)),
    end: toMinuteOfWeek(day as Weekday, clock(...to)),
  }));
}

interface SamplePerson {
  name: string;
  zone: string;
  visibility: Visibility;
  cycleWeeks?: number;
  /** Omitted: has joined the group but never added a schedule. */
  blocks?: BlockInput[];
}

const PEOPLE: SamplePerson[] = [
  {
    name: "Ada",
    zone: MONTREAL,
    visibility: "full",
    blocks: [
      ...on([MON, WED], [10, 15], [11, 30], "COMP 248"),
      ...on([MON, WED], [13, 15], [14, 30], "MATH 204"),
      ...on([TUE, THU], [9, 0], [11, 45], "Physics lab"),
      ...on([FRI], [10, 0], [12, 0], "Seminar"),
    ],
  },
  {
    name: "Ben",
    zone: MONTREAL,
    visibility: "labels",
    blocks: [
      ...on([MON, WED, FRI], [8, 45], [10, 0], "ENGR 201"),
      ...on([TUE, THU], [13, 0], [16, 0], "Design studio"),
      ...on([WED], [17, 45], [20, 15], "Evening class"),
    ],
  },
  {
    name: "Cleo",
    zone: "Europe/London",
    visibility: "busy_only",
    // 14:00-18:00 in London is 09:00-13:00 in Montreal.
    blocks: on([MON, TUE, WED, THU], [14, 0], [18, 0], "Internship", "work"),
  },
  {
    name: "Dev",
    zone: MONTREAL,
    visibility: "labels",
    blocks: [
      ...on([MON], [9, 0], [12, 0], "COMP 249"),
      ...on([TUE, THU], [11, 0], [17, 0], "Shift at the café", "work"),
      ...on([SAT], [10, 0], [16, 0], "Shift at the café", "work"),
    ],
  },
  {
    name: "Ella",
    zone: MONTREAL,
    visibility: "full",
    blocks: [
      ...on([MON, TUE, WED, THU, FRI], [9, 0], [12, 0], "Lectures"),
      ...on([FRI], [13, 0], [15, 0], "Tutoring", "other"),
    ],
  },
  {
    name: "Finn",
    zone: MONTREAL,
    visibility: "labels",
    cycleWeeks: 2,
    blocks: [
      ...on([MON, WED, FRI], [9, 0], [12, 0], "Week A classes", "class", 0),
      ...on([TUE, THU], [13, 0], [17, 0], "Week B labs", "class", 1),
    ],
  },
  {
    name: "Gia",
    zone: MONTREAL,
    visibility: "busy_only",
    blocks: [
      ...on([MON, WED], [15, 0], [18, 0], "Appointment", "other"),
      ...on([TUE, THU], [8, 30], [10, 0], "Morning class"),
    ],
  },
  { name: "Hugo", zone: MONTREAL, visibility: "busy_only" },
];

/** Who already knows whom, so the friend features have something in them. */
const FRIENDSHIPS: [string, string][] = [
  ["Ada", "Ben"],
  ["Ada", "Ella"],
  ["Ben", "Dev"],
  ["Finn", "Gia"],
];

export interface SeedResult {
  users: Record<string, UserRow>;
  groupId: string;
  joinCode: string;
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

export async function seed(db: Sql, now: Date): Promise<SeedResult> {
  const users: Record<string, UserRow> = {};

  for (const person of PEOPLE) {
    // The same identity the dev sign-in route creates for this name, so the
    // sample person and "sign in as Ada" are one account.
    const { user, created } = await findOrCreateUserForIdentity(db, "dev", {
      subject: slug(person.name),
      email: `${slug(person.name)}@dev.invalid`,
      emailVerified: true,
      name: person.name,
      pictureUrl: null,
    });
    users[person.name] = user;

    if (created) {
      await updateUser(db, user.id, { defaultVisibility: person.visibility });
    }

    if (person.blocks && (await listSchedulesForUser(db, user.id)).length === 0) {
      await createSchedule(
        db,
        user.id,
        {
          name: "Fall term",
          timeZone: person.zone,
          isActive: true,
          cycleWeeks: person.cycleWeeks ?? 1,
          ...(person.cycleWeeks === 2 ? { currentWeekIndex: 0 } : {}),
          blocks: person.blocks,
        },
        now,
      );
    }
  }

  const owner = users.Ada as UserRow;

  let group = await queryOne<{ id: string }>(
    db,
    `SELECT id FROM groups WHERE join_code = $1 AND archived_at IS NULL`,
    [SAMPLE_JOIN_CODE],
  );
  if (!group) {
    const created = await createGroup(db, owner.id, {
      name: "Sample class",
      subtitle: "Test group · join with BREAKS",
    });
    await db.query(`UPDATE groups SET join_code = $2 WHERE id = $1`, [
      created.id,
      SAMPLE_JOIN_CODE,
    ]);
    group = { id: created.id };
  }

  for (const user of Object.values(users)) {
    if (user.id !== owner.id) await joinGroupByCode(db, user.id, SAMPLE_JOIN_CODE);
  }

  for (const [a, b] of FRIENDSHIPS) {
    const from = users[a] as UserRow;
    const to = users[b] as UserRow;
    if (await findFriendship(db, from.id, to.id)) continue;
    const request = await requestFriendship(db, from.id, to.id);
    if (request.status === "pending") await acceptFriendship(db, request.id, to.id);
  }

  return { users, groupId: group.id, joinCode: SAMPLE_JOIN_CODE };
}

export function describeSeed(result: SeedResult): string {
  return [
    "",
    `Sample group ready. Join it in the app with the code ${result.joinCode}.`,
    `People in it (sign in as any of them by name): ${Object.keys(result.users).join(", ")}.`,
    "",
  ].join("\n");
}
