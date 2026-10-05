-- Initial schema.
--
-- Two decisions run through all of it:
--
-- 1. Times are integers on the minute-of-week axis that packages/core defines,
--    never timestamps. A class does not happen at an instant, it happens every
--    week, and storing it as a date would mean inventing and then maintaining
--    a row per occurrence forever. The zone lives on the schedule instead.
--
-- 2. Constraints that protect an invariant live here rather than only in the
--    application. The API is not going to be the last thing that ever writes
--    to this database.

CREATE TABLE users (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email              text NOT NULL,
    display_name       text NOT NULL,
    avatar_url         text,
    -- What friends see by default. 'busy_only' means they learn that the time
    -- is taken but not what it is, which is the right default for a schedule
    -- that might contain a doctor's appointment.
    default_visibility text NOT NULL DEFAULT 'busy_only'
                       CHECK (default_visibility IN ('busy_only', 'labels', 'full')),
    -- What you give someone to send you a friend request, typed or scanned from
    -- a QR code. Not a secret -- it only ever produces a request that still has
    -- to be accepted -- but rotatable, for when it has been posted somewhere.
    friend_code        text NOT NULL UNIQUE,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Lowercased rather than a citext column: same effect, no extension to be
-- unavailable on whichever Postgres this ends up hosted on.
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));


-- One row per external login. Keeping this out of `users` is what makes
-- "sign in with Apple as well" a new row rather than new columns, and lets one
-- person attach two providers to one account.
CREATE TABLE identities (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    provider         text NOT NULL CHECK (provider IN ('google')),
    provider_subject text NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (provider, provider_subject)
);

CREATE INDEX identities_user_idx ON identities (user_id);


-- Refresh tokens are stored hashed, so a database leak does not hand anyone a
-- working session. `family_id` ties each rotation to its ancestors: if a token
-- that was already exchanged comes back, the whole family is revoked, because
-- the only ways that happens are a stolen token or a bug, and both should end
-- the session.
CREATE TABLE refresh_tokens (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    family_id   uuid NOT NULL,
    token_hash  text NOT NULL UNIQUE,
    expires_at  timestamptz NOT NULL,
    revoked_at  timestamptz,
    used_at     timestamptz,
    user_agent  text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);


CREATE TABLE schedules (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name       text NOT NULL,
    -- IANA zone name. Blocks below are stored on this zone's local axis.
    time_zone  text NOT NULL,
    is_active  boolean NOT NULL DEFAULT true,
    -- How many weeks the timetable takes to repeat: 1 for most, 2 for a
    -- school running Week A / Week B. Blocks carry which week they belong to.
    cycle_weeks  smallint NOT NULL DEFAULT 1 CHECK (cycle_weeks IN (1, 2)),
    -- A Monday that was week 0 (Week A). Which week any other date falls in is
    -- counted from here. Users re-set it when their school restarts the
    -- rotation after a holiday, so it is a correction point, not a term date.
    cycle_anchor date,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT schedules_cycle_anchor CHECK (
        (cycle_weeks = 1 AND cycle_anchor IS NULL) OR
        (cycle_weeks > 1 AND cycle_anchor IS NOT NULL
                         AND extract(isodow FROM cycle_anchor) = 1)
    )
);

-- Old terms are kept rather than deleted, but exactly one schedule is the one
-- everybody else compares against. A partial unique index makes that the
-- database's problem instead of a race the application has to get right.
CREATE UNIQUE INDEX schedules_one_active_per_user
    ON schedules (user_id) WHERE is_active;

CREATE INDEX schedules_user_idx ON schedules (user_id);


CREATE TABLE blocks (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_id  uuid NOT NULL REFERENCES schedules (id) ON DELETE CASCADE,
    label        text,
    kind         text NOT NULL DEFAULT 'class'
                 CHECK (kind IN ('class', 'work', 'other')),
    -- Which week of the schedule's cycle this block repeats in. Always 0 for a
    -- one-week schedule. Kept below cycle_weeks by the application, which
    -- holds the schedule row locked whenever it writes either.
    week_index   smallint NOT NULL DEFAULT 0 CHECK (week_index >= 0),
    start_minute integer NOT NULL,
    end_minute   integer NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    -- 10080 is one week in minutes. A block entered as "Sunday 23:00 for two
    -- hours" is split by the application before it gets here, so every row
    -- stays inside a single week and comparison never has to think about wrap.
    CONSTRAINT blocks_within_week CHECK (
        start_minute >= 0 AND end_minute <= 10080 AND start_minute < end_minute
    )
);

CREATE INDEX blocks_schedule_start_idx ON blocks (schedule_id, week_index, start_minute);


-- Friendship is symmetric, so storing it twice would mean two rows that can
-- disagree. Forcing user_a < user_b gives each pair exactly one row, and the
-- unique index then makes a duplicate request impossible rather than merely
-- unlikely.
CREATE TABLE friendships (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_a       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    user_b       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'accepted', 'blocked')),
    requested_by uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT friendships_canonical_order CHECK (user_a < user_b),
    UNIQUE (user_a, user_b)
);

CREATE INDEX friendships_user_b_idx ON friendships (user_b);


CREATE TABLE groups (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    owner_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    -- Six characters, read aloud across a classroom, so the alphabet the
    -- application generates from excludes 0/O/1/I/L.
    join_code   text NOT NULL UNIQUE,
    archived_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX groups_owner_idx ON groups (owner_id);


CREATE TABLE group_members (
    group_id  uuid NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
    user_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role      text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
    joined_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, user_id)
);

-- "Which groups am I in" is the first query every session makes.
CREATE INDEX group_members_user_idx ON group_members (user_id);
