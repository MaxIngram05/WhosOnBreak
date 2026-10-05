import { useState } from 'react';
import { Alert, View } from 'react-native';
import { router } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import type { Friend } from '@whosonbreak/contracts';

import { ThemedText } from '@/components/themed-text';
import {
  Avatar,
  Button,
  Card,
  ErrorText,
  Field,
  Muted,
  Row,
  Screen,
  Section,
  Title,
} from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { api, describeError } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { displayCode, friendLink } from '@/lib/time';
import { useLoad } from '@/lib/use-load';

export default function Friends() {
  const me = useMe();
  const friends = useLoad(() => api.friends.list());
  const blocked = useLoad(() => api.friends.blocked());
  const [code, setCode] = useState('');
  const [showQr, setShowQr] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (work: () => Promise<unknown>, done?: string) => {
    setError(null);
    setMessage(null);
    try {
      await work();
      if (done) setMessage(done);
      await Promise.all([friends.reload(), blocked.reload()]);
    } catch (caught) {
      setError(describeError(caught));
    }
  };

  const all = friends.data ?? [];
  const incoming = all.filter((f) => f.status === 'pending' && f.requestedBy !== me.id);
  const outgoing = all.filter((f) => f.status === 'pending' && f.requestedBy === me.id);
  const accepted = all.filter((f) => f.status === 'accepted');

  const manage = (friend: Friend) =>
    Alert.alert(friend.user.displayName, undefined, [
      { text: 'See their week', onPress: () => router.push(`/person/${friend.user.id}`) },
      {
        text: 'Remove friend',
        onPress: () => act(() => api.friends.remove(friend.user.id)),
      },
      {
        text: 'Block',
        style: 'destructive',
        onPress: () =>
          Alert.alert(
            `Block ${friend.user.displayName}?`,
            "They won't be able to send you requests or see your week. Shared groups still show you both.",
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Block', style: 'destructive', onPress: () => act(() => api.friends.block(friend.user.id)) },
            ],
          ),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);

  return (
    <Screen
      refreshing={friends.loading}
      onRefresh={() => {
        void friends.reload();
        void blocked.reload();
      }}>
      <Title>Friends</Title>

      <Section title="Your friend code">
        <Card style={{ alignItems: 'center' }}>
          <ThemedText style={{ fontSize: 30, lineHeight: 38, fontWeight: 800, letterSpacing: 3 }}>
            {displayCode(me.friendCode)}
          </ThemedText>
          {showQr ? (
            <View style={{ backgroundColor: '#fff', padding: Spacing.two, marginVertical: Spacing.two }}>
              <QRCode value={friendLink(me.friendCode)} size={180} />
            </View>
          ) : null}
          <Button small kind="secondary" title={showQr ? 'Hide QR code' : 'Show QR code'} onPress={() => setShowQr(!showQr)} />
          <Muted>Anyone with this code can send you a request. You choose who to accept.</Muted>
        </Card>
      </Section>

      <Section title="Add a friend">
        <Card>
          <Field
            placeholder="Their code, e.g. AB12-CD34"
            value={code}
            onChangeText={(text) => setCode(text.toUpperCase())}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={9}
          />
          <Button
            title="Send request"
            disabled={code.replace(/-/g, '').length !== 8}
            onPress={() => act(async () => { await api.friends.requestByCode(code); setCode(''); }, 'Request sent.')}
          />
          <Button kind="secondary" title="Scan a QR code" onPress={() => router.push('/scan')} />
        </Card>
        {message ? <Muted>{message}</Muted> : null}
        <ErrorText>{error}</ErrorText>
      </Section>

      {incoming.length > 0 ? (
        <Section title="Requests for you">
          {incoming.map((friend) => (
            <Row
              key={friend.id}
              right={
                <View style={{ flexDirection: 'row', gap: Spacing.two }}>
                  <Button small title="Accept" onPress={() => act(() => api.friends.accept(friend.id))} />
                  <Button small kind="secondary" title="Decline" onPress={() => act(() => api.friends.remove(friend.user.id))} />
                </View>
              }>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Avatar name={friend.user.displayName} />
                <ThemedText>{friend.user.displayName}</ThemedText>
              </View>
            </Row>
          ))}
        </Section>
      ) : null}

      <Section title={`Friends · ${accepted.length}`}>
        {accepted.length === 0 ? <Muted>No friends yet. Share your code to get started.</Muted> : null}
        {accepted.map((friend) => (
          <Row key={friend.id} onPress={() => manage(friend)} right={<Muted>•••</Muted>}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Avatar name={friend.user.displayName} />
              <ThemedText>{friend.user.displayName}</ThemedText>
            </View>
          </Row>
        ))}
      </Section>

      {outgoing.length > 0 ? (
        <Section title="Waiting for them">
          {outgoing.map((friend) => (
            <Row
              key={friend.id}
              right={<Button small kind="secondary" title="Cancel" onPress={() => act(() => api.friends.remove(friend.user.id))} />}>
              <ThemedText>{friend.user.displayName}</ThemedText>
            </Row>
          ))}
        </Section>
      ) : null}

      {blocked.data && blocked.data.length > 0 ? (
        <Section title="Blocked">
          {blocked.data.map((user) => (
            <Row
              key={user.id}
              right={<Button small kind="secondary" title="Unblock" onPress={() => act(() => api.friends.unblock(user.id))} />}>
              <ThemedText>{user.displayName}</ThemedText>
            </Row>
          ))}
        </Section>
      ) : null}
    </Screen>
  );
}
