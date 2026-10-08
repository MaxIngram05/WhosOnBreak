/**
 * The nudge to put in a timetable. Without one, nobody can see when you're
 * free, so it shows wherever that matters: Today, and a group's breaks.
 */

import { View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui';
import { Palette, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { useLoad } from '@/lib/use-load';

/** How many blocks my active schedule has; 0 when I have no schedule at all. */
async function myBlockCount(): Promise<number> {
  const schedules = await api.schedules.list();
  const active = schedules.find((schedule) => schedule.isActive) ?? schedules[0];
  if (!active) return 0;
  return (await api.schedules.blocks(active.id)).blocks.length;
}

/** True once we know my timetable is empty. Reloads on focus, like other loads. */
export function useNeedsSchedule(): boolean {
  const count = useLoad(myBlockCount);
  return count.data === 0;
}

export function AddSchedulePrompt({ message }: { message?: string }) {
  return (
    <View
      style={{
        backgroundColor: Palette.navy,
        borderRadius: 22,
        padding: Spacing.four,
        marginBottom: Spacing.four,
        gap: Spacing.two,
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
        <MaterialIcons name="edit-calendar" size={22} color={Palette.orange} />
        <ThemedText style={{ color: '#FFFFFF', fontSize: 18, lineHeight: 24, fontWeight: 700 }}>
          Add your timetable
        </ThemedText>
      </View>
      <ThemedText style={{ color: Palette.periwinkle }}>
        {message ??
          "Nobody can see when you're free until you add your classes and shifts. It takes a couple of minutes."}
      </ThemedText>
      <View style={{ marginTop: Spacing.two }}>
        <Button
          kind="secondary"
          icon="add"
          title="Add my classes"
          onPress={() => router.navigate('/schedule')}
        />
      </View>
    </View>
  );
}
