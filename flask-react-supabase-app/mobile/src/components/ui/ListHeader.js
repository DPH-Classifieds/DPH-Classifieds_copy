import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Text from './AppText';
import { COLORS, SPACING, FONT_SIZES } from '../../constants/theme';

// Round icon button that flips the listing grid between 1 and 2 columns.
// Shared by ListHeader (category screens) and the Explore feed controls row.
export function LayoutToggleButton({ columns, onToggle }) {
  return (
    <TouchableOpacity
      style={styles.iconBtn}
      onPress={onToggle}
      activeOpacity={0.7}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityLabel={columns === 1 ? 'Switch to two columns' : 'Switch to one column'}
    >
      <Ionicons
        name={columns === 1 ? 'grid-outline' : 'square-outline'}
        size={18}
        color={COLORS.accent}
      />
    </TouchableOpacity>
  );
}

// Compact top bar for category list screens: back arrow, title, layout toggle.
// Replaces the native stack header (which showed an "index" back label and left
// a large empty gap once the screen's own SafeAreaView inset was added on top).
export default function ListHeader({ title, onBack, columns, onToggleColumns }) {
  return (
    <View style={styles.row}>
      <TouchableOpacity
        style={styles.iconBtn}
        onPress={onBack}
        activeOpacity={0.7}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityLabel="Go back"
      >
        <Ionicons name="chevron-back" size={22} color={COLORS.white} />
      </TouchableOpacity>
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
      {columns != null && onToggleColumns ? (
        <LayoutToggleButton columns={columns} onToggle={onToggleColumns} />
      ) : (
        <View style={styles.iconBtn} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
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
    color: COLORS.white,
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
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
});
