/**
 * One group, in three views:
 *
 *   Breaks   shared free time, week by week, as a calendar or a list
 *   People   members (tap one to browse their week) and inviting friends
 *   Manage   rename, the join code, leaving or closing
 */

import { useState } from 'react';
import { Alert, StyleSheet, Switch, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import {
  MAX_GROUP_MEMBERS,
  type BreakSegment,
  type BreaksResponse,
  type Friend,
  type GroupDetail,
} from '@whosonbreak/contracts';
import { MINUTES_PER_DAY } from '@whosonbreak/core';

import { AddSchedulePrompt } from '@/components/add-schedule-prompt';
import { ThemedText } from '@/components/themed-text';
import {
  Button,
  Card,
  EmptyState,
  ErrorText,
  Field,
  List,
  Loading,
  Muted,
  Person,
  Pill,
  Row,
  Screen,
  Section,
  Segmented,
  WeekPicker,
} from '@/components/ui';
import { GridFrame, StaticBlock, byDay, layoutLanes } from '@/components/week-grid';
import { Palette, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api, describeError } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { dayDate, formatDuration, formatRange, weekParam } from '@/lib/time';
import { useLoad } from '@/lib/use-load';

type View_ = 'breaks' | 'people' | 'manage';

export default function GroupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [view, setView] = useState<View_>('breaks');
  const group = useLoad(() => api.groups.get(id), [id]);

  if (!group.data) {
    return (
      <Screen edges={[]}>
        {group.error ? <ErrorText>{group.error}</ErrorText> : <Loading />}
      </Screen>
    );
  }

  const detail = group.data;

  return (
    <Screen edges={[]} refreshing={group.loading} onRefresh={group.reload}>
      <Stack.Screen options={{ title: detail.name }} />

      <View style={styles.header}>
        <ThemedText style={styles.name}>{detail.name}</ThemedText>
        {detail.subtitle ? <Muted>{detail.subtitle}</Muted> : null}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: Spacing.two }}>
          <Pill>{`${detail.memberCount}/${MAX_GROUP_MEMBERS} people`}</Pill>
          {detail.role === 'owner' ? <Pill tone="dark">You own this</Pill> : null}
          {detail.role !== 'owner' && detail.canInvite ? <Pill tone="free">You can invite</Pill> : null}
        </View>
      </View>

      <Segmented<View_>
        options={[
          { value: 'breaks', label: 'Breaks' },
          { value: 'people', label: 'People' },
          { value: 'manage', label: 'Manage' },
        ]}
        value={view}
        onChange={setView}
      />

      {view === 'breaks' ? <BreaksView groupId={id} memberCount={detail.memberCount} /> : null}
      {view === 'people' ? <PeopleView detail={detail} onChanged={group.reload} /> : null}
      {view === 'manage' ? <ManageView detail={detail} onChanged={group.reload} /> : null}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Breaks
// ---------------------------------------------------------------------------

function BreaksView({ groupId, memberCount }: { groupId: string; memberCount: number }) {
  const me = useMe();
  const [weekOffset, setWeekOffset] = useState(0);
  const [everyone, setEveryone] = useState(false);
  const [layout, setLayout] = useState<'calendar' | 'list'>('calendar');

  const breaks = useLoad(
    () =>
      api.groups.breaks(groupId, {
        week: weekParam(weekOffset),
        minParticipants: everyone ? Math.max(2, memberCount) : 2,
      }),
    [groupId, weekOffset, everyone, memberCount],
  );

  const excluded = breaks.data?.excluded ?? [];
  const meExcluded = excluded.some((user) => user.id === me.id);
  const othersExcluded = excluded.filter((user) => user.id !== me.id);

  return (
    <>
      {meExcluded ? (
        <AddSchedulePrompt message="You're not counted in this group's breaks yet. Add your classes and shifts so the group can see when you're free." />
      ) : null}
      <WeekPicker offset={weekOffset} onChange={setWeekOffset} />
      <Segmented
        options={[
          { value: 'any', label: 'Two or more free' },
          { value: 'all', label: 'Everyone free' },
        ]}
        value={everyone ? 'all' : 'any'}
        onChange={(value) => setEveryone(value === 'all')}
      />
      <Segmented
        options={[
          { value: 'calendar', label: 'Calendar' },
          { value: 'list', label: 'List' },
        ]}
        value={layout}
        onChange={setLayout}
      />

      <ErrorText>{breaks.error}</ErrorText>
      {!breaks.data ? (
        <Loading />
      ) : breaks.data.segments.length === 0 ? (
        <EmptyState icon="event-busy" title="No shared breaks this week">
          <Muted>
            {everyone
              ? 'There is no time when everyone is free. Try "Two or more free".'
              : 'Nobody has free time that overlaps with anyone else.'}
          </Muted>
        </EmptyState>
      ) : layout === 'calendar' ? (
        <BreakCalendar breaks={breaks.data} weekOffset={weekOffset} />
      ) : (
        <BreakList breaks={breaks.data} weekOffset={weekOffset} />
      )}

      {othersExcluded.length > 0 ? (
        <Muted>
          {`Not counted, no schedule yet: ${othersExcluded.map((u) => u.displayName).join(', ')}`}
        </Muted>
      ) : null}
    </>
  );
}

function BreakCalendar({ breaks, weekOffset }: { breaks: BreaksResponse; weekOffset: number }) {
  const theme = useTheme();
  const [chosen, setChosen] = useState<BreakSegment | null>(null);
  const segments = breaks.segments.map((segment) => ({ ...segment, key: String(segment.start) }));
  const perDay = byDay(segments, 5);
  const weekend = breaks.segments.filter((s) => Math.floor(s.start / MINUTES_PER_DAY) >= 5);

  return (
    <>
      <View style={[styles.calendar, { borderColor: theme.border }]}>
        <GridFrame
          days={5}
          weekOffset={weekOffset}
          highlightToday={weekOffset === 0}
          renderDay={(day, columnWidth) => {
            const lanes = layoutLanes(perDay[day] ?? []);
            return (perDay[day] ?? []).map((segment) => (
              <StaticBlock
                key={segment.key}
                start={segment.start}
                end={segment.end}
                label={`${segment.users.length} free`}
                lane={lanes.get(segment.key)?.lane ?? 0}
                lanes={lanes.get(segment.key)?.lanes ?? 1}
                columnWidth={columnWidth}
                color={theme.breakFill}
                selected={chosen?.start === segment.start}
                onPress={() => setChosen(segment)}
              />
            ));
          }}
        />
      </View>
      {chosen ? (
        <Card>
          <View style={styles.breakHeader}>
            <ThemedText style={{ fontWeight: 700 }}>
              {`${dayDate(weekOffset, Math.floor(chosen.start / MINUTES_PER_DAY))} · ${formatRange(chosen.start, chosen.end)}`}
            </ThemedText>
            <Pill>{formatDuration(chosen.durationMinutes)}</Pill>
          </View>
          <Muted>{chosen.users.map((user) => user.displayName).join(', ')}</Muted>
        </Card>
      ) : (
        <Muted>Tap a break to see who is free.</Muted>
      )}
      {weekend.length > 0 ? <Muted>{`Plus ${weekend.length} at the weekend, shown in List.`}</Muted> : null}
    </>
  );
}

function BreakList({ breaks, weekOffset }: { breaks: BreaksResponse; weekOffset: number }) {
  const theme = useTheme();
  const days = new Map<number, BreakSegment[]>();
  for (const segment of breaks.segments) {
    const day = Math.floor(segment.start / MINUTES_PER_DAY);
    days.set(day, [...(days.get(day) ?? []), segment]);
  }

  return (
    <>
      {[...days.entries()].map(([day, segments]) => (
        <View key={day} style={{ marginBottom: Spacing.three }}>
          <ThemedText style={{ fontWeight: 700, color: theme.accent, marginBottom: Spacing.two }}>
            {dayDate(weekOffset, day)}
          </ThemedText>
          {segments.map((segment) => (
            <Card key={segment.start}>
              <View style={styles.breakHeader}>
                <ThemedText style={{ fontWeight: 700 }}>{formatRange(segment.start, segment.end)}</ThemedText>
                <Pill>{formatDuration(segment.durationMinutes)}</Pill>
              </View>
              <Muted>{segment.users.map((user) => user.displayName).join(', ')}</Muted>
            </Card>
          ))}
        </View>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

function PeopleView({ detail, onChanged }: { detail: GroupDetail; onChanged: () => Promise<void> }) {
  const me = useMe();
  const isOwner = detail.role === 'owner';
  const friends = useLoad(() => api.friends.list());
  const [error, setError] = useState<string | null>(null);

  const memberIds = new Set(detail.members.map((member) => member.user.id));
  const invitable = (friends.data ?? []).filter(
    (friend) => friend.status === 'accepted' && !memberIds.has(friend.user.id),
  );

  const act = async (work: () => Promise<unknown>) => {
    setError(null);
    try {
      await work();
      await onChanged();
    } catch (caught) {
      setError(describeError(caught));
    }
  };

  return (
    <>
      <Section title="Members">
        <List>
          {detail.members.map((member, index) => (
            <Row
              key={member.user.id}
              last={index === detail.members.length - 1}
              onPress={() => router.push(`/person/${member.user.id}`)}
              right={
                isOwner && member.role !== 'owner' ? (
                  <View style={{ alignItems: 'center' }}>
                    <Switch
                      value={member.canInvite}
                      trackColor={{ true: Palette.indigo, false: '#C9CEE6' }}
                      thumbColor="#FFFFFF"
                      onValueChange={(value) =>
                        act(() => api.groups.setCanInvite(detail.id, member.user.id, value))
                      }
                    />
                    <Muted>can invite</Muted>
                  </View>
                ) : undefined
              }>
              <Person
                id={member.user.id}
                name={member.user.displayName}
                you={member.user.id === me.id}
                detail={
                  [
                    member.role === 'owner' ? 'Owner' : member.canInvite ? 'Can invite' : null,
                    member.hasSchedule ? null : 'No schedule yet',
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'Tap to see their week'
                }
              />
            </Row>
          ))}
        </List>
        <ErrorText>{error}</ErrorText>
      </Section>

      {detail.canInvite ? <InviteFriends groupId={detail.id} friends={invitable} /> : null}
    </>
  );
}

function InviteFriends({ groupId, friends }: { groupId: string; friends: Friend[] }) {
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  return (
    <Section title="Invite friends">
      {friends.length === 0 ? (
        <Card>
          <Muted>All your friends are already here, or you haven&apos;t added any yet.</Muted>
        </Card>
      ) : (
        <List>
          {friends.map((friend, index) => (
            <Row
              key={friend.user.id}
              last={index === friends.length - 1}
              right={
                sent.has(friend.user.id) ? (
                  <Pill tone="free">Invited</Pill>
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
              <Person id={friend.user.id} name={friend.user.displayName} />
            </Row>
          ))}
        </List>
      )}
      <ErrorText>{error}</ErrorText>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Manage
// ---------------------------------------------------------------------------

function ManageView({ detail, onChanged }: { detail: GroupDetail; onChanged: () => Promise<void> }) {
  const me = useMe();
  const isOwner = detail.role === 'owner';
  const [error, setError] = useState<string | null>(null);

  const act = async (work: () => Promise<unknown>) => {
    setError(null);
    try {
      await work();
      await onChanged();
    } catch (caught) {
      setError(describeError(caught));
    }
  };

  const confirm = (title: string, message: string, action: string, work: () => Promise<unknown>) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: action,
        style: 'destructive',
        onPress: async () => {
          try {
            await work();
            router.back();
          } catch (caught) {
            setError(describeError(caught));
          }
        },
      },
    ]);

  return (
    <>
      {isOwner ? <RenameCard detail={detail} onSaved={onChanged} /> : null}

      {detail.canInvite && detail.joinCode ? (
        <Section title="Join code">
          <Card style={{ alignItems: 'center' }}>
            <ThemedText style={styles.code}>{detail.joinCode}</ThemedText>
            <View style={styles.qr}>
              <QRCode value={`whosonbreak://join/${detail.joinCode}`} size={170} color={Palette.navy} />
            </View>
            <Muted>Scan it in the app, or type the code in Groups.</Muted>
            {isOwner ? (
              <View style={{ marginTop: Spacing.three }}>
                <Button
                  small
                  kind="secondary"
                  icon="refresh"
                  title="Change code"
                  onPress={() =>
                    Alert.alert('Change the join code?', 'The old code will stop working.', [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Change', onPress: () => act(() => api.groups.rotateCode(detail.id)) },
                    ])
                  }
                />
              </View>
            ) : null}
          </Card>
        </Section>
      ) : (
        <Card>
          <Muted>Only the owner and people they allow can share this group&apos;s code.</Muted>
        </Card>
      )}

      <Section title={isOwner ? 'Close group' : 'Leave group'}>
        {isOwner ? (
          <>
            <Muted>As the owner you can&apos;t leave, but you can close the group for everyone.</Muted>
            <Button
              kind="danger"
              title="Close group"
              onPress={() =>
                confirm(
                  'Close this group?',
                  'It disappears for everyone and the code stops working.',
                  'Close',
                  () => api.groups.close(detail.id),
                )
              }
            />
          </>
        ) : (
          <Button
            kind="danger"
            title="Leave group"
            onPress={() =>
              confirm('Leave this group?', 'You can rejoin with the code.', 'Leave', () =>
                api.groups.removeMember(detail.id, me.id),
              )
            }
          />
        )}
      </Section>
      <ErrorText>{error}</ErrorText>
    </>
  );
}

function RenameCard({ detail, onSaved }: { detail: GroupDetail; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(detail.name);
  const [subtitle, setSubtitle] = useState(detail.subtitle ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const changed = name.trim() !== detail.name || subtitle.trim() !== (detail.subtitle ?? '');

  const save = async () => {
    setError(null);
    try {
      await api.groups.update(detail.id, { name: name.trim(), subtitle: subtitle.trim() || null });
      setSaved(true);
      await onSaved();
    } catch (caught) {
      setError(describeError(caught));
    }
  };

  return (
    <Section title="Name">
      <Card>
        <Field label="Name" value={name} onChangeText={(t) => { setName(t); setSaved(false); }} maxLength={60} />
        <Field
          label="Detail (optional)"
          placeholder="e.g. Section D, Mon/Wed"
          value={subtitle}
          onChangeText={(t) => { setSubtitle(t); setSaved(false); }}
          maxLength={80}
        />
        <ErrorText>{error}</ErrorText>
        <Button title={saved && !changed ? 'Saved' : 'Save'} onPress={save} disabled={!name.trim() || !changed} />
      </Card>
    </Section>
  );
}

const styles = StyleSheet.create({
  header: {
    marginBottom: Spacing.three,
  },
  name: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: 800,
  },
  calendar: {
    height: 460,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: Spacing.three,
  },
  breakHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  code: {
    fontSize: 34,
    lineHeight: 42,
    fontWeight: 800,
    letterSpacing: 6,
  },
  qr: {
    backgroundColor: '#FFFFFF',
    padding: Spacing.two,
    marginVertical: Spacing.three,
  },
});
