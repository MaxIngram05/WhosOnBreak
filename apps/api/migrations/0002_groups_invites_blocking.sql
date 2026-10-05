-- Group management, direct invites, and a development-only sign-in provider.

-- Names repeat ("Maths"), so a group can carry a free-text subtitle to tell
-- it apart: "Mr Smith, Room 4". Not unique and not an identifier -- the id is.
ALTER TABLE groups
    ADD COLUMN subtitle text CHECK (char_length(subtitle) <= 80);


-- Who may bring people in. The owner always may; anyone else only with this
-- flag, which the owner grants. It governs seeing the join code and sending
-- direct invites. Ownership itself never moves except when an owner deletes
-- their account.
ALTER TABLE group_members
    ADD COLUMN can_invite boolean NOT NULL DEFAULT false;

UPDATE group_members SET can_invite = true WHERE role = 'owner';


-- A direct invitation from a member who may invite, to one of their friends.
-- It is an offer, not a membership: the invitee accepts or declines. One
-- outstanding invite per person per group, however many members sent one.
CREATE TABLE group_invites (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id    uuid NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
    inviter_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    invitee_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (group_id, invitee_id),
    CONSTRAINT group_invites_not_self CHECK (inviter_id <> invitee_id)
);

-- "What am I invited to" is the only way this table is read by invitee.
CREATE INDEX group_invites_invitee_idx ON group_invites (invitee_id);


-- The nightly clean-up deletes by expiry; without this it scans the table.
CREATE INDEX refresh_tokens_expires_idx ON refresh_tokens (expires_at);


-- 'dev' identities come from the sign-in route that exists only when the
-- server runs with ENVIRONMENT=development. Production never creates them,
-- but the constraint has to allow them for a development database.
ALTER TABLE identities DROP CONSTRAINT identities_provider_check;
ALTER TABLE identities
    ADD CONSTRAINT identities_provider_check CHECK (provider IN ('google', 'dev'));


-- In a 'blocked' friendship row, requested_by is the person who blocked. Only
-- they can lift it. Nothing to change in the table; recorded here because the
-- column name no longer says it.
COMMENT ON COLUMN friendships.requested_by IS
    'Who sent the request; for status = blocked, who placed the block.';
