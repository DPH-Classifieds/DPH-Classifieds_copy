import React, { useMemo } from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import Text from './AppText';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

export default function AnimatedButton({ title, onPress, variant = 'primary', style, textStyle, disabled = false }) {
  const { colors } = useTheme();
  const styles = useMemo(() => StyleSheet.create({
    button: { borderRadius: BORDER_RADIUS.lg, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
    text: { color: colors.white, fontSize: FONT_SIZES.md, fontWeight: '600' },
  }), [colors]);

  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    if (!disabled) {
      scale.value = withSpring(0.95, { damping: 15, stiffness: 400 });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, { damping: 15, stiffness: 400 });
  };

  const bgColor = variant === 'primary' ? colors.accent : variant === 'destructive' ? colors.error : colors.surface;

  return (
    <AnimatedTouchable
      onPress={disabled ? undefined : onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      activeOpacity={1}
      style={[styles.button, { backgroundColor: bgColor, opacity: disabled ? 0.5 : 1 }, animatedStyle, style]}
    >
      <Text style={[styles.text, textStyle]}>{title}</Text>
    </AnimatedTouchable>
  );
}
