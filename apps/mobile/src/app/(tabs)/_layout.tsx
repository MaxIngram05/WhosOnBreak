import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

type IconName = ComponentProps<typeof MaterialIcons>['name'];

function icon(name: IconName) {
  function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <MaterialIcons name={name} color={color} size={size} />;
  }
  return TabIcon;
}

export default function TabLayout() {
  const theme = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.accent,
        tabBarStyle: { backgroundColor: theme.background, borderTopColor: theme.border },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Today', tabBarIcon: icon('schedule') }} />
      <Tabs.Screen
        name="schedule"
        options={{ title: 'My week', tabBarIcon: icon('calendar-view-week') }}
      />
      <Tabs.Screen name="groups" options={{ title: 'Groups', tabBarIcon: icon('groups') }} />
      <Tabs.Screen name="friends" options={{ title: 'Friends', tabBarIcon: icon('people') }} />
      <Tabs.Screen name="profile" options={{ title: 'Me', tabBarIcon: icon('person') }} />
    </Tabs>
  );
}
