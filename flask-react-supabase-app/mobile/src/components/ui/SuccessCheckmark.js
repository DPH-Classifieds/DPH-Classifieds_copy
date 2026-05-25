import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants/theme';
import * as Haptics from 'expo-haptics';

export default function SuccessCheckmark({ visible, size = 48, color = COLORS.accent }) {
  const scale = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      scale.value = withDelay(50, withSpring(1, { damping: 10, stiffness: 200 }));
      opacity.value = withDelay(50, withTiming(1, { duration: 200 }));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      const timer = setTimeout(() => {
        scale.value = withTiming(0, { duration: 200 });
        opacity.value = withTiming(0, { duration: 200 });
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [visible]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  if (!visible && opacity.value === 0) return null;

  return (
    <Animated.View style={[{ alignItems: 'center', justifyContent: 'center' }, animatedStyle]}>
      <Ionicons name="checkmark-circle" size={size} color={color} />
    </Animated.View>
  );
}
