import { Platform } from 'react-native';

export const COLORS = {
  black: '#000000',
  background: '#000000',
  surface: '#272729',
  surfaceVariant: '#262628',
  surfaceHigh: '#28282a',
  surfaceHigher: '#2a2a2d',
  surfaceDark: '#242426',
  primary: '#01351c',
  primaryLight: '#014d2a',
  primaryDark: '#012513',
  accent: '#4CAF50',
  accentBright: '#00c853',
  white: '#ffffff',
  textPrimary: '#ffffff',
  textSecondary: 'rgba(255,255,255,0.63)',
  textMuted: 'rgba(255,255,255,0.4)',
  border: 'rgba(255,255,255,0.15)',
  borderLight: 'rgba(255,255,255,0.08)',
  success: '#4CAF50',
  warning: '#ff9800',
  error: '#f44336',
  info: '#2196f3',
  overlay: 'rgba(0,0,0,0.6)',
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

const systemFontFamily = Platform.select({
  ios: 'System',
  android: 'Roboto',
  default: 'System',
});

export const FONTS = {
  regular: {
    fontFamily: systemFontFamily,
    fontWeight: '400',
  },
  medium: {
    fontFamily: systemFontFamily,
    fontWeight: '500',
  },
  semibold: {
    fontFamily: systemFontFamily,
    fontWeight: '600',
  },
  bold: {
    fontFamily: systemFontFamily,
    fontWeight: '700',
  },
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
