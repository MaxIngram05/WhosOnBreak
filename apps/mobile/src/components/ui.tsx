/**
 * The building blocks every screen uses, in the app's palette: a quiet blue
 * page, white rounded cards, and black for anything you press.
 */

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { ComponentProps, ReactNode } from 'react';
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
import { Palette, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { weekLabel, weekRange } from '@/lib/time';

export type IconName = ComponentProps<typeof MaterialIcons>['name'];

export function Screen({
  children,
  refreshing,
  onRefresh,
  edges = ['top'],
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Screens under a stack header have no top inset of their own. */
  edges?: ('top' | 'bottom')[];
}) {
  const theme = useTheme();
  return (
    <SafeAreaView edges={edges} style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing ?? false}
              onRefresh={onRefresh}
              colors={[Palette.navy]}
              tintColor={Palette.navy}
            />
          ) : undefined
        }>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Title({ children, subtitle }: { children: ReactNode; subtitle?: ReactNode }) {
  return (
    <View style={{ marginBottom: Spacing.four }}>
      <ThemedText style={styles.title}>{children}</ThemedText>
      {subtitle ? (
        <ThemedText themeColor="textSecondary" style={{ marginTop: 2 }}>
          {subtitle}
        </ThemedText>
      ) : null}
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
        <ThemedText style={styles.sectionTitle}>{title}</ThemedText>
        {action}
      </View>
      {children}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
        style,
      ]}>
      {children}
    </View>
  );
}

/** A card holding a list of rows, with dividers between them. */
export function List({ children }: { children: ReactNode }) {
  return <Card style={{ paddingVertical: 0, paddingHorizontal: 0 }}>{children}</Card>;
}

export function Row({
  children,
  onPress,
  right,
  last,
}: {
  children: ReactNode;
  onPress?: () => void;
  right?: ReactNode;
  /** The final row in a List draws no divider. */
  last?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.row,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border },
        pressed && { backgroundColor: theme.backgroundSelected },
      ]}>
      <View style={{ flex: 1 }}>{children}</View>
      {right}
      {onPress && !right ? (
        <MaterialIcons name="chevron-right" size={22} color={theme.textSecondary} />
      ) : null}
    </Pressable>
  );
}

/** A person: avatar, name, and an optional line under it. */
export function Person({
  id,
  name,
  detail,
  you,
}: {
  id: string;
  name: string;
  detail?: ReactNode;
  you?: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Avatar seed={id} />
      <View style={{ flexShrink: 1 }}>
        <ThemedText style={{ fontWeight: 600 }}>
          {name}
          {you ? <ThemedText themeColor="textSecondary"> (you)</ThemedText> : null}
        </ThemedText>
        {detail ? (
          typeof detail === 'string' ? <Muted>{detail}</Muted> : detail
        ) : null}
      </View>
    </View>
  );
}

type ButtonKind = 'primary' | 'secondary' | 'danger' | 'quiet';

export function Button({
  title,
  onPress,
  kind = 'primary',
  disabled,
  busy,
  small,
  icon,
}: {
  title: string;
  onPress: () => void;
  kind?: ButtonKind;
  disabled?: boolean;
  busy?: boolean;
  small?: boolean;
  icon?: IconName;
}) {
  const theme = useTheme();
  const look = {
    primary: { background: theme.ink, color: theme.onInk, border: theme.ink },
    secondary: { background: theme.backgroundElement, color: theme.text, border: theme.border },
    danger: { background: theme.backgroundElement, color: theme.danger, border: theme.danger },
    quiet: { background: 'transparent', color: theme.accent, border: 'transparent' },
  }[kind];

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        {
          backgroundColor: look.background,
          borderColor: look.border,
          opacity: disabled ? 0.35 : pressed ? 0.75 : 1,
        },
      ]}>
      {busy ? (
        <ActivityIndicator color={look.color} />
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {icon ? <MaterialIcons name={icon} size={small ? 16 : 20} color={look.color} /> : null}
          <ThemedText
            type={small ? 'smallBold' : 'default'}
            style={{ color: look.color, fontWeight: 600 }}>
            {title}
          </ThemedText>
        </View>
      )}
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label?: string }) {
  const theme = useTheme();
  const { label, style, ...rest } = props;
  return (
    <View style={{ marginBottom: Spacing.three }}>
      {label ? (
        <ThemedText type="smallBold" style={{ marginBottom: 6 }}>
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
    <View style={[styles.notice, { backgroundColor: '#FDECEA' }]}>
      <MaterialIcons name="error-outline" size={18} color={theme.danger} />
      <ThemedText type="small" style={{ color: theme.danger, flex: 1 }}>
        {children}
      </ThemedText>
    </View>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  const theme = useTheme();
  if (!children) return null;
  return (
    <View style={[styles.notice, { backgroundColor: theme.freeSoft }]}>
      <MaterialIcons name="check-circle-outline" size={18} color={theme.accent} />
      <ThemedText type="small" style={{ color: theme.accent, flex: 1 }}>
        {children}
      </ThemedText>
    </View>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return (
    <ThemedText type="small" themeColor="textSecondary">
      {children}
    </ThemedText>
  );
}

/**
 * The person from the app icon: a navy silhouette on sky blue or orange,
 * picked from a stable hash so someone keeps their colour everywhere.
 */
export function Avatar({ seed, size = 40 }: { seed: string; size?: number }) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  const background = [Palette.sky, Palette.orange, Palette.periwinkle, Palette.peach][
    Math.abs(hash) % 4
  ];
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: background,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: Spacing.three,
        overflow: 'hidden',
      }}>
      <MaterialIcons name="person" size={size * 0.8} color={Palette.navy} style={{ marginTop: size * 0.18 }} />
    </View>
  );
}

/** A small rounded label: "Owner", "25m left". */
export function Pill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'free' | 'busy' | 'dark';
}) {
  const theme = useTheme();
  const look = {
    neutral: { background: theme.backgroundSelected, color: theme.accent },
    free: { background: theme.freeSoft, color: theme.free },
    busy: { background: theme.busySoft, color: theme.busy },
    dark: { background: theme.ink, color: theme.onInk },
  }[tone];
  return (
    <View style={[styles.pill, { backgroundColor: look.background }]}>
      <ThemedText type="smallBold" style={{ color: look.color, fontSize: 12, lineHeight: 16 }}>
        {children}
      </ThemedText>
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon: IconName;
  title: string;
  children?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <Card style={{ alignItems: 'center', paddingVertical: Spacing.five }}>
      <View style={[styles.emptyIcon, { backgroundColor: theme.backgroundSelected }]}>
        <MaterialIcons name={icon} size={28} color={theme.accent} />
      </View>
      <ThemedText style={{ fontWeight: 700, marginBottom: 4, textAlign: 'center' }}>{title}</ThemedText>
      {children ? (
        <View style={{ alignItems: 'center', alignSelf: 'stretch' }}>{children}</View>
      ) : null}
    </Card>
  );
}

/** A row of mutually exclusive choices. The chosen one is black. */
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
    <View
      style={[
        styles.segmented,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
      ]}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={String(option.value)}
            onPress={() => onChange(option.value)}
            style={[styles.segment, selected && { backgroundColor: theme.ink }]}>
            <ThemedText
              type="smallBold"
              style={{ color: selected ? theme.onInk : theme.text, textAlign: 'center' }}>
              {option.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

/** ‹ This week › -- steps a week at a time, with a way back to now. */
export function WeekPicker({ offset, onChange }: { offset: number; onChange: (offset: number) => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.weekPicker, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <Pressable
        accessibilityLabel="Previous week"
        onPress={() => onChange(offset - 1)}
        hitSlop={10}
        style={styles.weekArrow}>
        <MaterialIcons name="chevron-left" size={26} color={theme.text} />
      </Pressable>
      <Pressable onPress={() => onChange(0)} style={{ flex: 1, alignItems: 'center' }}>
        <ThemedText style={{ fontWeight: 700 }}>{weekLabel(offset)}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {weekRange(offset)}
          {offset !== 0 ? ' · tap for this week' : ''}
        </ThemedText>
      </Pressable>
      <Pressable
        accessibilityLabel="Next week"
        onPress={() => onChange(offset + 1)}
        hitSlop={10}
        style={styles.weekArrow}>
        <MaterialIcons name="chevron-right" size={26} color={theme.text} />
      </Pressable>
    </View>
  );
}

export function Loading() {
  return <ActivityIndicator color={Palette.navy} style={{ marginTop: Spacing.five }} />;
}

const styles = StyleSheet.create({
  content: {
    padding: Spacing.three + 4,
    paddingBottom: Spacing.six * 2,
  },
  title: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: 800,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.two + 2,
  },
  sectionTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: 700,
  },
  card: {
    borderRadius: 18,
    padding: Spacing.three + 2,
    marginBottom: Spacing.two + 2,
    borderWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three + 2,
    gap: Spacing.two,
  },
  button: {
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 13,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: Spacing.one,
  },
  buttonSmall: {
    paddingVertical: 7,
    paddingHorizontal: Spacing.three,
    marginVertical: 0,
  },
  input: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: Spacing.three,
    paddingVertical: 12,
    fontSize: 16,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: 12,
    padding: Spacing.two + 2,
    marginVertical: Spacing.two,
  },
  pill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.three,
  },
  segmented: {
    flexDirection: 'row',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 4,
    marginBottom: Spacing.three,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 999,
  },
  weekPicker: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.two,
    marginBottom: Spacing.three,
  },
  weekArrow: {
    paddingHorizontal: Spacing.three,
  },
});
