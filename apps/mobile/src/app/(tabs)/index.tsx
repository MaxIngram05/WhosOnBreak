/**
 * The home screen: who in this group is free right now, and when the next
 * shared breaks are today.
 */

import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { MINUTES_PER_DAY } from '@whosonbreak/core';
import type { BreaksResponse, GroupInvite, OnBreakNowResponse } from '@whosonbreak/contracts';

import { AddSchedulePrompt, useNeedsSchedule } from '@/components/add-schedule-prompt';
import { ThemedText } from '@/components/themed-text';
import {
  Button,
  Card,
  EmptyState,
  ErrorText,
  List,
  Loading,
  Muted,
  Person,
  Pill,
  Row,
  Screen,
  Section,
  Title,
} from '@/components/ui';
import { Palette, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api, describeError } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { formatDuration, formatRange, formatTime } from '@/lib/time';
import { useLoad } from '@/lib/use-load';

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function Today() {
  const me = useMe();
  const theme = useTheme();
  const [groupId, setGroupId] = useState<string | null>(null);

  const needsSchedule = useNeedsSchedule();
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

  if (groups.loading && !groups.data) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }

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
  const othersFree = now ? now.onBreak.filter((person) => person.id !== me.id) : [];

  return (
    <Screen refreshing={status.loading} onRefresh={refresh}>
      <Title subtitle={greeting()}>{me.displayName.split(' ')[0]}</Title>

      {needsSchedule ? <AddSchedulePrompt /> : null}

      <Invites invites={invites.data ?? []} onAnswered={refresh} />

      {groups.data && groups.data.length === 0 ? (
        <EmptyState icon="groups" title="You're not in any groups yet">
          <Muted>Join your class with its code, or start a group and share yours.</Muted>
          <View style={{ marginTop: Spacing.three, alignSelf: 'stretch' }}>
            <Button title="Find a group" icon="search" onPress={() => router.navigate('/groups')} />
          </View>
        </EmptyState>
      ) : null}

      {groups.data && groups.data.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginBottom: Spacing.three, marginHorizontal: -Spacing.three - 4 }}
          contentContainerStyle={{ paddingHorizontal: Spacing.three + 4, gap: Spacing.two }}>
          {groups.data.map((group) => {
            const active = group.id === selected;
            return (
              <Pressable
                key={group.id}
                onPress={() => setGroupId(group.id)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: active ? theme.ink : theme.backgroundElement,
                    borderColor: active ? theme.ink : theme.border,
                  },
                ]}>
                <ThemedText type="smallBold" style={{ color: active ? theme.onInk : theme.text }}>
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
          <View style={styles.hero}>
            <ThemedText style={styles.heroNumber}>{othersFree.length}</ThemedText>
            <View style={{ flex: 1 }}>
              <ThemedText style={styles.heroTitle}>
                {othersFree.length === 1 ? 'person is on break' : 'people are on break'}
              </ThemedText>
              <ThemedText style={styles.heroSub}>
                {`right now · ${formatTime(now.nowMinuteOfWeek % MINUTES_PER_DAY, false)}`}
              </ThemedText>
            </View>
          </View>

          <Section title="Free now">
            {now.onBreak.length === 0 ? (
              <Card>
                <Muted>Nobody is free right now.</Muted>
              </Card>
            ) : (
              <List>
                {now.onBreak.map((person, index) => (
                  <Row
                    key={person.id}
                    last={index === now.onBreak.length - 1}
                    onPress={() => router.push(`/person/${person.id}`)}
                    right={<Pill tone="free">{`${formatDuration(person.freeForMinutes)} left`}</Pill>}>
                    <Person id={person.id} name={person.displayName} you={person.id === me.id} />
                  </Row>
                ))}
              </List>
            )}
          </Section>

          <Section title="Shared breaks later today">
            {upcoming.length === 0 ? (
              <Card>
                <Muted>No more shared breaks today.</Muted>
              </Card>
            ) : (
              upcoming.map((segment) => (
                <Card key={`${segment.start}-${segment.end}`}>
                  <View style={styles.breakHeader}>
                    <ThemedText style={{ fontWeight: 700 }}>
                      {formatRange(segment.start, segment.end)}
                    </ThemedText>
                    <Pill>{formatDuration(segment.durationMinutes)}</Pill>
                  </View>
                  <Muted>{segment.users.map((user) => user.displayName).join(', ')}</Muted>
                </Card>
              ))
            )}
          </Section>

          {now.busy.length > 0 ? (
            <Section title="Busy">
              <List>
                {now.busy.map((person, index) => (
                  <Row
                    key={person.id}
                    last={index === now.busy.length - 1}
                    onPress={() => router.push(`/person/${person.id}`)}
                    right={
                      <Pill tone="busy">
                        {person.until !== null
                          ? `free ${formatTime(person.until % MINUTES_PER_DAY, false)}`
                          : 'done today'}
                      </Pill>
                    }>
                    <Person
                      id={person.id}
                      name={person.displayName}
                      you={person.id === me.id}
                      detail={person.label ?? undefined}
                    />
                  </Row>
                ))}
              </List>
            </Section>
          ) : null}

          {now.unknown.length > 0 ? (
            <Section title="Haven't added a schedule">
              <Card>
                <Muted>{now.unknown.map((user) => user.displayName).join(', ')}</Muted>
              </Card>
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
          <ThemedText style={{ fontWeight: 700 }}>{invite.group.name}</ThemedText>
          <Muted>
            {`${invite.inviter.displayName} invited you${invite.group.subtitle ? ` · ${invite.group.subtitle}` : ''}`}
          </Muted>
          <View style={{ flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.three }}>
            <Button small title="Join" onPress={() => answer(invite, true)} />
            <Button small kind="secondary" title="No thanks" onPress={() => answer(invite, false)} />
          </View>
        </Card>
      ))}
      <ErrorText>{error}</ErrorText>
    </Section>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    backgroundColor: Palette.navy,
    borderRadius: 22,
    padding: Spacing.four,
    marginBottom: Spacing.four,
  },
  heroNumber: {
    color: Palette.orange,
    fontSize: 52,
    lineHeight: 58,
    fontWeight: 800,
  },
  heroTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    lineHeight: 24,
    fontWeight: 700,
  },
  heroSub: {
    color: Palette.periwinkle,
  },
  breakHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
});
