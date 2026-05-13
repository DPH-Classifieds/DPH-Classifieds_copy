import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';

const VARIANTS = {
  default: { bg: '#2a2a2d', text: '#ffffff' },
  success: { bg: '#4CAF50', text: '#ffffff' },
  warning: { bg: '#ff9800', text: '#ffffff' },
  error: { bg: '#f44336', text: '#ffffff' },
  info: { bg: '#2196f3', text: '#ffffff' },
  primary: { bg: '#01351c', text: '#4CAF50' },
};

const SIZES = {
  sm: { paddingH: 8, paddingV: 2, fontSize: FONT_SIZES.xs },
  md: { paddingH: 10, paddingV: 4, fontSize: 11 },
  lg: { paddingH: 12, paddingV: 6, fontSize: FONT_SIZES.sm },
};

export default function Badge({ label, variant = 'default', size = 'md', style }) {
  const colors = VARIANTS[variant] || VARIANTS.default;
  const sizeConfig = SIZES[size] || SIZES.md;

  return (
    <View
      style={[
        styles.base,
        {
          backgroundColor: colors.bg,
          paddingHorizontal: sizeConfig.paddingH,
          paddingVertical: sizeConfig.paddingV,
        },
        style,
      ]}
    >
      <Text style={[styles.text, { color: colors.text, fontSize: sizeConfig.fontSize }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: BORDER_RADIUS.pill,
    alignSelf: 'flex-start',
  },
  text: {
    fontWeight: '600',
  },
});
