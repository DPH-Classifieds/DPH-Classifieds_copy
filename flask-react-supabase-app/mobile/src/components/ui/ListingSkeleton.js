import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, SPACING, BORDER_RADIUS } from '../../constants/theme';

const SHIMMER_DARK  = '#242426';
const SHIMMER_MID   = '#2e2e30';
const SHIMMER_LIGHT = '#3a3a3c';

function ShimmerBox({ style }) {
  const opacity = useSharedValue(0.6);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 700 }),
        withTiming(0.6, { duration: 700 })
      ),
      -1,
      false
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View style={[style, animatedStyle]}>
      <LinearGradient
        colors={[SHIMMER_DARK, SHIMMER_MID, SHIMMER_LIGHT, SHIMMER_MID, SHIMMER_DARK]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}

function SkeletonCard() {
  return (
    <View style={styles.card}>
      <ShimmerBox style={styles.imagePlaceholder} />
      <View style={styles.body}>
        <ShimmerBox style={styles.lineTitle} />
        <ShimmerBox style={styles.linePrice} />
        <ShimmerBox style={styles.lineDate} />
      </View>
    </View>
  );
}

export function ProfileSkeleton() {
  return (
    <View style={styles.profileContainer}>
      <ShimmerBox style={styles.avatar} />
      <View style={styles.statsRow}>
        {[0, 1, 2].map((i) => (
          <ShimmerBox key={i} style={styles.statTile} />
        ))}
      </View>
    </View>
  );
}

export function AdminStatsSkeleton() {
  return (
    <View style={styles.statsGrid}>
      {[0, 1, 2, 3].map((i) => (
        <ShimmerBox key={i} style={styles.adminStatTile} />
      ))}
    </View>
  );
}

export default function ListingSkeleton({ count = 4 }) {
  return (
    <View style={styles.container}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingTop: SPACING.sm },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.xl,
    overflow: 'hidden',
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  imagePlaceholder: { height: 210, backgroundColor: SHIMMER_DARK },
  body: { padding: 14 },
  lineTitle: { height: 14, borderRadius: 6, width: '84%', marginBottom: 10, backgroundColor: SHIMMER_DARK },
  linePrice: { height: 16, borderRadius: 7, width: '54%', marginBottom: 8, backgroundColor: SHIMMER_DARK },
  lineDate:  { height: 12, borderRadius: 5, width: '42%', backgroundColor: SHIMMER_DARK },
  profileContainer: { padding: SPACING.md },
  avatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: SHIMMER_DARK, marginBottom: SPACING.md },
  statsRow: { flexDirection: 'row', gap: SPACING.sm },
  statTile: { flex: 1, height: 64, borderRadius: BORDER_RADIUS.lg, backgroundColor: SHIMMER_DARK },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, padding: SPACING.md },
  adminStatTile: { width: '47%', height: 72, borderRadius: BORDER_RADIUS.lg, backgroundColor: SHIMMER_DARK },
});
