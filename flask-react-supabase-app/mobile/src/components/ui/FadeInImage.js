import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants/theme';

export default function FadeInImage({ source, style, resizeMode = 'cover', ...props }) {
  const opacity = useSharedValue(0);
  const [hasError, setHasError] = useState(false);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  const handleLoad = () => {
    opacity.value = withTiming(1, { duration: 300 });
  };

  const handleError = () => {
    setHasError(true);
    opacity.value = withTiming(1, { duration: 150 });
  };

  if (hasError) {
    return (
      <View style={[styles.errorContainer, style]}>
        <Ionicons name="image-outline" size={32} color={COLORS.textMuted} />
      </View>
    );
  }

  return (
    <Animated.Image
      source={source}
      style={[style, animatedStyle]}
      resizeMode={resizeMode}
      onLoad={handleLoad}
      onError={handleError}
      {...props}
    />
  );
}

const styles = StyleSheet.create({
  errorContainer: {
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
