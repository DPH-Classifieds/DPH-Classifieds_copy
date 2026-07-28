import React from 'react';
import { Text as RNText, StyleSheet } from 'react-native';
import { FONT_FAMILY } from '../../constants/theme';

// App-wide brand typeface (Plus Jakarta Sans, DPHClassifieds Brand Kit). React
// Native can't synthesise weights from a single custom family, so we map the
// resolved fontWeight to the matching PJS face. Every screen imports Text from
// here (via codemod) instead of react-native, so all text uses the brand font
// without editing 300+ inline styles.
//
// ponytail: one StyleSheet.flatten per Text render — negligible next to
// re-theming every call site; revisit only if profiling ever flags it.
const FACE = {
  '100': FONT_FAMILY.regular,
  '200': FONT_FAMILY.regular,
  '300': FONT_FAMILY.regular,
  '400': FONT_FAMILY.regular,
  normal: FONT_FAMILY.regular,
  '500': FONT_FAMILY.medium,
  '600': FONT_FAMILY.semibold,
  '700': FONT_FAMILY.bold,
  bold: FONT_FAMILY.bold,
  '800': FONT_FAMILY.extrabold,
  '900': FONT_FAMILY.extrabold,
};

const AppText = React.forwardRef(function AppText({ style, ...props }, ref) {
  const flat = StyleSheet.flatten(style) || {};
  // Respect an explicit non-system family (e.g. the monospace VIN fields).
  const family =
    flat.fontFamily && flat.fontFamily !== 'System'
      ? flat.fontFamily
      : FACE[String(flat.fontWeight ?? '400')] || FONT_FAMILY.regular;
  return <RNText ref={ref} {...props} style={[style, { fontFamily: family }]} />;
});

export default AppText;
