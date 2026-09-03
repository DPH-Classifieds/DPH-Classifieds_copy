import React, { useMemo } from 'react';
import { TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import Text from './AppText';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

const SIZES = {
  sm: { paddingH: 16, paddingV: 8, fontSize: FONT_SIZES.sm },
  md: { paddingH: 24, paddingV: 12, fontSize: FONT_SIZES.md },
  lg: { paddingH: 32, paddingV: 16, fontSize: FONT_SIZES.lg },
};

export default function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  icon,
  style,
}) {
  const { colors } = useTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        base: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: BORDER_RADIUS.pill,
          backgroundColor: colors.primary,
        },
        secondary: {
          backgroundColor: 'transparent',
          borderWidth: 1,
          borderColor: colors.border,
        },
        ghost: {
          backgroundColor: 'transparent',
        },
        disabled: {
          opacity: 0.5,
        },
        text: {
          color: colors.textPrimary,
          fontWeight: '600',
        },
        ghostText: {
          color: colors.textPrimary,
        },
        disabledText: {
          opacity: 0.5,
        },
      }),
    [colors]
  );

  const sizeConfig = SIZES[size];

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress?.();
  };

  const content = (
    <>
      {loading ? (
        <ActivityIndicator size="small" color={colors.textPrimary} />
      ) : (
        <>
          {icon && (
            <Ionicons
              name={icon}
              size={sizeConfig.fontSize}
              color={colors.textPrimary}
              style={{ marginRight: title ? 8 : 0 }}
            />
          )}
          {title && (
            <Text
              style={[
                styles.text,
                { fontSize: sizeConfig.fontSize },
                variant === 'ghost' && styles.ghostText,
                disabled && styles.disabledText,
              ]}
            >
              {title}
            </Text>
          )}
        </>
      )}
    </>
  );

  const baseStyle = [
    styles.base,
    {
      paddingHorizontal: sizeConfig.paddingH,
      paddingVertical: sizeConfig.paddingV,
    },
    variant === 'secondary' && styles.secondary,
    variant === 'ghost' && styles.ghost,
    disabled && styles.disabled,
    style,
  ];

  if (variant === 'primary') {
    return (
      <TouchableOpacity
        onPress={handlePress}
        disabled={disabled || loading}
        activeOpacity={0.8}
        style={[{ borderRadius: BORDER_RADIUS.pill }, disabled && styles.disabled]}
      >
        <LinearGradient
          colors={[colors.primary, colors.primaryLight]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[
            styles.base,
            {
              paddingHorizontal: sizeConfig.paddingH,
              paddingVertical: sizeConfig.paddingV,
            },
            style,
          ]}
        >
          {content}
        </LinearGradient>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      onPress={handlePress}
      disabled={disabled || loading}
      activeOpacity={0.8}
      style={baseStyle}
    >
      {content}
    </TouchableOpacity>
  );
}
