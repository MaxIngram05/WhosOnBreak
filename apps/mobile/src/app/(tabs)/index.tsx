/**
 * The home screen: who in this group is free right now, and when the next
 * shared breaks are today.
 */

import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { MINUTES_PER_DAY } from '@whosonbreak/core';
import type { BreaksResponse, GroupInvite, OnBreakNowResponse } from '@whosonbreak/contracts';

import { ThemedText } from '@/components/themed-text';
import {
  Avatar,
  Button,
  Card,
  ErrorText,
  Loading,
  Muted,
  Row,
  Screen,
  Section,
  Title,
} from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api, describeError } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { formatDuration, formatRange, formatTime } from '@/lib/time';
import { useLoad } from '@/lib/use-load';

export default function Today() {
  const me = useMe();
  const theme = useTheme();
  const [groupId, setGroupId] = useState<string | null>(null);

  const groups = useLoad(() => api.groups.list());
  const invites = useLoad(() => api.invites.list());
  const selected = groupId ?? groups.data?.[0]?.id ?? null;

  const status = useLoad<{ now: OnBreakNowResponse; breaks: BreaksResponse } | null>(async () => {
    if (!selected) return null;
    const [now, breaks] = await Promise.all([api.groups.now(selected), api.groups.breaks(selected)]);
    return { now, breaks };
  }, [selected]);

  const refresh = () => {
    void groups.reload();
    void invites.reload();
    void status.reload();
  };

  if (groups.loading && !groups.data) return <Screen><Loading /></Screen>;

  const now = status.data?.now;
  const today = now ? Math.floor(now.nowMinuteOfWeek / MINUTES_PER_DAY) : 0;
  const upcoming =
    status.data && now
      ? status.data.breaks.segments.filter(
          (segment) =>
            Math.floor(segment.start / MINUTES_PER_DAY) === today &&
            segment.end > now.nowMinuteOfWeek,
        )
      : [];

  return (
    <Screen refreshing={status.loading} onRefresh={refresh}>
      <Title subtitle={now ? `It's ${formatTime(now.nowMinuteOfWeek % MINUTES_PER_DAY, false)}` : undefined}>
        Hi, {me.displayName.split(' ')[0]}
      </Title>

      <Invites invites={invites.data ?? []} onAnswered={refresh} />

      {groups.data && groups.data.length === 0 ? (
        <Card>
          <ThemedText type="smallBold">You&apos;re not in any groups yet</ThemedText>
          <Muted>Join your class with its code, or start a group and share yours.</Muted>
          <Button title="Go to Groups" onPress={() => router.navigate('/groups')} />
        </Card>
      ) : null}

      {groups.data && groups.data.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: Spacing.three }}>
          {groups.data.map((group) => {
            const active = group.id === selected;
            return (
              <Pressable
                key={group.id}
                onPress={() => setGroupId(group.id)}
                style={{
                  paddingHorizontal: Spacing.three,
                  paddingVertical: Spacing.two,
                  borderRadius: 20,
                  marginRight: Spacing.two,
                  backgroundColor: active ? theme.accent : theme.backgroundElement,
                }}>
                <ThemedText type="smallBold" style={{ color: active ? theme.onAccent : theme.text }}>
                  {group.name}
                </ThemedText>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      <ErrorText>{status.error}</ErrorText>

      {now ? (
        <>
          <Section title={`On break now · ${now.onBreak.length}`}>
            {now.onBreak.length === 0 ? <Muted>Nobody is free right now.</Muted> : null}
            {now.onBreak.map((person) => (
              <Row
                key={person.id}
                onPress={() => router.push(`/person/${person.id}`)}
                right={
                  <ThemedText type="smallBold" style={{ color: theme.free }}>
                    {formatDuration(person.freeForMinutes)} left
                  </ThemedText>
                }>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Avatar name={person.displayName} />
                  <ThemedText>{person.id === me.id ? `${person.displayName} (you)` : person.displayName}</ThemedText>
                </View>
              </Row>
            ))}
          </Section>

          <Section title="Shared breaks later today">
            {upcoming.length === 0 ? <Muted>No more shared breaks today.</Muted> : null}
            {upcoming.map((segment) => (
              <Card key={`${segment.start}-${segment.end}`}>
                <ThemedText type="smallBold">
                  {formatRange(segment.start, segment.end)} · {formatDuration(segment.durationMinutes)}
                </ThemedText>
                <Muted>{segment.users.map((user) => user.displayName).join(', ')}</Muted>
              </Card>
            ))}
          </Section>

          <Section title={`Busy · ${now.busy.length}`}>
            {now.busy.map((person) => (
              <Row
                key={person.id}
                onPress={() => router.push(`/person/${person.id}`)}
                right={
                  <Muted>
                    {person.until !== null
                      ? `free at ${formatTime(person.until % MINUTES_PER_DAY, false)}`
                      : 'done for today'}
                  </Muted>
                }>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Avatar name={person.displayName} />
                  <View>
                    <ThemedText>{person.displayName}</ThemedText>
                    {person.label ? <Muted>{person.label}</Muted> : null}
                  </View>
                </View>
              </Row>
            ))}
          </Section>

          {now.unknown.length > 0 ? (
            <Section title="Haven't added a schedule">
              <Muted>{now.unknown.map((user) => user.displayName).join(', ')}</Muted>
            </Section>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

function Invites({ invites, onAnswered }: { invites: GroupInvite[]; onAnswered: () => void }) {
  const [error, setError] = useState<string | null>(null);
  if (invites.length === 0) return null;

  const answer = async (invite: GroupInvite, accept: boolean) => {
    try {
      if (accept) await api.invites.accept(invite.id);
      else await api.invites.decline(invite.id);
      onAnswered();
    } catch (caught) {
      setError(describeError(caught));
    }
  };

  return (
    <Section title="Invites">
      {invites.map((invite) => (
        <Card key={invite.id}>
          <ThemedText type="smallBold">
            {invite.inviter.displayName} invited you to {invite.group.name}
          </ThemedText>
          {invite.group.subtitle ? <Muted>{invite.group.subtitle}</Muted> : null}
          <View style={{ flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.two }}>
            <Button small title="Join" onPress={() => answer(invite, true)} />
            <Button small kind="secondary" title="Decline" onPress={() => answer(invite, false)} />
          </View>
        </Card>
      ))}
      <ErrorText>{error}</ErrorText>
    </Section>
  );
}
