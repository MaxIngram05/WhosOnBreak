import { useState } from 'react';
import { Alert, Share } from 'react-native';
import type { Visibility } from '@whosonbreak/contracts';

import {
  Button,
  Card,
  ErrorText,
  Field,
  Muted,
  Screen,
  Section,
  Segmented,
  Title,
} from '@/components/ui';
import { api, describeError } from '@/lib/api';
import { useAuth, useMe } from '@/lib/auth';
import { displayCode } from '@/lib/time';

const VISIBILITY_HELP: Record<Visibility, string> = {
  busy_only: "Others see when you're busy, but not what you're doing.",
  labels: 'Others also see the names of your blocks, like "Maths".',
  full: 'Others see names and whether each block is a class, work, or something else.',
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
      <Title subtitle={me.email}>Me</Title>

      <Section title="Name">
        <Card>
          <Field value={name} onChangeText={setName} maxLength={60} />
          <Button
            small
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
          onChange={(value) =>
            run(async () => setUser(await api.me.update({ defaultVisibility: value })))
          }
        />
        <Muted>{VISIBILITY_HELP[me.defaultVisibility]}</Muted>
      </Section>

      <Section title="Friend code">
        <Muted>{`Yours is ${displayCode(me.friendCode)}. Get a new one if the old one has been shared too widely; requests already sent are not affected.`}</Muted>
        <Button
          kind="secondary"
          title="Get a new friend code"
          onPress={() => run(async () => setUser(await api.me.rotateFriendCode()))}
        />
      </Section>

      <Section title="Your data">
        <Button
          kind="secondary"
          title="Export my data"
          onPress={() =>
            run(async () => {
              const data = await api.me.export();
              await Share.share({ title: 'WhosOnBreak data', message: JSON.stringify(data, null, 2) });
            })
          }
        />
        <Button kind="secondary" title="Sign out" onPress={() => run(signOut)} />
        <Button
          kind="danger"
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

      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}
