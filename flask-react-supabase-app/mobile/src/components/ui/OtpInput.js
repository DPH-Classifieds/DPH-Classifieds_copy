import React, { useEffect, useMemo, useRef } from 'react';
import { View, TextInput, Pressable, StyleSheet } from 'react-native';
import Animated, {
  FadeInDown,
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
  withSpring,
} from 'react-native-reanimated';
import Text from './AppText';
import { BORDER_RADIUS } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

// Animated per-digit OTP entry. A single hidden TextInput captures input (keeps iOS
// SMS autofill via textContentType="oneTimeCode"); the boxes are presentational.
// Shake fires whenever `errorNonce` changes. Matches the web OTP box styling.
function Box({ char, active, filled, index, styles }) {
  const scale = useSharedValue(active ? 1.05 : 1);
  useEffect(() => {
    scale.value = withSpring(active ? 1.06 : 1, { stiffness: 300, damping: 18 });
  }, [active, scale]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 50).springify().damping(16)}
      style={[
        styles.box,
        (active || filled) && styles.boxActive,
        style,
      ]}
    >
      <Text style={styles.boxText}>{char || ''}</Text>
    </Animated.View>
  );
}

export default function OtpInput({
  value = '',
  onChangeText,
  length = 4,
  errorNonce = 0,
  autoFocus = true,
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => StyleSheet.create({
    row: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 12,
    },
    box: {
      width: 56,
      height: 64,
      borderRadius: BORDER_RADIUS.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: 'rgba(255,255,255,0.03)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    boxActive: {
      borderColor: colors.accent,
      backgroundColor: 'rgba(139,214,180,0.06)',
    },
    boxText: {
      color: colors.textPrimary,
      fontSize: 26,
      fontWeight: '700',
    },
    // Covers the row but invisible — taps focus it, keystrokes drive the boxes.
    hiddenInput: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      opacity: 0,
    },
  }), [colors]);

  const inputRef = useRef(null);
  const shakeX = useSharedValue(0);
  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shakeX.value }] }));

  // Fire the shake on each errorNonce bump (skip the initial mount at 0).
  useEffect(() => {
    if (!errorNonce) return;
    shakeX.value = withSequence(
      withTiming(-9, { duration: 50 }),
      withTiming(8, { duration: 50 }),
      withTiming(-6, { duration: 50 }),
      withTiming(5, { duration: 50 }),
      withTiming(0, { duration: 50 }),
    );
  }, [errorNonce, shakeX]);

  const digits = Array.from({ length }, (_, i) => value[i] || '');

  return (
    <Pressable onPress={() => inputRef.current?.focus()}>
      <Animated.View style={[styles.row, rowStyle]}>
        {digits.map((char, i) => (
          <Box
            key={i}
            index={i}
            char={char}
            filled={Boolean(char)}
            active={i === value.length}
            styles={styles}
          />
        ))}
      </Animated.View>
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={(t) => onChangeText?.(t.replace(/\D/g, '').slice(0, length))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={length}
        autoFocus={autoFocus}
        caretHidden
        style={styles.hiddenInput}
      />
    </Pressable>
  );
}
