import { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button, ErrorText, Field, Muted } from '@/components/ui';
import { Palette, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { API_URL, describeError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/**
 * Development sign-in: type a name, get an account. The same name always
 * signs in to the same account, so two phones can be "Ada" and "Ben" -- and
 * the sample group's members can be signed in as by name too.
 *
 * Google sign-in replaces this once OAuth client ids exist; it needs a
 * development build, so it is not part of the Expo Go flow.
 */
export default function SignIn() {
  const theme = useTheme();
  const { signInDev } = useAuth();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await signInDev(name.trim());
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Palette.navy }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <View style={styles.hero}>
            <Image source={require('@/assets/images/icon.png')} style={styles.logo} />
            <ThemedText style={styles.heading}>Who&apos;s on break?</ThemedText>
            <ThemedText style={styles.tagline}>
              See when your friends and classmates are free at the same time as you.
            </ThemedText>
          </View>

          <View style={[styles.sheet, { backgroundColor: theme.backgroundElement }]}>
            <Field
              label="Your name"
              placeholder="e.g. Max"
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="go"
              onSubmitEditing={submit}
            />
            <ErrorText>{error}</ErrorText>
            <Button title="Get started" onPress={submit} busy={busy} disabled={!name.trim()} />
            <View style={{ marginTop: Spacing.three }}>
              <Muted>
                Test sign-in: the same name always opens the same account. Server: {API_URL}
              </Muted>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.five,
  },
  logo: {
    width: 150,
    height: 150,
    borderRadius: 36,
    marginBottom: Spacing.four,
  },
  heading: {
    color: '#FFFFFF',
    fontSize: 34,
    lineHeight: 40,
    fontWeight: 800,
    textAlign: 'center',
  },
  tagline: {
    color: Palette.periwinkle,
    textAlign: 'center',
    marginTop: Spacing.two,
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: Spacing.four,
    paddingBottom: Spacing.five,
  },
});
