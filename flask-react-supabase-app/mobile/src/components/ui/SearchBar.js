import React, { useMemo } from 'react';
import { View, TextInput, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BORDER_RADIUS } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

export default function SearchBar({
  value,
  onChangeText,
  placeholder = 'Search listings...',
  onFocus,
  style,
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: BORDER_RADIUS.pill,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    icon: {
      marginRight: 10,
    },
    input: {
      flex: 1,
      color: colors.textPrimary,
      fontSize: 15,
      borderWidth: 0,
      backgroundColor: 'transparent',
      padding: 0,
    },
  }), [colors]);

  return (
    <View style={[styles.container, style]}>
      <Ionicons name="search" size={18} color={colors.textMuted} style={styles.icon} />
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        onFocus={onFocus}
      />
    </View>
  );
}
