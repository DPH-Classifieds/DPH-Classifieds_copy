import { Platform } from 'react-native';

// Palette from DPHClassifieds Brand Kit v1.0 (2026). Dark-premium, green-tinted
// surfaces — the brand explicitly forbids pure black (#000000), solid white
// borders, and bright white backgrounds.
//
// Brand-invariant colors (primary/accent/white/semantic) stay identical across
// light and dark — only background/surface/text/border swap. See ThemeContext
// for how a screen opts into DARK_COLORS/LIGHT_COLORS via the current theme;
// screens that still statically `import { COLORS }` from here keep rendering
// with DARK_COLORS unchanged (not yet migrated — see mobile theme rollout).
//
// SEMANTIC NOTE for `black` and `white` tokens:
//   DARK_COLORS.black = '#05100a' (dark surface)     LIGHT_COLORS.black = '#0E1512' (DARK TEXT)
//   DARK_COLORS.white = '#FFFFFF' (light text on dark) LIGHT_COLORS.white = '#FFFFFF' (button on-color)
// These tokens have DIFFERENT semantic meanings across palettes. Use
// `colors.background` (page bg), `colors.textPrimary` (page text), and
// `colors.surface` (card bg) for theme-aware styling — they flip correctly
// between palettes. Don't use `colors.black` as a page bg or `colors.white`
// as page text in light mode; those will render incorrectly.
export const DARK_COLORS = {
  // Near-black green used for dark text on the mint accent + darkest surfaces
  // (brand: never pure #000000).
  black: '#05100a',
  background: '#07110b',        // page base (brand page gradient #07110b→#040806)
  surface: '#0C1C13',           // card top (brand card gradient #0C1C13→#070F0A)
  surfaceVariant: '#0b1a12',
  surfaceHigh: '#112519',       // header mid tone
  surfaceHigher: '#323535',     // Surface Container Highest — input fill
  surfaceDark: '#070F0A',       // card bottom / darkest surface
  primary: '#01351C',           // Forest Green — Brand (logo, hero anchor)
  primaryLight: '#004E37',      // Deep Green — Container (button/gradient fills)
  primaryDark: '#012513',
  accent: '#8BD6B4',            // Mint Green — Primary (CTAs, links, prices)
  accentBright: '#A6E4C6',
  white: '#FFFFFF',             // On Surface
  textPrimary: '#FFFFFF',
  textSecondary: '#A8B4AC',     // Silver — secondary text, metadata
  textMuted: 'rgba(168,180,172,0.6)',
  border: 'rgba(139,214,180,0.12)',   // ghost mint 12%
  borderLight: 'rgba(139,214,180,0.06)',
  success: '#8BD6B4',
  warning: '#ff9800',
  error: '#f44336',
  info: '#2196f3',
  overlay: 'rgba(4,8,6,0.7)',
};

// Light counterpart — same brand-invariant accents, off-white surfaces (never
// pure white per the brand kit's "no bright white backgrounds" rule).
export const LIGHT_COLORS = {
  black: '#0E1512',
  background: '#FAFAFA',
  surface: '#FFFFFF',
  surfaceVariant: '#F5F7F6',
  surfaceHigh: '#EFF3F1',
  surfaceHigher: '#E7ECE9',
  surfaceDark: '#F0F2F1',
  primary: '#01351C',
  primaryLight: '#004E37',
  primaryDark: '#012513',
  accent: '#0B6B4C',           // darker mint than the dark theme's #8BD6B4 — keeps CTA/link contrast on a white surface
  accentBright: '#0F8560',
  white: '#FFFFFF',
  textPrimary: '#0E1512',
  textSecondary: '#5B655F',
  textMuted: 'rgba(91,101,95,0.65)',
  border: 'rgba(15,23,20,0.10)',
  borderLight: 'rgba(15,23,20,0.06)',
  success: '#0B6B4C',
  warning: '#ff9800',
  error: '#f44336',
  info: '#2196f3',
  overlay: 'rgba(4,8,6,0.7)',
};

// Legacy default — unmigrated screens keep statically importing this and
// stay pixel-identical (dark) until each one adopts useTheme() explicitly.
export const COLORS = DARK_COLORS;

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

// Small comfort gap so a screen's last scroll item isn't flush against the tab
// bar. Both platforms now use tab bars that occupy/inset layout space (iOS
// native UITabBarController; Android in-layout JS <Tabs>), so content already
// sits above the bar + gesture nav — this is just breathing room, NOT the old
// 100px hack that compensated for the removed absolute BlurView bar in the (now
// dead) AppNavigator.
export const TAB_BAR_CLEARANCE = Platform.OS === 'ios' ? 0 : 24;

export const BORDER_RADIUS = {
  sm: 5,
  md: 8,
  lg: 12,
  xl: 16,
  pill: 980,
};

// Brand typeface: Plus Jakarta Sans (loaded in app/_layout.tsx via
// @expo-google-fonts/plus-jakarta-sans). Per-weight face names — RN doesn't
// synthesise weights from a single custom family, so each weight is its own
// face. Falls back to the system font until the async load completes.
export const FONT_FAMILY = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extrabold: 'PlusJakartaSans_800ExtraBold',
};

export const FONTS = {
  regular: { fontFamily: FONT_FAMILY.regular, fontWeight: '400' },
  medium: { fontFamily: FONT_FAMILY.medium, fontWeight: '500' },
  semibold: { fontFamily: FONT_FAMILY.semibold, fontWeight: '600' },
  bold: { fontFamily: FONT_FAMILY.bold, fontWeight: '700' },
  // Display headlines (brand: 800 weight, -0.02em). Use for hero/vehicle names.
  display: { fontFamily: FONT_FAMILY.extrabold, fontWeight: '800', letterSpacing: -0.4 },
  // Category tags / badges (brand: 600 weight, +0.1em tracking).
  label: { fontFamily: FONT_FAMILY.semibold, fontWeight: '600', letterSpacing: 0.5 },
};

export const FONT_SIZES = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 24,
  hero: 32,
};

export default {
  COLORS,
  SPACING,
  BORDER_RADIUS,
  FONTS,
  FONT_SIZES,
};
