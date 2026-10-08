/**
 * Someone's week, on your clock, any week you step to. It shows as much as
 * they allow: busy times only; plus names with "labels"; plus the type of
 * each block (and its colour) with "full".
 */

import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { Avatar, EmptyState, ErrorText, Loading, Muted, Pill, Segmented, WeekPicker } from '@/components/ui';
import { GridFrame, StaticBlock, blockColor, byDay, layoutLanes } from '@/components/week-grid';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { weekParam } from '@/lib/time';
import { useLoad } from '@/lib/use-load';

const KIND_NAMES = { class: 'Class', work: 'Work', other: 'Other' } as const;

export default function PersonWeek() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const [weekOffset, setWeekOffset] = useState(0);
  const [showWeekend, setShowWeekend] = useState(false);

  const week = useLoad(() => api.people.week(id, weekParam(weekOffset)), [id, weekOffset]);
  const view = week.data;
  const days = showWeekend ? 7 : 5;

  const blocks = (view?.blocks ?? []).map((block, index) => ({ ...block, key: String(index) }));
  const perDay = byDay(blocks, days);

  return (
    <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen options={{ title: view?.user.displayName ?? 'Week' }} />

      <View style={styles.top}>
        {view ? (
          <View style={styles.who}>
            <Avatar seed={view.user.id} size={44} />
            <View style={{ flex: 1 }}>
              <ThemedText style={{ fontSize: 20, lineHeight: 26, fontWeight: 800 }}>
                {view.user.displayName}
              </ThemedText>
              <Muted>{`Times shown in ${view.timeZone}`}</Muted>
            </View>
            {view.cycleWeeks === 2 ? (
              <Pill tone="dark">{view.weekIndex === 0 ? 'Week A' : 'Week B'}</Pill>
            ) : null}
          </View>
        ) : null}

        <WeekPicker offset={weekOffset} onChange={setWeekOffset} />
        <Segmented
          options={[
            { value: 'weekdays', label: 'Mon – Fri' },
            { value: 'all', label: 'Whole week' },
          ]}
          value={showWeekend ? 'all' : 'weekdays'}
          onChange={(value) => setShowWeekend(value === 'all')}
        />
        <ErrorText>{week.error}</ErrorText>
      </View>

      {!view ? (
        week.error ? null : <Loading />
      ) : !view.hasSchedule ? (
        <View style={{ padding: Spacing.three }}>
          <EmptyState icon="event-note" title={`${view.user.displayName} hasn't added a schedule yet`} />
        </View>
      ) : (
        <View style={[styles.grid, { borderColor: theme.border }]}>
          <GridFrame
            days={days}
            weekOffset={weekOffset}
            highlightToday={weekOffset === 0}
            renderDay={(day, columnWidth) => {
              const lanes = layoutLanes(perDay[day] ?? []);
              return (perDay[day] ?? []).map((block) => (
                <StaticBlock
                  key={block.key}
                  start={block.start}
                  end={block.end}
                  label={block.label}
                  detail={block.kind ? KIND_NAMES[block.kind] : null}
                  color={blockColor(theme, block.kind)}
                  lane={lanes.get(block.key)?.lane ?? 0}
                  lanes={lanes.get(block.key)?.lanes ?? 1}
                  columnWidth={columnWidth}
                />
              ));
            }}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  top: {
    padding: Spacing.three,
    paddingBottom: 0,
  },
  who: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.three,
  },
  grid: {
    flex: 1,
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.three,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
