/**
 * The palette, taken from the app's artwork: a quiet blue base, black for the
 * things you press, and the artwork's sky, periwinkle and orange as accents.
 *
 * One light theme for now (app.json pins userInterfaceStyle to light). Both
 * keys exist so the template's hooks keep working if dark mode comes back.
 */

import '@/global.css';

import { Platform } from 'react-native';

/** The artwork's own colours, sampled from the icon. */
export const Palette = {
  navy: '#2D308A',
  periwinkle: '#B0C0F7',
  indigo: '#4147EB',
  sky: '#72BAF4',
  grey: '#EBEBEB',
  peach: '#FFBA71',
  orange: '#FF9523',
  ink: '#0B0B14',
} as const;

const light = {
  text: Palette.ink,
  textSecondary: '#5B5F82',
  /** The quiet blue every screen sits on. */
  background: '#EEF1FC',
  /** Cards and inputs. */
  backgroundElement: '#FFFFFF',
  backgroundSelected: '#DDE3FA',
  border: '#D3D9F2',
  /** Black elements: primary buttons, the tab bar. */
  ink: Palette.ink,
  onInk: '#FFFFFF',
  accent: Palette.navy,
  onAccent: '#FFFFFF',
  free: Palette.indigo,
  freeSoft: '#E4E7FD',
  busy: '#B35F07',
  busySoft: '#FFF0DD',
  danger: '#C8261B',
  /** Blocks on the week grid. Own blocks are coloured by kind; others' are grey unless shared. */
  blockClass: Palette.sky,
  blockWork: Palette.peach,
  blockOther: Palette.periwinkle,
  blockUnknown: '#DCE1F3',
  blockBorder: Palette.navy,
  blockActive: Palette.indigo,
  breakFill: '#D6DBFB',
  tabInactive: '#7E83A8',
  tabActive: Palette.periwinkle,
};

export const Colors = {
  light,
  dark: light,
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
