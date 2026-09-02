import React, { useMemo } from 'react';
import { TouchableOpacity, View, StyleSheet } from 'react-native';
import { BORDER_RADIUS, SPACING } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

export default function Card({ children, style, onPress, variant = 'default' }) {
  const { colors } = useTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        base: {
          backgroundColor: colors.surface,
          borderRadius: BORDER_RADIUS.lg,
          padding: SPACING.md,
        },
        elevated: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.3,
          shadowRadius: 8,
          elevation: 6,
        },
        outlined: {
          borderWidth: 1,
          borderColor: colors.border,
        },
      }),
    [colors]
  );

  const cardStyle = [
    styles.base,
    variant === 'elevated' && styles.elevated,
    variant === 'outlined' && styles.outlined,
    style,
  ];

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={cardStyle}>
        {children}
      </TouchableOpacity>
    );
  }

  return <View style={cardStyle}>{children}</View>;
}
