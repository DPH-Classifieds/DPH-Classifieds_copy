import React from 'react';
import { TouchableOpacity } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { SPRING_FAST } from '../../constants/motion';

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

const HAPTIC_MAP = {
  light:   Haptics.ImpactFeedbackStyle.Light,
  medium:  Haptics.ImpactFeedbackStyle.Medium,
  heavy:   Haptics.ImpactFeedbackStyle.Heavy,
};

export default function PressableScale({
  children,
  onPress,
  scale = 0.97,
  haptic = 'light',
  style,
  disabled,
  ...rest
}) {
  const scaleValue = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scaleValue.value }],
  }));

  const handlePressIn = () => {
    scaleValue.value = withSpring(scale, SPRING_FAST);
    if (haptic && !disabled) {
      if (haptic === 'success') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        Haptics.impactAsync(HAPTIC_MAP[haptic] || HAPTIC_MAP.light);
      }
    }
  };

  const handlePressOut = () => {
    scaleValue.value = withSpring(1, SPRING_FAST);
  };

  return (
    <AnimatedTouchable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      activeOpacity={1}
      disabled={disabled}
      style={[animatedStyle, style]}
      {...rest}
    >
      {children}
    </AnimatedTouchable>
  );
}
