import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';

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
  const sizeConfig = SIZES[size];

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress?.();
  };

  const content = (
    <>
      {loading ? (
        <ActivityIndicator size="small" color={COLORS.white} />
      ) : (
        <>
          {icon && (
            <Ionicons
              name={icon}
              size={sizeConfig.fontSize}
              color={variant === 'secondary' || variant === 'ghost' ? COLORS.white : COLORS.white}
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
          colors={[COLORS.primary, COLORS.primaryLight]}
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

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: BORDER_RADIUS.pill,
    backgroundColor: COLORS.primary,
  },
  secondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  disabled: {
    opacity: 0.5,
  },
  text: {
    color: COLORS.white,
    fontWeight: '600',
  },
  ghostText: {
    color: COLORS.white,
  },
  disabledText: {
    opacity: 0.5,
  },
});
