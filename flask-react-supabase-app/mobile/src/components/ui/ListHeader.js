import React, { useMemo } from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Text from './AppText';
import { SPACING, FONT_SIZES } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

export default function ListHeader({ title, onBack, columns, onToggleColumns, colors: externalColors }) {
  const { colors: themeColors } = useTheme();
  const colors = externalColors || themeColors;
  const styles = useMemo(() => StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: SPACING.md,
      paddingTop: SPACING.xs,
      paddingBottom: SPACING.sm,
      gap: SPACING.sm,
    },
    title: {
      flex: 1,
      color: colors.textPrimary,
      fontSize: FONT_SIZES.xl,
      fontWeight: '800',
      letterSpacing: -0.4,
    },
    iconBtn: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.borderLight,
    },
  }), [colors]);

  return (
    <View style={styles.row}>
      <TouchableOpacity
        style={styles.iconBtn}
        onPress={onBack}
        activeOpacity={0.7}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityLabel="Go back"
      >
        <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
      </TouchableOpacity>
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
      {columns != null && onToggleColumns ? (
        <LayoutToggleButton columns={columns} onToggle={onToggleColumns} colors={colors} />
      ) : (
        <View style={styles.iconBtn} />
      )}
    </View>
  );
}

export function LayoutToggleButton({ columns, onToggle, colors: externalColors }) {
  const { colors: themeColors } = useTheme();
  const colors = externalColors || themeColors;
  return (
    <TouchableOpacity
      style={{
        width: 38,
        height: 38,
        borderRadius: 19,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.borderLight,
      }}
      onPress={onToggle}
      activeOpacity={0.7}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityLabel={columns === 1 ? 'Switch to two columns' : 'Switch to one column'}
    >
      <Ionicons
        name={columns === 1 ? 'grid-outline' : 'square-outline'}
        size={18}
        color={colors.accent}
      />
    </TouchableOpacity>
  );
}
