/**
 * The small set of building blocks every screen uses. Deliberately plain:
 * the point of this iteration is that the app works end to end.
 */

import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function Screen({
  children,
  refreshing,
  onRefresh,
  scroll = true,
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  scroll?: boolean;
}) {
  const theme = useTheme();
  const body = scroll ? (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? (
          <RefreshControl refreshing={refreshing ?? false} onRefresh={onRefresh} />
        ) : undefined
      }>
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.content, { flex: 1 }]}>{children}</View>
  );

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.background }}>
      {body}
    </SafeAreaView>
  );
}

export function Title({ children, subtitle }: { children: ReactNode; subtitle?: ReactNode }) {
  return (
    <View style={{ marginBottom: Spacing.three }}>
      <ThemedText style={styles.title}>{children}</ThemedText>
      {subtitle ? <ThemedText themeColor="textSecondary">{subtitle}</ThemedText> : null}
    </View>
  );
}

export function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <View style={{ marginBottom: Spacing.four }}>
      <View style={styles.sectionHeader}>
        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionTitle}>
          {title.toUpperCase()}
        </ThemedText>
        {action}
      </View>
      {children}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement }, style]}>
      {children}
    </View>
  );
}

export function Row({
  children,
  onPress,
  right,
}: {
  children: ReactNode;
  onPress?: () => void;
  right?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: theme.border },
        pressed && { backgroundColor: theme.backgroundSelected },
      ]}>
      <View style={{ flex: 1 }}>{children}</View>
      {right}
    </Pressable>
  );
}

type ButtonKind = 'primary' | 'secondary' | 'danger';

export function Button({
  title,
  onPress,
  kind = 'primary',
  disabled,
  busy,
  small,
}: {
  title: string;
  onPress: () => void;
  kind?: ButtonKind;
  disabled?: boolean;
  busy?: boolean;
  small?: boolean;
}) {
  const theme = useTheme();
  const background =
    kind === 'primary' ? theme.accent : kind === 'danger' ? theme.danger : theme.backgroundSelected;
  const color = kind === 'secondary' ? theme.text : theme.onAccent;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        { backgroundColor: background, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 },
      ]}>
      {busy ? (
        <ActivityIndicator color={color} />
      ) : (
        <ThemedText type={small ? 'smallBold' : 'default'} style={{ color, fontWeight: 600 }}>
          {title}
        </ThemedText>
      )}
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label?: string }) {
  const theme = useTheme();
  const { label, style, ...rest } = props;
  return (
    <View style={{ marginBottom: Spacing.two }}>
      {label ? (
        <ThemedText type="small" themeColor="textSecondary" style={{ marginBottom: Spacing.one }}>
          {label}
        </ThemedText>
      ) : null}
      <TextInput
        placeholderTextColor={theme.textSecondary}
        style={[
          styles.input,
          { color: theme.text, borderColor: theme.border, backgroundColor: theme.background },
          style,
        ]}
        {...rest}
      />
    </View>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  const theme = useTheme();
  if (!children) return null;
  return (
    <ThemedText type="small" style={{ color: theme.danger, marginVertical: Spacing.two }}>
      {children}
    </ThemedText>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return (
    <ThemedText type="small" themeColor="textSecondary">
      {children}
    </ThemedText>
  );
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const theme = useTheme();
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: theme.backgroundSelected,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: Spacing.three,
      }}>
      <ThemedText type="smallBold">{initials || '?'}</ThemedText>
    </View>
  );
}

/** A row of mutually exclusive choices. */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: theme.backgroundElement }]}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={String(option.value)}
            onPress={() => onChange(option.value)}
            style={[styles.segment, selected && { backgroundColor: theme.accent }]}>
            <ThemedText
              type="smallBold"
              style={{ color: selected ? theme.onAccent : theme.text, textAlign: 'center' }}>
              {option.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Loading() {
  return <ActivityIndicator style={{ marginTop: Spacing.five }} />;
}

const styles = StyleSheet.create({
  content: {
    padding: Spacing.three,
    paddingBottom: Spacing.six * 2,
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: 700,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.two,
  },
  sectionTitle: {
    letterSpacing: 0.5,
  },
  card: {
    borderRadius: 14,
    padding: Spacing.three,
    marginBottom: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  button: {
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: Spacing.one,
  },
  buttonSmall: {
    paddingVertical: 6,
    paddingHorizontal: Spacing.two + 4,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
    fontSize: 16,
  },
  segmented: {
    flexDirection: 'row',
    borderRadius: 10,
    padding: 3,
    marginBottom: Spacing.two,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
  },
});
