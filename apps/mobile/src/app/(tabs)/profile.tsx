import { useState } from 'react';
import { Alert, Share, View } from 'react-native';
import type { Visibility } from '@whosonbreak/contracts';

import { ThemedText } from '@/components/themed-text';
import {
  Avatar,
  Button,
  Card,
  ErrorText,
  Field,
  Muted,
  Screen,
  Section,
  Segmented,
} from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { api, describeError } from '@/lib/api';
import { useAuth, useMe } from '@/lib/auth';
import { displayCode } from '@/lib/time';

const VISIBILITY_HELP: Record<Visibility, string> = {
  busy_only: "Others see when you're busy, but not what you're doing.",
  labels: 'Others also see the names of your blocks, like "Maths".',
  full: 'Others see names, and whether each block is a class, work or something else.',
};

export default function Profile() {
  const me = useMe();
  const { setUser, signOut, forget } = useAuth();
  const [name, setName] = useState(me.displayName);
  const [error, setError] = useState<string | null>(null);

  const run = async (work: () => Promise<void>) => {
    setError(null);
    try {
      await work();
    } catch (caught) {
      setError(describeError(caught));
    }
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.four }}>
        <Avatar seed={me.id} size={64} />
        <View style={{ flex: 1 }}>
          <ThemedText style={{ fontSize: 26, lineHeight: 32, fontWeight: 800 }}>{me.displayName}</ThemedText>
          <Muted>{`Friend code ${displayCode(me.friendCode)}`}</Muted>
        </View>
      </View>

      <ErrorText>{error}</ErrorText>

      <Section title="Your name">
        <Card>
          <Field value={name} onChangeText={setName} maxLength={60} />
          <Button
            title="Save name"
            disabled={!name.trim() || name.trim() === me.displayName}
            onPress={() => run(async () => setUser(await api.me.update({ displayName: name.trim() })))}
          />
        </Card>
      </Section>

      <Section title="What others can see">
        <Segmented<Visibility>
          options={[
            { value: 'busy_only', label: 'Busy only' },
            { value: 'labels', label: 'Names' },
            { value: 'full', label: 'Full' },
          ]}
          value={me.defaultVisibility}
          onChange={(value) => run(async () => setUser(await api.me.update({ defaultVisibility: value })))}
        />
        <Card>
          <Muted>{VISIBILITY_HELP[me.defaultVisibility]}</Muted>
        </Card>
      </Section>

      <Section title="Friend code">
        <Card>
          <Muted>
            Get a new code if yours has been shared too widely. Requests already sent are not affected.
          </Muted>
          <View style={{ marginTop: Spacing.three }}>
            <Button
              kind="secondary"
              icon="refresh"
              title="Get a new friend code"
              onPress={() => run(async () => setUser(await api.me.rotateFriendCode()))}
            />
          </View>
        </Card>
      </Section>

      <Section title="Account">
        <Button
          kind="secondary"
          icon="download"
          title="Export my data"
          onPress={() =>
            run(async () => {
              const data = await api.me.export();
              await Share.share({ title: 'WhosOnBreak data', message: JSON.stringify(data, null, 2) });
            })
          }
        />
        <Button kind="secondary" icon="logout" title="Sign out" onPress={() => run(signOut)} />
        <Button
          kind="danger"
          icon="delete-outline"
          title="Delete my account"
          onPress={() =>
            Alert.alert(
              'Delete your account?',
              "Your schedules, friends and memberships are erased. Groups you own pass to their longest-standing member. This can't be undone.",
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: () =>
                    run(async () => {
                      await api.me.delete();
                      await forget();
                    }),
                },
              ],
            )
          }
        />
      </Section>
    </Screen>
  );
}
