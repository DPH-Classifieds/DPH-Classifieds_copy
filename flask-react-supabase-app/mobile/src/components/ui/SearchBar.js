import React from 'react';
import { View, TextInput, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, BORDER_RADIUS } from '../../constants/theme';

export default function SearchBar({
  value,
  onChangeText,
  placeholder = 'Search listings...',
  onFocus,
  style,
}) {
  return (
    <View style={[styles.container, style]}>
      <Ionicons name="search" size={18} color="rgba(255,255,255,0.4)" style={styles.icon} />
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="rgba(255,255,255,0.4)"
        onFocus={onFocus}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.pill,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  icon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    color: COLORS.white,
    fontSize: 15,
    borderWidth: 0,
    backgroundColor: 'transparent',
    padding: 0,
  },
});
