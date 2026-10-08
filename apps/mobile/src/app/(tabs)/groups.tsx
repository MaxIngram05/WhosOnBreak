import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { MAX_GROUP_MEMBERS } from '@whosonbreak/contracts';

import { ThemedText } from '@/components/themed-text';
import {
  Button,
  Card,
  EmptyState,
  ErrorText,
  Field,
  List,
  Loading,
  Muted,
  Pill,
  Row,
  Screen,
  Section,
  Segmented,
  Title,
} from '@/components/ui';
import { api, describeError } from '@/lib/api';
import { useLoad } from '@/lib/use-load';

export default function Groups() {
  const groups = useLoad(() => api.groups.list());
  const [mode, setMode] = useState<'join' | 'create'>('join');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (work: () => Promise<{ id: string }>) => {
    setBusy(true);
    setError(null);
    try {
      const group = await work();
      setCode('');
      setName('');
      setSubtitle('');
      router.push(`/group/${group.id}`);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen refreshing={groups.loading} onRefresh={groups.reload}>
      <Title subtitle="Classes, clubs and study groups">Groups</Title>

      <Section title="Your groups">
        {groups.loading && !groups.data ? <Loading /> : null}
        {groups.data?.length === 0 ? (
          <EmptyState icon="groups" title="No groups yet">
            <Muted>Join one with a code below, or start your own.</Muted>
          </EmptyState>
        ) : null}
        {groups.data && groups.data.length > 0 ? (
          <List>
            {groups.data.map((group, index) => (
              <Row
                key={group.id}
                last={index === groups.data!.length - 1}
                onPress={() => router.push(`/group/${group.id}`)}>
                <ThemedText style={{ fontWeight: 700 }}>{group.name}</ThemedText>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 2 }}>
                  <Muted>
                    {[group.subtitle, `${group.memberCount}/${MAX_GROUP_MEMBERS} people`]
                      .filter(Boolean)
                      .join(' · ')}
                  </Muted>
                  {group.role === 'owner' ? <Pill>Owner</Pill> : null}
                </View>
              </Row>
            ))}
          </List>
        ) : null}
        <ErrorText>{groups.error}</ErrorText>
      </Section>

      <Section title="Add a group">
        <Segmented
          options={[
            { value: 'join', label: 'Join with a code' },
            { value: 'create', label: 'Start a new one' },
          ]}
          value={mode}
          onChange={(value) => {
            setMode(value);
            setError(null);
          }}
        />
        <Card>
          {mode === 'join' ? (
            <>
              <Field
                label="Group code"
                placeholder="e.g. BREAKS"
                value={code}
                onChangeText={(text) => setCode(text.replace(/\s/g, '').toUpperCase())}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={6}
              />
              <Button
                title="Join group"
                busy={busy}
                disabled={code.length !== 6}
                onPress={() => run(() => api.groups.join(code))}
              />
            </>
          ) : (
            <>
              <Field label="Name" placeholder="e.g. COMP 248" value={name} onChangeText={setName} maxLength={60} />
              <Field
                label="Detail (optional)"
                placeholder="e.g. Section D, Mon/Wed"
                value={subtitle}
                onChangeText={setSubtitle}
                maxLength={80}
              />
              <Muted>The detail tells apart groups with the same name.</Muted>
              <Button
                title="Create group"
                busy={busy}
                disabled={!name.trim()}
                onPress={() => run(() => api.groups.create(name.trim(), subtitle.trim() || undefined))}
              />
            </>
          )}
          <ErrorText>{error}</ErrorText>
        </Card>
      </Section>
    </Screen>
  );
}
