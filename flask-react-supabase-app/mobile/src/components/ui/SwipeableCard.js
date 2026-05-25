import React from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, BORDER_RADIUS } from '../../constants/theme';

const SWIPE_THRESHOLD = 80;

export default function SwipeableCard({ children, onSwipeRight, onSwipeLeft, style }) {
  const translateX = useSharedValue(0);

  const panGesture = Gesture.Pan()
    .onUpdate((event) => {
      translateX.value = event.translationX;
    })
    .onEnd(() => {
      if (translateX.value > SWIPE_THRESHOLD && onSwipeRight) {
        translateX.value = withSpring(400, {}, () => {
          runOnJS(onSwipeRight)();
          translateX.value = withSpring(0);
        });
      } else if (translateX.value < -SWIPE_THRESHOLD && onSwipeLeft) {
        translateX.value = withSpring(-400, {}, () => {
          runOnJS(onSwipeLeft)();
          translateX.value = withSpring(0);
        });
      } else {
        translateX.value = withSpring(0, { damping: 20, stiffness: 200 });
      }
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const greenBgStyle = useAnimatedStyle(() => ({
    opacity: translateX.value > 0 ? Math.min(1, translateX.value / SWIPE_THRESHOLD) : 0,
  }));

  const redBgStyle = useAnimatedStyle(() => ({
    opacity: translateX.value < 0 ? Math.min(1, Math.abs(translateX.value) / SWIPE_THRESHOLD) : 0,
  }));

  return (
    <View style={[styles.container, style]}>
      <Animated.View style={[styles.swipeBg, styles.greenBg, greenBgStyle]}>
        <Ionicons name="heart" size={24} color="#fff" />
      </Animated.View>
      <Animated.View style={[styles.swipeBg, styles.redBg, redBgStyle]}>
        <Ionicons name="close" size={24} color="#fff" />
      </Animated.View>
      <GestureDetector gesture={panGesture}>
        <Animated.View style={[styles.cardContent, cardStyle]}>
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: BORDER_RADIUS.lg,
  },
  swipeBg: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: BORDER_RADIUS.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  greenBg: {
    backgroundColor: COLORS.success,
  },
  redBg: {
    backgroundColor: COLORS.error,
  },
  cardContent: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
  },
});
