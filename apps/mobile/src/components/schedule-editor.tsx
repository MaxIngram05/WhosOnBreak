/**
 * The drag-and-drop week editor.
 *
 *   tap an empty slot      add a one-hour block there
 *   tap a block            select it (edit its name and type below the grid)
 *   long-press and drag    move it -- across days and up or down, snapping to 15 minutes
 *   drag the handle        resize a selected block from its bottom edge
 *
 * Moving needs a long press so that an ordinary swipe still scrolls the grid;
 * the resize handle only appears on the selected block for the same reason.
 *
 * Gesture callbacks run on the JS thread (`runOnJS(true)`) and drive the drag
 * preview through shared values. Committing a move or resize goes through
 * `onChange`, so the editor holds no copy of the blocks of its own.
 */

import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import type { BlockKind } from '@whosonbreak/contracts';
import { MINUTES_PER_DAY } from '@whosonbreak/core';

import { ThemedText } from '@/components/themed-text';
import {
  GridFrame,
  SNAP_MINUTES,
  blockColor,
  byDay,
  gridStyles,
  layoutLanes,
  minutesToPixels,
  pixelsToMinutes,
  snap,
} from '@/components/week-grid';
import { useTheme } from '@/hooks/use-theme';
import { formatRange } from '@/lib/time';

export interface EditorBlock {
  /** Local identity for React and gestures; the server assigns real ids on save. */
  key: string;
  start: number;
  end: number;
  label: string | null;
  kind: BlockKind;
  weekIndex: number;
}

const MIN_DURATION = SNAP_MINUTES;
const DEFAULT_DURATION = 60;

let nextKey = 0;
export function newKey(): string {
  nextKey += 1;
  return `local-${Date.now()}-${nextKey}`;
}

/** Keeps a block inside one day and at least one snap step long. */
function clampToDay(day: number, startOfDay: number, duration: number) {
  const length = Math.max(MIN_DURATION, Math.min(duration, MINUTES_PER_DAY));
  const start = Math.max(0, Math.min(startOfDay, MINUTES_PER_DAY - length));
  return { start: day * MINUTES_PER_DAY + start, end: day * MINUTES_PER_DAY + start + length };
}

export function ScheduleEditor({
  blocks,
  weekIndex,
  days,
  selectedKey,
  onSelect,
  onChange,
}: {
  /** Every block in the schedule; only `weekIndex`'s are shown and edited. */
  blocks: EditorBlock[];
  weekIndex: number;
  days: number;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  onChange: (blocks: EditorBlock[]) => void;
}) {
  const [draggingDay, setDraggingDay] = useState<number | null>(null);
  const visible = blocks.filter((block) => block.weekIndex === weekIndex);
  const perDay = byDay(visible, days);

  const update = (key: string, change: (block: EditorBlock) => EditorBlock) => {
    onChange(blocks.map((block) => (block.key === key ? change(block) : block)));
  };

  const move = (key: string, dayDelta: number, minuteDelta: number) => {
    update(key, (block) => {
      const day = Math.floor(block.start / MINUTES_PER_DAY);
      const targetDay = Math.max(0, Math.min(days - 1, day + dayDelta));
      const startOfDay = snap((block.start % MINUTES_PER_DAY) + minuteDelta);
      return { ...block, ...clampToDay(targetDay, startOfDay, block.end - block.start) };
    });
  };

  const resize = (key: string, minuteDelta: number) => {
    update(key, (block) => {
      const day = Math.floor(block.start / MINUTES_PER_DAY);
      const duration = snap(block.end - block.start + minuteDelta);
      return { ...block, ...clampToDay(day, block.start % MINUTES_PER_DAY, duration) };
    });
  };

  const create = (day: number, y: number) => {
    // Centre a new hour on where the finger landed, on a half-hour line.
    const startOfDay = snap(pixelsToMinutes(y) - DEFAULT_DURATION / 2, 30);
    const block: EditorBlock = {
      key: newKey(),
      ...clampToDay(day, startOfDay, DEFAULT_DURATION),
      label: null,
      kind: 'class',
      weekIndex,
    };
    onChange([...blocks, block]);
    onSelect(block.key);
  };

  return (
    <GridFrame
      days={days}
      raisedDay={draggingDay}
      renderDay={(day, columnWidth) => {
        const lanes = layoutLanes(perDay[day] ?? []);
        return (
          <>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={(event) => {
                if (selectedKey) onSelect(null);
                else create(day, event.nativeEvent.locationY);
              }}
            />
            {(perDay[day] ?? []).map((block) => (
              <DraggableBlock
                key={block.key}
                block={block}
                columnWidth={columnWidth}
                lane={lanes.get(block.key)?.lane ?? 0}
                lanes={lanes.get(block.key)?.lanes ?? 1}
                selected={block.key === selectedKey}
                onSelect={() => onSelect(block.key)}
                onDragging={(active) => setDraggingDay(active ? day : null)}
                onMove={(dayDelta, minuteDelta) => move(block.key, dayDelta, minuteDelta)}
                onResize={(minuteDelta) => resize(block.key, minuteDelta)}
              />
            ))}
          </>
        );
      }}
    />
  );
}

function DraggableBlock({
  block,
  columnWidth,
  lane,
  lanes,
  selected,
  onSelect,
  onDragging,
  onMove,
  onResize,
}: {
  block: EditorBlock;
  columnWidth: number;
  lane: number;
  lanes: number;
  selected: boolean;
  onSelect: () => void;
  onDragging: (active: boolean) => void;
  onMove: (dayDelta: number, minuteDelta: number) => void;
  onResize: (minuteDelta: number) => void;
}) {
  const theme = useTheme();
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const extraHeight = useSharedValue(0);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<{ start: number; end: number } | null>(null);

  const top = minutesToPixels(block.start % MINUTES_PER_DAY);
  const height = minutesToPixels(block.end - block.start);
  // Worked out here, not inside the animated style: that runs on the UI thread,
  // where only worklets may be called, and minutesToPixels is not one. Calling
  // it there was the crash when a newly added block was selected.
  const minHeight = minutesToPixels(MIN_DURATION);
  const laneWidth = columnWidth / lanes;

  const dragMove = Gesture.Pan()
    .runOnJS(true)
    .activateAfterLongPress(220)
    .onStart(() => {
      setDragging(true);
      onDragging(true);
      onSelect();
    })
    .onUpdate((event) => {
      translateX.set(event.translationX);
      translateY.set(event.translationY);
      const minuteDelta = snap(pixelsToMinutes(event.translationY));
      setPreview({ start: block.start + minuteDelta, end: block.end + minuteDelta });
    })
    .onEnd((event) => {
      onMove(
        Math.round(event.translationX / columnWidth),
        snap(pixelsToMinutes(event.translationY)),
      );
    })
    .onFinalize(() => {
      translateX.set(0);
      translateY.set(0);
      setDragging(false);
      onDragging(false);
      setPreview(null);
    });

  const tap = Gesture.Tap()
    .runOnJS(true)
    .onEnd(() => onSelect());

  const dragResize = Gesture.Pan()
    .runOnJS(true)
    .onUpdate((event) => {
      extraHeight.set(event.translationY);
      const minuteDelta = snap(pixelsToMinutes(event.translationY));
      setPreview({ start: block.start, end: Math.max(block.start + MIN_DURATION, block.end + minuteDelta) });
    })
    .onEnd((event) => onResize(snap(pixelsToMinutes(event.translationY))))
    .onFinalize(() => {
      extraHeight.set(0);
      setPreview(null);
    });

  const animated = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.get() }, { translateY: translateY.get() }],
    height: Math.max(minHeight, height + extraHeight.get()),
  }));

  const shown = preview ?? block;

  return (
    <GestureDetector gesture={Gesture.Exclusive(dragMove, tap)}>
      <Animated.View
        style={[
          gridStyles.block,
          {
            top,
            left: lane * laneWidth + 1,
            width: laneWidth - 2,
            backgroundColor: blockColor(theme, block.kind),
            borderLeftColor: theme.blockBorder,
            borderWidth: selected || dragging ? 2 : 0,
            borderColor: theme.blockActive,
            zIndex: dragging ? 10 : selected ? 5 : 1,
            elevation: dragging ? 6 : 0,
          },
          animated,
        ]}>
        <ThemedText numberOfLines={2} style={gridStyles.blockText}>
          {block.label || 'Busy'}
        </ThemedText>
        <ThemedText numberOfLines={1} style={gridStyles.blockTime}>
          {formatRange(shown.start, shown.end)}
        </ThemedText>

        {selected && (
          <GestureDetector gesture={dragResize}>
            <View style={styles.handleArea} hitSlop={{ top: 8, bottom: 12, left: 8, right: 8 }}>
              <View style={[styles.handle, { backgroundColor: theme.blockBorder }]} />
            </View>
          </GestureDetector>
        )}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  handleArea: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handle: {
    width: 22,
    height: 4,
    borderRadius: 2,
  },
});
