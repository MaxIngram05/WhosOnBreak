/**
 * My week: the drag-and-drop editor, plus the Week A / Week B controls.
 *
 * Two ways to add something: tap an empty slot on the grid, or press Add,
 * which puts an hour in the first free spot and opens it for editing. Either
 * way the block's panel sits *above* the grid, so the keyboard (which Android
 * no longer pushes the screen up for) covers the grid rather than the name.
 *
 * Edits stay local until Save, which sends the whole set in one request --
 * the server replaces the schedule's blocks in one transaction. The
 * `updatedAt` we loaded goes with it, so a save from a stale copy (edited on
 * another phone meanwhile) is refused rather than silently overwriting.
 */

import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { BlockKind, ScheduleWithBlocks } from '@whosonbreak/contracts';
import { MINUTES_PER_DAY } from '@whosonbreak/core';

import { ScheduleEditor, newKey, type EditorBlock } from '@/components/schedule-editor';
import { ThemedText } from '@/components/themed-text';
import { Button, ErrorText, Field, Loading, Muted, Segmented } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError, api, describeError } from '@/lib/api';
import { deviceTimeZone } from '@/lib/auth';
import { dayName, formatRange, formatTime, todayIndex } from '@/lib/time';
import { useLoad } from '@/lib/use-load';

const STEP = 15;
const MIN_LENGTH = 15;

function toEditorBlocks(schedule: ScheduleWithBlocks): EditorBlock[] {
  return schedule.blocks.map((block) => ({
    key: block.id,
    start: block.start,
    end: block.end,
    label: block.label,
    kind: block.kind,
    weekIndex: block.weekIndex,
  }));
}

/** The active schedule, creating an empty one the first time. */
async function loadActiveSchedule(): Promise<ScheduleWithBlocks> {
  const schedules = await api.schedules.list();
  const active = schedules.find((schedule) => schedule.isActive) ?? schedules[0];
  if (active) return api.schedules.blocks(active.id);
  return api.schedules.create({ name: 'My schedule', timeZone: deviceTimeZone() });
}

/**
 * Where Add puts a new hour: today (or Monday, if today is off the grid), at
 * the first whole hour from 09:00 that doesn't overlap anything already there.
 */
function firstFreeHour(blocks: EditorBlock[], weekIndex: number, days: number) {
  const today = todayIndex();
  const day = today < days ? today : 0;
  const dayStart = day * MINUTES_PER_DAY;
  const taken = blocks.filter(
    (block) =>
      block.weekIndex === weekIndex && block.start < dayStart + MINUTES_PER_DAY && block.end > dayStart,
  );
  for (let hour = 9; hour <= 21; hour++) {
    const start = dayStart + hour * 60;
    const end = start + 60;
    if (!taken.some((block) => block.start < end && block.end > start)) return { start, end };
  }
  return { start: dayStart + 9 * 60, end: dayStart + 10 * 60 };
}

export default function MySchedule() {
  const theme = useTheme();
  const [schedule, setSchedule] = useState<ScheduleWithBlocks | null>(null);
  const [blocks, setBlocks] = useState<EditorBlock[]>([]);
  const [dirty, setDirty] = useState(false);
  const [weekIndex, setWeekIndex] = useState(0);
  const [showWeekend, setShowWeekend] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  /** The block just made with Add, whose name field opens with the keyboard up. */
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const adopt = (loaded: ScheduleWithBlocks) => {
    setSchedule(loaded);
    setBlocks(toEditorBlocks(loaded));
    setDirty(false);
    setSelectedKey(null);
  };

  // Reloads on focus, but never over unsaved edits.
  const loaded = useLoad(async () => {
    if (dirty) return null;
    const result = await loadActiveSchedule();
    adopt(result);
    setWeekIndex(result.currentWeekIndex);
    return result;
  }, [dirty]);

  const change = (next: EditorBlock[]) => {
    setBlocks(next);
    setDirty(true);
  };

  const save = async () => {
    if (!schedule) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await api.schedules.replaceBlocks(
        schedule.id,
        blocks.map(({ start, end, label, kind, weekIndex: week }) => ({
          start,
          end,
          label: label?.trim() || null,
          kind,
          weekIndex: week,
        })),
        schedule.updatedAt,
      );
      adopt(saved);
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.code === 'conflict'
          ? 'This schedule was changed on another device. Discard your edits to load the latest.'
          : describeError(caught),
      );
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    setDirty(false); // Triggers a reload from the server.
  };

  const updateSettings = async (changes: { cycleWeeks?: number; currentWeekIndex?: number }) => {
    if (!schedule) return;
    setError(null);
    try {
      await api.schedules.update(schedule.id, changes);
      const fresh = await api.schedules.blocks(schedule.id);
      setSchedule(fresh);
      if (!dirty) setBlocks(toEditorBlocks(fresh));
      setWeekIndex(Math.min(weekIndex, fresh.cycleWeeks - 1));
    } catch (caught) {
      setError(describeError(caught));
    }
  };

  if (!schedule) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
        {loaded.error ? <ErrorText>{loaded.error}</ErrorText> : <Loading />}
      </SafeAreaView>
    );
  }

  const days = showWeekend ? 7 : 5;
  const selected = blocks.find((block) => block.key === selectedKey) ?? null;
  const twoWeeks = schedule.cycleWeeks === 2;
  const weekIsEmpty = !blocks.some((block) => block.weekIndex === weekIndex);

  const add = () => {
    const block: EditorBlock = {
      key: newKey(),
      ...firstFreeHour(blocks, weekIndex, days),
      label: null,
      kind: 'class',
      weekIndex,
    };
    change([...blocks, block]);
    setSelectedKey(block.key);
    setJustAdded(block.key);
    setShowSettings(false);
  };

  const editSelected = (edit: Partial<EditorBlock>) => {
    if (!selected) return;
    change(blocks.map((block) => (block.key === selected.key ? { ...block, ...edit } : block)));
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={styles.toolbar}>
        <View style={{ flex: 1 }}>
          <ThemedText style={styles.heading}>My week</ThemedText>
          <Muted>
            {dirty ? 'Unsaved changes' : 'Tap a slot or press Add · hold to drag'}
          </Muted>
        </View>
        <Pressable onPress={() => setShowSettings(!showSettings)} hitSlop={8}>
          <ThemedText type="smallBold" style={{ color: theme.accent }}>
            {showSettings ? 'Done' : 'Options'}
          </ThemedText>
        </Pressable>
        <Button small icon="add" title="Add" onPress={add} />
      </View>

      {showSettings ? (
        <View style={[styles.panel, { backgroundColor: theme.backgroundElement }]}>
          <View style={styles.switchRow}>
            <ThemedText style={{ flex: 1 }}>Two-week timetable (Week A / B)</ThemedText>
            <Switch
              value={twoWeeks}
              onValueChange={(value) => updateSettings({ cycleWeeks: value ? 2 : 1 })}
            />
          </View>
          {twoWeeks ? (
            <>
              <Muted>Which week is it this week?</Muted>
              <Segmented
                options={[
                  { value: 0, label: 'Week A' },
                  { value: 1, label: 'Week B' },
                ]}
                value={schedule.currentWeekIndex}
                onChange={(value) => updateSettings({ currentWeekIndex: value })}
              />
            </>
          ) : null}
          <View style={styles.switchRow}>
            <ThemedText style={{ flex: 1 }}>Show weekend</ThemedText>
            <Switch value={showWeekend} onValueChange={setShowWeekend} />
          </View>
          <Muted>Times are in {schedule.timeZone}.</Muted>
        </View>
      ) : null}

      {twoWeeks && !selected ? (
        <View style={{ paddingHorizontal: Spacing.three }}>
          <Segmented
            options={[
              { value: 0, label: schedule.currentWeekIndex === 0 ? 'Week A (this week)' : 'Week A' },
              { value: 1, label: schedule.currentWeekIndex === 1 ? 'Week B (this week)' : 'Week B' },
            ]}
            value={weekIndex}
            onChange={(value) => {
              setWeekIndex(value);
              setSelectedKey(null);
            }}
          />
        </View>
      ) : null}

      {selected ? (
        <BlockPanel
          key={selected.key}
          block={selected}
          days={days}
          autoFocus={selected.key === justAdded}
          onEdit={editSelected}
          onClose={() => {
            setSelectedKey(null);
            setJustAdded(null);
          }}
          onDuplicate={() => {
            const copy = { ...selected, key: newKey() };
            change([...blocks, copy]);
            setSelectedKey(copy.key);
          }}
          onDelete={() => {
            change(blocks.filter((block) => block.key !== selected.key));
            setSelectedKey(null);
          }}
        />
      ) : weekIsEmpty && !showSettings ? (
        <View style={[styles.hint, { backgroundColor: theme.backgroundSelected }]}>
          <ThemedText type="smallBold" style={{ color: theme.accent }}>
            Your week is empty
          </ThemedText>
          <Muted>
            Add each class, lab or shift once — it repeats every week. Press Add, or tap the grid
            where it starts.
          </Muted>
        </View>
      ) : null}

      <ErrorText>{error}</ErrorText>

      <View style={{ flex: 1 }}>
        <ScheduleEditor
          blocks={blocks}
          weekIndex={weekIndex}
          days={days}
          selectedKey={selectedKey}
          onSelect={(key) => {
            setSelectedKey(key);
            setJustAdded(null);
          }}
          onChange={change}
        />
      </View>

      {dirty ? (
        <View style={[styles.saveBar, { borderTopColor: theme.border }]}>
          <View style={{ flex: 1 }}>
            <Button
              kind="secondary"
              title="Discard"
              onPress={() =>
                Alert.alert('Discard changes?', 'Your unsaved edits will be lost.', [
                  { text: 'Keep editing', style: 'cancel' },
                  { text: 'Discard', style: 'destructive', onPress: discard },
                ])
              }
            />
          </View>
          <View style={{ flex: 2 }}>
            <Button title="Save" onPress={save} busy={saving} />
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

/** Everything about one block, by hand: day, times, name, type. */
function BlockPanel({
  block,
  days,
  autoFocus,
  onEdit,
  onClose,
  onDuplicate,
  onDelete,
}: {
  block: EditorBlock;
  days: number;
  autoFocus: boolean;
  onEdit: (edit: Partial<EditorBlock>) => void;
  onClose: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const theme = useTheme();
  const day = Math.floor(block.start / MINUTES_PER_DAY);
  const dayStart = day * MINUTES_PER_DAY;
  const startOfDay = block.start - dayStart;
  const endOfDay = block.end - dayStart;

  const setTimes = (start: number, end: number) => {
    if (start < 0 || end > MINUTES_PER_DAY || end - start < MIN_LENGTH) return;
    onEdit({ start: dayStart + start, end: dayStart + end });
  };

  const moveToDay = (target: number) => {
    const offset = (target - day) * MINUTES_PER_DAY;
    onEdit({ start: block.start + offset, end: block.end + offset });
  };

  return (
    <View style={[styles.panel, { backgroundColor: theme.backgroundElement, borderColor: theme.blockActive }]}>
      <View style={styles.switchRow}>
        <ThemedText type="smallBold" style={{ flex: 1 }}>
          {`${dayName(day)} ${formatRange(block.start, block.end)}`}
        </ThemedText>
        <Pressable onPress={onClose} hitSlop={8}>
          <ThemedText type="smallBold" style={{ color: theme.accent }}>
            Done
          </ThemedText>
        </Pressable>
      </View>

      <Field
        placeholder="Name, e.g. COMP 248"
        value={block.label ?? ''}
        autoFocus={autoFocus}
        returnKeyType="done"
        maxLength={80}
        onChangeText={(text) => onEdit({ label: text || null })}
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.days}>
          {Array.from({ length: Math.max(days, day + 1) }, (_, index) => {
            const active = index === day;
            return (
              <Pressable
                key={index}
                onPress={() => moveToDay(index)}
                style={[
                  styles.dayChip,
                  {
                    backgroundColor: active ? theme.ink : theme.background,
                    borderColor: active ? theme.ink : theme.border,
                  },
                ]}>
                <ThemedText type="smallBold" style={{ color: active ? theme.onInk : theme.text }}>
                  {dayName(index)}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View style={styles.times}>
        <Stepper
          label="Starts"
          value={startOfDay}
          onMinus={() => setTimes(startOfDay - STEP, endOfDay)}
          onPlus={() => setTimes(startOfDay + STEP, endOfDay)}
        />
        <Stepper
          label="Ends"
          value={endOfDay}
          onMinus={() => setTimes(startOfDay, endOfDay - STEP)}
          onPlus={() => setTimes(startOfDay, endOfDay + STEP)}
        />
      </View>

      <Segmented<BlockKind>
        options={[
          { value: 'class', label: 'Class' },
          { value: 'work', label: 'Work' },
          { value: 'other', label: 'Other' },
        ]}
        value={block.kind}
        onChange={(kind) => onEdit({ kind })}
      />

      <View style={styles.actions}>
        <Button small kind="secondary" icon="content-copy" title="Duplicate" onPress={onDuplicate} />
        <Button small kind="danger" icon="delete-outline" title="Delete" onPress={onDelete} />
      </View>
    </View>
  );
}

/** "Starts  [−] 10:15 [+]" -- a time nudged a quarter-hour at a time. */
function Stepper({
  label,
  value,
  onMinus,
  onPlus,
}: {
  label: string;
  value: number;
  onMinus: () => void;
  onPlus: () => void;
}) {
  const theme = useTheme();
  const text = value >= MINUTES_PER_DAY ? '24:00' : formatTime(value, false);
  const button = (symbol: string, onPress: () => void, hint: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={hint}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.stepButton,
        { backgroundColor: pressed ? theme.backgroundSelected : theme.background, borderColor: theme.border },
      ]}>
      <ThemedText style={{ fontWeight: 700, fontSize: 18, lineHeight: 22 }}>{symbol}</ThemedText>
    </Pressable>
  );
  return (
    <View style={{ flex: 1 }}>
      <Muted>{label}</Muted>
      <View style={styles.stepper}>
        {button('−', onMinus, `${label} 15 minutes earlier`)}
        <ThemedText style={{ fontWeight: 700, minWidth: 48, textAlign: 'center' }}>{text}</ThemedText>
        {button('+', onPlus, `${label} 15 minutes later`)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
  },
  heading: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: 700,
  },
  panel: {
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two,
    padding: Spacing.three,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  hint: {
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.two,
    padding: Spacing.three,
    borderRadius: 14,
    gap: 2,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.two,
  },
  days: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: Spacing.two,
  },
  dayChip: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  times: {
    flexDirection: 'row',
    gap: Spacing.three,
    marginBottom: Spacing.two,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  stepButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  saveBar: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
