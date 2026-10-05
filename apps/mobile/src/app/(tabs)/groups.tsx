import { useState } from 'react';
import { router } from 'expo-router';
import { MAX_GROUP_MEMBERS } from '@whosonbreak/contracts';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorText, Field, Loading, Muted, Row, Screen, Section, Title } from '@/components/ui';
import { api, describeError } from '@/lib/api';
import { useLoad } from '@/lib/use-load';

export default function Groups() {
  const groups = useLoad(() => api.groups.list());
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [busy, setBusy] = useState<'join' | 'create' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    setBusy('join');
    setError(null);
    try {
      const group = await api.groups.join(code);
      setCode('');
      router.push(`/group/${group.id}`);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    setBusy('create');
    setError(null);
    try {
      const group = await api.groups.create(name.trim(), subtitle.trim() || undefined);
      setName('');
      setSubtitle('');
      router.push(`/group/${group.id}`);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen refreshing={groups.loading} onRefresh={groups.reload}>
      <Title>Groups</Title>

      <Section title="Your groups">
        {groups.loading && !groups.data ? <Loading /> : null}
        {groups.data?.length === 0 ? <Muted>None yet. Join one below or start your own.</Muted> : null}
        {groups.data?.map((group) => (
          <Row
            key={group.id}
            onPress={() => router.push(`/group/${group.id}`)}
            right={<Muted>{`${group.memberCount}/${MAX_GROUP_MEMBERS}`}</Muted>}>
            <ThemedText type="smallBold">{group.name}</ThemedText>
            {group.subtitle ? <Muted>{group.subtitle}</Muted> : null}
          </Row>
        ))}
        <ErrorText>{groups.error}</ErrorText>
      </Section>

      <Section title="Join with a code">
        <Card>
          <Field
            placeholder="6-character code"
            value={code}
            onChangeText={(text) => setCode(text.toUpperCase())}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={6}
          />
          <Button title="Join" onPress={join} busy={busy === 'join'} disabled={code.length !== 6} />
        </Card>
      </Section>

      <Section title="Start a group">
        <Card>
          <Field placeholder="Name, e.g. 10B Maths" value={name} onChangeText={setName} maxLength={60} />
          <Field
            placeholder="Optional detail, e.g. Mr Smith, Room 4"
            value={subtitle}
            onChangeText={setSubtitle}
            maxLength={80}
          />
          <Muted>The detail helps tell apart groups with the same name.</Muted>
          <Button title="Create" onPress={create} busy={busy === 'create'} disabled={!name.trim()} />
        </Card>
      </Section>

      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}
