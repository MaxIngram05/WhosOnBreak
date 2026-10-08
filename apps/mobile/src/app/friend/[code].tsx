/**
 * Where a scanned or tapped friend link lands: whosonbreak://friend/ABCD1234.
 * Asks before sending, so opening a link never sends a request by itself.
 */

import { useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { Button, ErrorText, Muted, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { api, describeError } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { displayCode } from '@/lib/time';

export default function AddFriendFromLink() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const me = useMe();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const normalised = (code ?? '').replace(/-/g, '').toUpperCase();
  const isMine = normalised === me.friendCode;

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const friend = await api.friends.requestByCode(normalised);
      setSent(
        friend.status === 'accepted'
          ? `You and ${friend.user.displayName} are now friends.`
          : `Request sent to ${friend.user.displayName}.`,
      );
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={[]}>
      <ThemedText style={{ fontSize: 28, lineHeight: 36, fontWeight: 800, marginBottom: Spacing.two }}>
        {displayCode(normalised)}
      </ThemedText>
      {isMine ? (
        <Muted>That&apos;s your own code.</Muted>
      ) : sent ? (
        <>
          <ThemedText style={{ marginBottom: Spacing.three }}>{sent}</ThemedText>
          <Button title="Done" onPress={() => router.replace('/friends')} />
        </>
      ) : (
        <>
          <Muted>Send a friend request to whoever has this code?</Muted>
          <ErrorText>{error}</ErrorText>
          <Button title="Send request" onPress={send} busy={busy} />
        </>
      )}
    </Screen>
  );
}
