/**
 * Where a group QR or link lands: whosonbreak://join/ABC234. Asks first.
 */

import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { Button, ErrorText, Muted, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { api, describeError } from '@/lib/api';

export default function JoinFromLink() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const normalised = (code ?? '').toUpperCase();

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      const group = await api.groups.join(normalised);
      router.replace(`/group/${group.id}`);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <ThemedText style={{ fontSize: 28, lineHeight: 36, fontWeight: 800, marginBottom: Spacing.two }}>
        {normalised}
      </ThemedText>
      <Muted>Join the group with this code? Its members will see when you&apos;re free.</Muted>
      <ErrorText>{error}</ErrorText>
      <Button title="Join group" onPress={join} busy={busy} />
    </Screen>
  );
}
