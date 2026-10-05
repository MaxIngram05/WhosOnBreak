/**
 * One group: who is in it, its shared breaks this week, and -- depending on
 * your role -- renaming, sharing the code, inviting friends, and deciding who
 * else may invite.
 */

import { useState } from 'react';
import { Alert, Switch, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { MAX_GROUP_MEMBERS, type BreaksResponse, type Friend, type GroupDetail } from '@whosonbreak/contracts';
import { MINUTES_PER_DAY } from '@whosonbreak/core';

import { ThemedText } from '@/components/themed-text';
import {
  Avatar,
  Button,
  Card,
  ErrorText,
  Field,
  Loading,
  Muted,
  Row,
  Screen,
  Section,
  Segmented,
  Title,
} from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api, describeError } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { dayName, formatDuration, formatRange } from '@/lib/time';
import { useLoad } from '@/lib/use-load';

export default function GroupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const [everyone, setEveryone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const group = useLoad(() => api.groups.get(id), [id]);
  const breaks = useLoad(
    () =>
      api.groups.breaks(id, {
        minParticipants: everyone ? Math.max(2, group.data?.memberCount ?? 2) : 2,
      }),
    [id, everyone, group.data?.memberCount],
  );
  const friends = useLoad(() => api.friends.list());

  const act = async (work: () => Promise<unknown>) => {
    setError(null);
    try {
      await work();
      await group.reload();
    } catch (caught) {
      setError(describeError(caught));
    }
  };

  if (!group.data) {
    return (
      <Screen>
        {group.error ? <ErrorText>{group.error}</ErrorText> : <Loading />}
      </Screen>
    );
  }

  const detail = group.data;
  const isOwner = detail.role === 'owner';
  const memberIds = new Set(detail.members.map((member) => member.user.id));
  const invitable = (friends.data ?? []).filter(
    (friend) => friend.status === 'accepted' && !memberIds.has(friend.user.id),
  );

  return (
    <Screen refreshing={group.loading} onRefresh={() => { void group.reload(); void breaks.reload(); }}>
      <Stack.Screen options={{ title: detail.name }} />
      <Title subtitle={detail.subtitle ?? undefined}>{detail.name}</Title>
      <Muted>{`${detail.memberCount} of ${MAX_GROUP_MEMBERS} members`}</Muted>
      <ErrorText>{error}</ErrorText>

      {isOwner ? <RenameCard detail={detail} onSaved={group.reload} /> : null}

      {detail.canInvite && detail.joinCode ? (
        <Section title="Invite with the code">
          <Card style={{ alignItems: 'center' }}>
            <ThemedText style={{ fontSize: 32, lineHeight: 40, fontWeight: 800, letterSpacing: 4 }}>
              {detail.joinCode}
            </ThemedText>
            <View style={{ backgroundColor: '#fff', padding: Spacing.two, marginVertical: Spacing.two }}>
              <QRCode value={`whosonbreak://join/${detail.joinCode}`} size={160} />
            </View>
            <Muted>Scan with the phone camera, or type the code in Groups.</Muted>
            {isOwner ? (
              <Button
                small
                kind="secondary"
                title="Change code"
                onPress={() =>
                  Alert.alert('Change the join code?', 'The old code will stop working.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Change', onPress: () => act(() => api.groups.rotateCode(id)) },
                  ])
                }
              />
            ) : null}
          </Card>
        </Section>
      ) : null}

      {detail.canInvite && invitable.length > 0 ? (
        <InviteFriends groupId={id} friends={invitable} />
      ) : null}

      <Section title="Members">
        {detail.members.map((member) => {
          const self = member.user.id === me.id;
          return (
            <Row
              key={member.user.id}
              onPress={() => router.push(`/person/${member.user.id}`)}
              right={
                isOwner && member.role !== 'owner' ? (
                  <View style={{ alignItems: 'flex-end' }}>
                    <Muted>Can invite</Muted>
                    <Switch
                      value={member.canInvite}
                      onValueChange={(value) =>
                        act(() => api.groups.setCanInvite(id, member.user.id, value))
                      }
                    />
                  </View>
                ) : undefined
              }>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Avatar name={member.user.displayName} />
                <View style={{ flexShrink: 1 }}>
                  <ThemedText>
                    {member.user.displayName}
                    {self ? ' (you)' : ''}
                  </ThemedText>
                  <Muted>
                    {[
                      member.role === 'owner' ? 'Owner' : member.canInvite ? 'Can invite' : null,
                      member.hasSchedule ? null : 'No schedule yet',
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'Member'}
                  </Muted>
                </View>
              </View>
            </Row>
          );
        })}
        <Muted>Tap someone to see their week.</Muted>
      </Section>

      <Section title="Shared breaks this week">
        <Segmented
          options={[
            { value: 'any', label: '2 or more free' },
            { value: 'all', label: 'Everyone free' },
          ]}
          value={everyone ? 'all' : 'any'}
          onChange={(value) => setEveryone(value === 'all')}
        />
        <BreakList breaks={breaks.data} />
        <ErrorText>{breaks.error}</ErrorText>
      </Section>

      <Section title="Manage">
        {isOwner ? (
          <>
            <Muted>
              As the owner you can&apos;t leave, but you can close the group for everyone.
            </Muted>
            <Button
              kind="danger"
              title="Close group"
              onPress={() =>
                Alert.alert('Close this group?', 'It disappears for everyone and the code stops working.', [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Close',
                    style: 'destructive',
                    onPress: async () => {
                      try {
                        await api.groups.close(id);
                        router.back();
                      } catch (caught) {
                        setError(describeError(caught));
                      }
                    },
                  },
                ])
              }
            />
          </>
        ) : (
          <Button
            kind="danger"
            title="Leave group"
            onPress={() =>
              Alert.alert('Leave this group?', undefined, [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Leave',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await api.groups.removeMember(id, me.id);
                      router.back();
                    } catch (caught) {
                      setError(describeError(caught));
                    }
                  },
                },
              ])
            }
          />
        )}
      </Section>
    </Screen>
  );
}

function RenameCard({ detail, onSaved }: { detail: GroupDetail; onSaved: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(detail.name);
  const [subtitle, setSubtitle] = useState(detail.subtitle ?? '');
  const [error, setError] = useState<string | null>(null);

  if (!editing) {
    return <Button small kind="secondary" title="Rename" onPress={() => setEditing(true)} />;
  }

  const save = async () => {
    try {
      await api.groups.update(detail.id, { name: name.trim(), subtitle: subtitle.trim() || null });
      setEditing(false);
      await onSaved();
    } catch (caught) {
      setError(describeError(caught));
    }
  };

  return (
    <Card>
      <Field label="Name" value={name} onChangeText={setName} maxLength={60} />
      <Field label="Detail (optional)" value={subtitle} onChangeText={setSubtitle} maxLength={80} />
      <ErrorText>{error}</ErrorText>
      <View style={{ flexDirection: 'row', gap: Spacing.two }}>
        <Button small title="Save" onPress={save} disabled={!name.trim()} />
        <Button small kind="secondary" title="Cancel" onPress={() => setEditing(false)} />
      </View>
    </Card>
  );
}

function InviteFriends({ groupId, friends }: { groupId: string; friends: Friend[] }) {
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  return (
    <Section title="Invite friends">
      {friends.map((friend) => (
        <Row
          key={friend.user.id}
          right={
            sent.has(friend.user.id) ? (
              <Muted>Invited</Muted>
            ) : (
              <Button
                small
                title="Invite"
                onPress={async () => {
                  try {
                    await api.groups.invite(groupId, friend.user.id);
                    setSent(new Set([...sent, friend.user.id]));
                  } catch (caught) {
                    setError(describeError(caught));
                  }
                }}
              />
            )
          }>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Avatar name={friend.user.displayName} />
            <ThemedText>{friend.user.displayName}</ThemedText>
          </View>
        </Row>
      ))}
      <ErrorText>{error}</ErrorText>
    </Section>
  );
}

function BreakList({ breaks }: { breaks: BreaksResponse | undefined }) {
  const theme = useTheme();
  if (!breaks) return <Loading />;
  if (breaks.segments.length === 0) return <Muted>No shared breaks this week.</Muted>;

  const days = new Map<number, BreaksResponse['segments']>();
  for (const segment of breaks.segments) {
    const day = Math.floor(segment.start / MINUTES_PER_DAY);
    days.set(day, [...(days.get(day) ?? []), segment]);
  }

  return (
    <>
      {[...days.entries()].map(([day, segments]) => (
        <View key={day} style={{ marginBottom: Spacing.three }}>
          <ThemedText type="smallBold" style={{ color: theme.accent }}>
            {dayName(day)}
          </ThemedText>
          {segments.map((segment) => (
            <Card key={segment.start}>
              <ThemedText type="smallBold">
                {formatRange(segment.start, segment.end)} · {formatDuration(segment.durationMinutes)}
              </ThemedText>
              <Muted>{segment.users.map((user) => user.displayName).join(', ')}</Muted>
            </Card>
          ))}
        </View>
      ))}
      {breaks.excluded.length > 0 ? (
        <Muted>{`Not counted (no schedule): ${breaks.excluded.map((u) => u.displayName).join(', ')}`}</Muted>
      ) : null}
    </>
  );
}
