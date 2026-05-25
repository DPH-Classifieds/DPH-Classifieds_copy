import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet } from 'react-native';
import { COLORS, SPACING, BORDER_RADIUS } from '../../constants/theme';

const PLACEHOLDER_COLOR = '#2c2c2e';
const PULSE_COLOR = '#3c3c3e';

function SkeletonCard({ index }) {
  const pulseAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [pulseAnim]);

  const backgroundColor = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [PLACEHOLDER_COLOR, PULSE_COLOR],
  });

  return (
    <View style={styles.card}>
      <Animated.View style={[styles.imagePlaceholder, { backgroundColor }]} />
      <View style={styles.body}>
        <Animated.View style={[styles.lineTitle, { backgroundColor }]} />
        <Animated.View style={[styles.linePrice, { backgroundColor }]} />
        <Animated.View style={[styles.lineDate, { backgroundColor }]} />
      </View>
    </View>
  );
}

export default function ListingSkeleton() {
  return (
    <View style={styles.container}>
      <SkeletonCard index={0} />
      <SkeletonCard index={1} />
      <SkeletonCard index={2} />
      <SkeletonCard index={3} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: SPACING.sm,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.xl,
    overflow: 'hidden',
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  imagePlaceholder: {
    height: 210,
  },
  body: {
    padding: 14,
  },
  lineTitle: {
    height: 14,
    borderRadius: 6,
    width: '84%',
    marginBottom: 10,
  },
  linePrice: {
    height: 16,
    borderRadius: 7,
    width: '54%',
    marginBottom: 8,
  },
  lineDate: {
    height: 12,
    borderRadius: 5,
    width: '42%',
  },
});
