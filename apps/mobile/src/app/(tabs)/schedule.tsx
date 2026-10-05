/**
 * My week: the drag-and-drop editor, plus the Week A / Week B controls.
 *
 * Edits stay local until Save, which sends the whole set in one request --
 * the server replaces the schedule's blocks in one transaction. The
 * `updatedAt` we loaded goes with it, so a save from a stale copy (edited on
 * another phone meanwhile) is refused rather than silently overwriting.
 */

import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, View } from 'react-native';
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
import { formatRange } from '@/lib/time';
import { useLoad } from '@/lib/use-load';

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

export default function MySchedule() {
  const theme = useTheme();
  const [schedule, setSchedule] = useState<ScheduleWithBlocks | null>(null);
  const [blocks, setBlocks] = useState<EditorBlock[]>([]);
  const [dirty, setDirty] = useState(false);
  const [weekIndex, setWeekIndex] = useState(0);
  const [showWeekend, setShowWeekend] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
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
          label,
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

  const selected = blocks.find((block) => block.key === selectedKey) ?? null;
  const twoWeeks = schedule.cycleWeeks === 2;

  const editSelected = (change: Partial<EditorBlock>) => {
    if (!selected) return;
    setBlocks(blocks.map((block) => (block.key === selected.key ? { ...block, ...change } : block)));
    setDirty(true);
  };

  const nudge = (startDelta: number, endDelta: number) => {
    if (!selected) return;
    const day = Math.floor(selected.start / MINUTES_PER_DAY) * MINUTES_PER_DAY;
    const start = Math.max(day, selected.start + startDelta);
    const end = Math.min(day + MINUTES_PER_DAY, selected.end + endDelta);
    if (end - start >= 15) editSelected({ start, end });
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={styles.toolbar}>
        <View style={{ flex: 1 }}>
          <ThemedText style={styles.heading}>My week</ThemedText>
          <Muted>
            {dirty ? 'Unsaved changes' : 'Tap to add · hold and drag to move'}
          </Muted>
        </View>
        <Pressable onPress={() => setShowSettings(!showSettings)} hitSlop={8}>
          <ThemedText type="smallBold" style={{ color: theme.accent }}>
            {showSettings ? 'Done' : 'Options'}
          </ThemedText>
        </Pressable>
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

      {twoWeeks ? (
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

      <View style={{ flex: 1 }}>
        <ScheduleEditor
          blocks={blocks}
          weekIndex={weekIndex}
          days={showWeekend ? 7 : 5}
          selectedKey={selectedKey}
          onSelect={setSelectedKey}
          onChange={change}
        />
      </View>

      {selected ? (
        <View style={[styles.panel, { backgroundColor: theme.backgroundElement }]}>
          <View style={styles.switchRow}>
            <ThemedText type="smallBold" style={{ flex: 1 }}>
              {formatRange(selected.start, selected.end)}
            </ThemedText>
            <Pressable onPress={() => setSelectedKey(null)} hitSlop={8}>
              <ThemedText type="smallBold" style={{ color: theme.accent }}>
                Close
              </ThemedText>
            </Pressable>
          </View>
          <Field
            placeholder="Name, e.g. Maths"
            value={selected.label ?? ''}
            onChangeText={(text) => editSelected({ label: text || null })}
          />
          <Segmented<BlockKind>
            options={[
              { value: 'class', label: 'Class' },
              { value: 'work', label: 'Work' },
              { value: 'other', label: 'Other' },
            ]}
            value={selected.kind}
            onChange={(kind) => editSelected({ kind })}
          />
          <View style={styles.nudges}>
            <Button small kind="secondary" title="Start −15" onPress={() => nudge(-15, 0)} />
            <Button small kind="secondary" title="Start +15" onPress={() => nudge(15, 0)} />
            <Button small kind="secondary" title="End −15" onPress={() => nudge(0, -15)} />
            <Button small kind="secondary" title="End +15" onPress={() => nudge(0, 15)} />
          </View>
          <View style={styles.nudges}>
            <Button
              small
              kind="secondary"
              title="Duplicate"
              onPress={() => {
                const copy = { ...selected, key: newKey() };
                change([...blocks, copy]);
                setSelectedKey(copy.key);
              }}
            />
            <Button
              small
              kind="danger"
              title="Delete"
              onPress={() => {
                change(blocks.filter((block) => block.key !== selected.key));
                setSelectedKey(null);
              }}
            />
          </View>
        </View>
      ) : null}

      <ErrorText>{error}</ErrorText>

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

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
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
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.two,
  },
  nudges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  saveBar: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
