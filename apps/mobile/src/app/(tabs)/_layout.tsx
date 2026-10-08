import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';

import type { IconName } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';

function icon(name: IconName) {
  function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <MaterialIcons name={name} color={color} size={size} />;
  }
  return TabIcon;
}

/** A black tab bar: the app's "black elements" against its quiet blue. */
export default function TabLayout() {
  const theme = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // Otherwise Android lifts the bar above the keyboard, over what you're typing.
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: theme.tabActive,
        tabBarInactiveTintColor: theme.tabInactive,
        tabBarStyle: {
          backgroundColor: theme.ink,
          borderTopWidth: 0,
          height: 64,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontWeight: 600, fontSize: 11 },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Today', tabBarIcon: icon('wb-sunny') }} />
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
