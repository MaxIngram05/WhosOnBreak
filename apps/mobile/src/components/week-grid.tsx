/**
 * The week as a grid: days across, hours down, blocks positioned by their
 * minute-of-week. Shared by the drag-and-drop editor and the read-only
 * "someone's week" view, so both draw time identically.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { MINUTES_PER_DAY } from '@whosonbreak/core';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { dayName, formatRange, todayIndex } from '@/lib/time';

export const HOUR_HEIGHT = 52;
export const GUTTER = 40;
export const SNAP_MINUTES = 15;
/** Where the grid opens scrolled to: the start of a school day. */
const INITIAL_HOUR = 7;

export function snap(minutes: number, step = SNAP_MINUTES): number {
  return Math.round(minutes / step) * step;
}

export function minutesToPixels(minutes: number): number {
  return (minutes / 60) * HOUR_HEIGHT;
}

export function pixelsToMinutes(pixels: number): number {
  return (pixels / HOUR_HEIGHT) * 60;
}

export interface Positioned {
  key: string;
  start: number;
  end: number;
}

/**
 * Side-by-side lanes for overlapping blocks in one day, so two things at the
 * same time are both visible instead of one hiding the other.
 */
export function layoutLanes<T extends Positioned>(
  blocks: readonly T[],
): Map<string, { lane: number; lanes: number }> {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || b.end - a.end);
  const result = new Map<string, { lane: number; lanes: number }>();

  let cluster: { block: T; lane: number }[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((entry) => entry.lane + 1));
    for (const entry of cluster) result.set(entry.block.key, { lane: entry.lane, lanes });
    cluster = [];
  };

  for (const block of sorted) {
    if (block.start >= clusterEnd && cluster.length > 0) flush();
    const laneEnds: number[] = [];
    for (const entry of cluster) {
      laneEnds[entry.lane] = Math.max(laneEnds[entry.lane] ?? 0, entry.block.end);
    }
    let lane = laneEnds.findIndex((end) => end <= block.start);
    if (lane === -1) lane = laneEnds.length;
    cluster.push({ block, lane });
    clusterEnd = Math.max(clusterEnd, block.end);
  }
  flush();
  return result;
}

/** Splits blocks by the day they start on. */
export function byDay<T extends Positioned>(blocks: readonly T[], days: number): T[][] {
  const result: T[][] = Array.from({ length: days }, () => []);
  for (const block of blocks) {
    const day = Math.floor(block.start / MINUTES_PER_DAY);
    if (day < days) result[day]?.push(block);
  }
  return result;
}

/**
 * The frame: header row of days, hour gutter, and a scrolling body. `renderDay`
 * draws one day's column contents given its width.
 */
export function GridFrame({
  days,
  renderDay,
  highlightToday = true,
  raisedDay,
}: {
  days: number;
  renderDay: (day: number, columnWidth: number) => ReactNode;
  highlightToday?: boolean;
  /** Drawn above the other days, so a block dragged out of it stays visible. */
  raisedDay?: number | null;
}) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const scroll = useRef<ScrollView>(null);
  const columnWidth = width > 0 ? (width - GUTTER) / days : 0;
  const today = todayIndex();

  useEffect(() => {
    const id = setTimeout(() => {
      scroll.current?.scrollTo({ y: INITIAL_HOUR * HOUR_HEIGHT, animated: false });
    }, 0);
    return () => clearTimeout(id);
  }, []);

  return (
    <View style={{ flex: 1 }} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <View style={{ width: GUTTER }} />
        {Array.from({ length: days }, (_, day) => (
          <View key={day} style={{ width: columnWidth, alignItems: 'center' }}>
            <ThemedText
              type="smallBold"
              style={{
                color: highlightToday && day === today ? theme.accent : theme.textSecondary,
              }}>
              {dayName(day)}
            </ThemedText>
          </View>
        ))}
      </View>

      <ScrollView ref={scroll} style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', height: 24 * HOUR_HEIGHT }}>
          <View style={{ width: GUTTER }}>
            {Array.from({ length: 24 }, (_, hour) => (
              <ThemedText
                key={hour}
                type="small"
                themeColor="textSecondary"
                style={[styles.hourLabel, { top: hour * HOUR_HEIGHT - 8 }]}>
                {hour === 0 ? '' : `${String(hour).padStart(2, '0')}`}
              </ThemedText>
            ))}
          </View>

          {columnWidth > 0 &&
            Array.from({ length: days }, (_, day) => (
              <View
                key={day}
                style={{
                  width: columnWidth,
                  borderLeftWidth: StyleSheet.hairlineWidth,
                  borderLeftColor: theme.border,
                  zIndex: day === raisedDay ? 10 : 0,
                  elevation: day === raisedDay ? 10 : 0,
                }}>
                {Array.from({ length: 24 }, (_, hour) => (
                  <View
                    key={hour}
                    pointerEvents="none"
                    style={[
                      styles.hourLine,
                      { top: hour * HOUR_HEIGHT, borderTopColor: theme.border },
                    ]}
                  />
                ))}
                {renderDay(day, columnWidth)}
              </View>
            ))}
        </View>
      </ScrollView>
    </View>
  );
}

/** A block that cannot be moved: for looking at someone else's week. */
export function StaticBlock({
  start,
  end,
  label,
  detail,
  lane,
  lanes,
  columnWidth,
}: {
  start: number;
  end: number;
  label: string | null;
  detail?: string | null;
  lane: number;
  lanes: number;
  columnWidth: number;
}) {
  const theme = useTheme();
  const minuteOfDay = start % MINUTES_PER_DAY;
  const laneWidth = columnWidth / lanes;
  return (
    <View
      style={[
        styles.block,
        {
          top: minutesToPixels(minuteOfDay),
          height: Math.max(14, minutesToPixels(end - start)),
          left: lane * laneWidth + 1,
          width: laneWidth - 2,
          backgroundColor: theme.block,
          borderLeftColor: theme.blockBorder,
        },
      ]}>
      <ThemedText numberOfLines={2} style={styles.blockText}>
        {label ?? 'Busy'}
      </ThemedText>
      <ThemedText numberOfLines={1} style={[styles.blockTime, { color: theme.textSecondary }]}>
        {detail ? `${detail} · ` : ''}
        {formatRange(start, end)}
      </ThemedText>
    </View>
  );
}

export const gridStyles = StyleSheet.create({
  block: {
    position: 'absolute',
    borderRadius: 6,
    borderLeftWidth: 3,
    paddingHorizontal: 3,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  blockText: {
    fontSize: 11,
    lineHeight: 13,
    fontWeight: 600,
  },
  blockTime: {
    fontSize: 10,
    lineHeight: 12,
  },
});

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  hourLabel: {
    position: 'absolute',
    right: 6,
    fontSize: 11,
  },
  hourLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  ...gridStyles,
});
