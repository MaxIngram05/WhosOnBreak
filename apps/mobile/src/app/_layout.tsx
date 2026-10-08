import { useEffect } from 'react';
import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { Colors, Palette } from '@/constants/theme';
import { AuthProvider, useAuth } from '@/lib/auth';

SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { state } = useAuth();

  // Keep the splash up until we know whether there is a session, so the
  // sign-in screen never flashes for someone who is already signed in.
  useEffect(() => {
    if (state.status !== 'loading') void SplashScreen.hideAsync();
  }, [state.status]);

  if (state.status === 'loading') return null;
  const signedIn = state.status === 'signedIn';

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        // Pushed screens get a navy bar, the artwork's background colour.
        headerStyle: { backgroundColor: Palette.navy },
        headerTintColor: '#FFFFFF',
        headerTitleStyle: { fontWeight: 700 },
        contentStyle: { backgroundColor: Colors.light.background },
      }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="group/[id]" options={{ headerShown: true, title: 'Group' }} />
        <Stack.Screen name="person/[id]" options={{ headerShown: true, title: 'Week' }} />
        <Stack.Screen name="scan" options={{ presentation: 'modal', headerShown: true, title: 'Scan a friend code' }} />
        <Stack.Screen name="friend/[code]" options={{ headerShown: true, title: 'Add friend' }} />
        <Stack.Screen name="join/[code]" options={{ headerShown: true, title: 'Join group' }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
    </Stack>
  );
}

/** Navigation chrome in the app's palette rather than the platform default. */
const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: Palette.navy,
    background: Colors.light.background,
    card: Colors.light.backgroundElement,
    text: Colors.light.text,
    border: Colors.light.border,
  },
};

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={navigationTheme}>
        <AuthProvider>
          <RootNavigator />
        </AuthProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
