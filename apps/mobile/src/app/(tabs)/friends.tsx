import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import type { Friend } from '@whosonbreak/contracts';

import { ThemedText } from '@/components/themed-text';
import {
  Button,
  Card,
  EmptyState,
  ErrorText,
  Field,
  List,
  Muted,
  Notice,
  Person,
  Row,
  Screen,
  Section,
  Title,
} from '@/components/ui';
import { Palette, Spacing } from '@/constants/theme';
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
  const typedCode = code.replace(/[\s-]/g, '');

  const manage = (friend: Friend) =>
    Alert.alert(friend.user.displayName, undefined, [
      { text: 'See their week', onPress: () => router.push(`/person/${friend.user.id}`) },
      { text: 'Remove friend', onPress: () => act(() => api.friends.remove(friend.user.id)) },
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
      <Title subtitle="Share your code to connect">Friends</Title>

      <View style={styles.codeCard}>
        <ThemedText style={styles.codeLabel}>Your friend code</ThemedText>
        <ThemedText style={styles.code}>{displayCode(me.friendCode)}</ThemedText>
        {showQr ? (
          <View style={styles.qr}>
            <QRCode value={friendLink(me.friendCode)} size={180} color={Palette.navy} />
          </View>
        ) : null}
        <Button
          small
          kind="secondary"
          icon={showQr ? 'visibility-off' : 'qr-code-2'}
          title={showQr ? 'Hide QR code' : 'Show QR code'}
          onPress={() => setShowQr(!showQr)}
        />
      </View>

      <Section title="Add a friend">
        <Card>
          <Field
            placeholder="Their code, e.g. AB12-CD34"
            value={code}
            onChangeText={(text) => setCode(text.toUpperCase())}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={11}
          />
          <Button
            title="Send request"
            disabled={typedCode.length !== 8}
            onPress={() =>
              act(async () => {
                await api.friends.requestByCode(typedCode);
                setCode('');
              }, 'Request sent.')
            }
          />
          <Button kind="secondary" icon="qr-code-scanner" title="Scan a QR code" onPress={() => router.push('/scan')} />
          <Notice>{message}</Notice>
          <ErrorText>{error}</ErrorText>
        </Card>
      </Section>

      {incoming.length > 0 ? (
        <Section title="Requests for you">
          <List>
            {incoming.map((friend, index) => (
              <Row
                key={friend.id}
                last={index === incoming.length - 1}
                right={
                  <View style={{ flexDirection: 'row', gap: Spacing.two }}>
                    <Button small title="Accept" onPress={() => act(() => api.friends.accept(friend.id))} />
                    <Button small kind="secondary" title="Decline" onPress={() => act(() => api.friends.remove(friend.user.id))} />
                  </View>
                }>
                <Person id={friend.user.id} name={friend.user.displayName} />
              </Row>
            ))}
          </List>
        </Section>
      ) : null}

      <Section title={`Friends · ${accepted.length}`}>
        {accepted.length === 0 ? (
          <EmptyState icon="person-add" title="No friends yet">
            <Muted>Share your code, or scan theirs.</Muted>
          </EmptyState>
        ) : (
          <List>
            {accepted.map((friend, index) => (
              <Row key={friend.id} last={index === accepted.length - 1} onPress={() => manage(friend)}>
                <Person id={friend.user.id} name={friend.user.displayName} detail="Tap for options" />
              </Row>
            ))}
          </List>
        )}
      </Section>

      {outgoing.length > 0 ? (
        <Section title="Waiting for them">
          <List>
            {outgoing.map((friend, index) => (
              <Row
                key={friend.id}
                last={index === outgoing.length - 1}
                right={
                  <Button small kind="secondary" title="Cancel" onPress={() => act(() => api.friends.remove(friend.user.id))} />
                }>
                <Person id={friend.user.id} name={friend.user.displayName} detail="Request sent" />
              </Row>
            ))}
          </List>
        </Section>
      ) : null}

      {blocked.data && blocked.data.length > 0 ? (
        <Section title="Blocked">
          <List>
            {blocked.data.map((user, index) => (
              <Row
                key={user.id}
                last={index === blocked.data!.length - 1}
                right={<Button small kind="secondary" title="Unblock" onPress={() => act(() => api.friends.unblock(user.id))} />}>
                <Person id={user.id} name={user.displayName} />
              </Row>
            ))}
          </List>
        </Section>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  codeCard: {
    backgroundColor: Palette.navy,
    borderRadius: 22,
    padding: Spacing.four,
    alignItems: 'center',
    marginBottom: Spacing.four,
  },
  codeLabel: {
    color: Palette.periwinkle,
    fontWeight: 600,
  },
  code: {
    color: '#FFFFFF',
    fontSize: 34,
    lineHeight: 42,
    fontWeight: 800,
    letterSpacing: 3,
    marginVertical: Spacing.two,
  },
  qr: {
    backgroundColor: '#FFFFFF',
    padding: Spacing.two,
    borderRadius: 12,
    marginBottom: Spacing.three,
  },
});
