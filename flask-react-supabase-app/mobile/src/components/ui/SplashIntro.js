import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  withDelay,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import { useTheme } from '../../context/ThemeContext';

const HOLD_MS = 900;
const FADE_OUT_MS = 350;

export default function SplashIntro({ onFinish }) {
  const { colors } = useTheme();
  const styles = useMemo(() => StyleSheet.create({
    container: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.black,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 999,
    },
    mark: { width: 120, height: 120, borderRadius: 28 },
    wordmark: {
      marginTop: 14,
      color: colors.white,
      fontSize: 20,
      fontWeight: '600',
      letterSpacing: 4,
      textTransform: 'uppercase',
    },
  }), [colors]);

  const [visible, setVisible] = useState(true);
  const markScale = useSharedValue(0.85);
  const markOpacity = useSharedValue(0);
  const wordmarkOpacity = useSharedValue(0);
  const wordmarkTranslateY = useSharedValue(8);
  const overlayOpacity = useSharedValue(1);

  useEffect(() => {
    markOpacity.value = withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) });
    markScale.value = withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) });
    wordmarkOpacity.value = withDelay(200, withTiming(1, { duration: 380 }));
    wordmarkTranslateY.value = withDelay(200, withTiming(0, { duration: 380, easing: Easing.out(Easing.cubic) }));

    overlayOpacity.value = withDelay(
      HOLD_MS,
      withSequence(
        withTiming(1, { duration: 0 }),
        withTiming(0, { duration: FADE_OUT_MS }, (finished) => {
          if (finished) runOnJS(setVisible)(false);
        })
      )
    );
  }, []);

  useEffect(() => {
    if (!visible) onFinish?.();
  }, [visible]);

  const markStyle = useAnimatedStyle(() => ({
    opacity: markOpacity.value,
    transform: [{ scale: markScale.value }],
  }));
  const wordmarkStyle = useAnimatedStyle(() => ({
    opacity: wordmarkOpacity.value,
    transform: [{ translateY: wordmarkTranslateY.value }],
  }));
  const containerStyle = useAnimatedStyle(() => ({ opacity: overlayOpacity.value }));

  if (!visible) return null;

  return (
    <Animated.View style={[styles.container, containerStyle]} pointerEvents="none">
      <Animated.Image source={require('../../../assets/icon.png')} style={[styles.mark, markStyle]} resizeMode="contain" />
      <Animated.Text style={[styles.wordmark, wordmarkStyle]}>Classifieds</Animated.Text>
    </Animated.View>
  );
}
