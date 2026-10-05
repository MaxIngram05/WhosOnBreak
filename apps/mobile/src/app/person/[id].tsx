/**
 * Someone's week, on your clock, showing as much as they allow: just busy
 * times, plus names with `labels`, plus the kind of block with `full`.
 */

import { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ErrorText, Loading, Muted, Segmented } from '@/components/ui';
import { GridFrame, StaticBlock, byDay, layoutLanes } from '@/components/week-grid';
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

      <View style={{ padding: Spacing.three, paddingBottom: 0 }}>
        <Segmented
          options={[
            { value: 0, label: 'This week' },
            { value: 1, label: 'Next week' },
          ]}
          value={weekOffset}
          onChange={setWeekOffset}
        />
        <Segmented
          options={[
            { value: 'weekdays', label: 'Mon–Fri' },
            { value: 'all', label: 'All week' },
          ]}
          value={showWeekend ? 'all' : 'weekdays'}
          onChange={(value) => setShowWeekend(value === 'all')}
        />
        {view ? (
          <Muted>
            {[
              view.cycleWeeks === 2 ? (view.weekIndex === 0 ? 'Their Week A' : 'Their Week B') : null,
              `Times in ${view.timeZone}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Muted>
        ) : null}
        <ErrorText>{week.error}</ErrorText>
      </View>

      {!view ? (
        week.error ? null : <Loading />
      ) : !view.hasSchedule ? (
        <View style={{ padding: Spacing.three }}>
          <ThemedText>{view.user.displayName} hasn&apos;t added a schedule yet.</ThemedText>
        </View>
      ) : (
        <GridFrame
          days={days}
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
                lane={lanes.get(block.key)?.lane ?? 0}
                lanes={lanes.get(block.key)?.lanes ?? 1}
                columnWidth={columnWidth}
              />
            ));
          }}
        />
      )}
    </SafeAreaView>
  );
}
