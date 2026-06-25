import React, { useEffect } from 'react';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import { FADE_DURATION, ENTRANCE_DISTANCE } from '../../constants/motion';

export default function ScreenEntrance({ children, style }) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(ENTRANCE_DISTANCE);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: FADE_DURATION });
    translateY.value = withTiming(0, { duration: FADE_DURATION });
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View style={[{ flex: 1 }, animatedStyle, style]}>
      {children}
    </Animated.View>
  );
}
