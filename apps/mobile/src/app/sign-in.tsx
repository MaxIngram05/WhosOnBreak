import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, ErrorText, Field, Muted, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { API_URL, describeError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/**
 * Development sign-in: type a name, get an account. The same name always
 * signs in to the same account, so two phones can be "Ada" and "Ben".
 *
 * Google sign-in replaces this once OAuth client ids exist; it needs a
 * development build, so it is not part of the Expo Go flow.
 */
export default function SignIn() {
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
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ marginTop: Spacing.six, marginBottom: Spacing.five }}>
          <ThemedText style={{ fontSize: 36, lineHeight: 42, fontWeight: 800 }}>
            Who&apos;s on break?
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={{ marginTop: Spacing.two }}>
            See when your friends and classmates are free at the same time as you.
          </ThemedText>
        </View>

        <Field
          label="Your name"
          placeholder="e.g. Ada"
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={submit}
        />
        <ErrorText>{error}</ErrorText>
        <Button title="Continue" onPress={submit} busy={busy} disabled={!name.trim()} />

        <View style={{ marginTop: Spacing.four }}>
          <Muted>
            Development sign-in. The same name always opens the same account. Server: {API_URL}
          </Muted>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
