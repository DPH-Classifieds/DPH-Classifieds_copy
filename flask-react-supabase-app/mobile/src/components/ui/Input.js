import React, { useState, useMemo } from 'react';
import { View, TextInput, StyleSheet } from 'react-native';
import Text from './AppText';
import { Ionicons } from '@expo/vector-icons';
import { BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

export default function Input({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry = false,
  error,
  icon,
  multiline = false,
  keyboardType = 'default',
  style,
  ...rest
}) {
  const { colors } = useTheme();
  const [isFocused, setIsFocused] = useState(false);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          marginBottom: 16,
        },
        label: {
          color: colors.textSecondary,
          fontSize: FONT_SIZES.sm,
          marginBottom: 6,
          fontWeight: '500',
        },
        inputWrapper: {
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: colors.surfaceHigher,
          borderRadius: BORDER_RADIUS.md,
          borderWidth: 1,
          paddingHorizontal: 14,
          paddingVertical: 12,
        },
        icon: {
          marginRight: 10,
        },
        input: {
          flex: 1,
          color: colors.textPrimary,
          fontSize: FONT_SIZES.md,
          padding: 0,
        },
        multiline: {
          minHeight: 80,
          textAlignVertical: 'top',
        },
        error: {
          color: colors.error,
          fontSize: FONT_SIZES.sm,
          marginTop: 4,
        },
      }),
    [colors]
  );

  const borderColor = error
    ? colors.error
    : isFocused
    ? colors.accent
    : colors.borderLight;

  return (
    <View style={[styles.container, style]}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={[styles.inputWrapper, { borderColor }]}>
        {icon && (
          <Ionicons
            name={icon}
            size={18}
            color={isFocused ? colors.accent : colors.textMuted}
            style={styles.icon}
          />
        )}
        <TextInput
          style={[styles.input, multiline && styles.multiline]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          secureTextEntry={secureTextEntry}
          multiline={multiline}
          keyboardType={keyboardType}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          {...rest}
        />
      </View>
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}
