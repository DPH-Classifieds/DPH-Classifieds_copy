import React from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';

export default function FadeInImage({ source, style, resizeMode = 'cover', ...props }) {
  const opacity = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  const onLoad = () => {
    opacity.value = withTiming(1, { duration: 300, easing: Easing.out(Easing.cubic) });
  };

  return (
    <View style={[styles.container, style]}>
      <Animated.Image
        source={source}
        style={[style, animatedStyle]}
        resizeMode={resizeMode}
        onLoad={onLoad}
        {...props}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden' },
});
