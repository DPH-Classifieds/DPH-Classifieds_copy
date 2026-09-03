import React, { useMemo } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Text from './AppText';
import Animated, {
  useSharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { SPACING, FONT_SIZES } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
export const HEADER_HEIGHT = 280;
const COLLAPSE_THRESHOLD = 160;

export default function ParallaxHeader({
  images = [],
  title,
  scrollY,
  rightAction,
  onRightActionPress,
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => StyleSheet.create({
    parallaxContainer: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: HEADER_HEIGHT,
      overflow: 'hidden',
    },
    parallaxImage: {
      width: SCREEN_WIDTH,
      height: HEADER_HEIGHT,
    },
    placeholder: {
      backgroundColor: colors.surfaceHigher,
      alignItems: 'center',
      justifyContent: 'center',
    },
    overlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'black',
    },
    collapsedHeader: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: 56,
      backgroundColor: colors.black,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: SPACING.lg,
      zIndex: 10,
    },
    collapsedTitle: {
      color: colors.white,
      fontSize: FONT_SIZES.md,
      fontWeight: '600',
      flex: 1,
      textAlign: 'center',
    },
  }), [colors]);

  const imageStyle = useAnimatedStyle(() => {
    const translateY = interpolate(
      scrollY.value,
      [0, HEADER_HEIGHT],
      [0, HEADER_HEIGHT * 0.3],
      Extrapolation.CLAMP
    );
    const scale = interpolate(
      scrollY.value,
      [-100, 0],
      [1.5, 1],
      Extrapolation.CLAMP
    );
    return {
      transform: [{ translateY }, { scale }],
    };
  });

  const headerOpacity = useAnimatedStyle(() => {
    const opacity = interpolate(
      scrollY.value,
      [COLLAPSE_THRESHOLD - 20, COLLAPSE_THRESHOLD + 20],
      [0, 1],
      Extrapolation.CLAMP
    );
    return { opacity };
  });

  const overlayStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      scrollY.value,
      [0, 100],
      [0.3, 0.7],
      Extrapolation.CLAMP
    );
    return { opacity };
  });

  const currentImage = images[0];

  return (
    <>
      <Animated.View style={[styles.parallaxContainer, imageStyle]}>
        {currentImage ? (
          <Animated.Image
            source={{ uri: typeof currentImage === 'string' ? currentImage : currentImage.url || currentImage.image_url || currentImage.display_url }}
            style={styles.parallaxImage}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.parallaxImage, styles.placeholder]}>
            <Ionicons name="image-outline" size={48} color={colors.textMuted} />
          </View>
        )}
        <Animated.View style={[styles.overlay, overlayStyle]} />
      </Animated.View>

      <Animated.View style={[styles.collapsedHeader, headerOpacity]}>
        <Text style={styles.collapsedTitle} numberOfLines={1}>{title}</Text>
        {rightAction && (
          <Animated.View style={headerOpacity}>
            <Ionicons name={rightAction} size={22} color={colors.white} onPress={onRightActionPress} />
          </Animated.View>
        )}
      </Animated.View>
    </>
  );
}

export function ParallaxScrollView({ children, scrollY, contentContainerStyle, onScroll: onScrollProp, ...props }) {
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
      if (onScrollProp) onScrollProp(event);
    },
  });

  return (
    <Animated.ScrollView
      onScroll={scrollHandler}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[{ paddingTop: HEADER_HEIGHT }, contentContainerStyle]}
      {...props}
    >
      {children}
    </Animated.ScrollView>
  );
}
