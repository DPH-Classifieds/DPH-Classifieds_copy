import { Platform } from 'react-native';

// Palette from DPHClassifieds Brand Kit v1.0 (2026). Dark-premium, green-tinted
// surfaces — the brand explicitly forbids pure black (#000000), solid white
// borders, and bright white backgrounds.
export const COLORS = {
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

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

// Android's tab bar floats over content (position: 'absolute', for the
// BlurView glass effect in AppNavigator), so screens need extra bottom
// padding or their last items sit behind it. iOS now uses a real native
// UITabBarController (react-native-screens' native bottom tabs, for Liquid
// Glass on iOS 26+), which insets scrollable content correctly on its own —
// adding the same padding there would just double up as dead whitespace.
export const TAB_BAR_CLEARANCE = Platform.OS === 'ios' ? 0 : 100;

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
