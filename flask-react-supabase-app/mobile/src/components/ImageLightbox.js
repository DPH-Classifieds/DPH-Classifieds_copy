import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Dimensions, TouchableOpacity, Modal, FlatList } from 'react-native';
import Text from './ui/AppText';
import { Image } from 'expo-image';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 800;

/**
 * Full-screen photo viewer: swipe the picture up or down to dismiss (it follows
 * your finger while the backdrop fades), swipe left/right to page, or tap the X.
 * Built on the same reanimated + gesture-handler stack as BottomSheet — no new
 * deps — so it behaves identically on iOS and Android.
 *
 * Props: images (string[]), visible (bool), initialIndex (number), onClose ().
 */
export default function ImageLightbox({ images = [], visible, initialIndex = 0, onClose }) {
  const translateY = useSharedValue(0);
  const opened = useSharedValue(0);
  const [index, setIndex] = useState(initialIndex);
  const listRef = useRef(null);
  const closingRef = useRef(false);

  useEffect(() => {
    if (visible) {
      closingRef.current = false;
      setIndex(initialIndex);
      translateY.value = 0;
      opened.value = withTiming(1, { duration: 220 });
    }
  }, [visible, initialIndex]);

  const dismiss = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (_e) {
      // haptics are best-effort
    }
    // Let the fling animation play before the parent unmounts the Modal.
    setTimeout(onClose, 160);
  };

  const pan = Gesture.Pan()
    // Only own clear vertical drags; horizontal drags fall through to paging.
    .activeOffsetY([-14, 14])
    .failOffsetX([-18, 18])
    .onUpdate((event) => {
      translateY.value = event.translationY;
    })
    .onEnd((event) => {
      if (Math.abs(translateY.value) > DISMISS_DISTANCE || Math.abs(event.velocityY) > DISMISS_VELOCITY) {
        const dir = (translateY.value || event.velocityY) < 0 ? -1 : 1;
        translateY.value = withTiming(dir * SCREEN_HEIGHT, { duration: 220 });
        opened.value = withTiming(0, { duration: 180 });
        runOnJS(dismiss)();
      } else {
        translateY.value = withSpring(0, { damping: 22, stiffness: 240 });
      }
    });

  const backdropStyle = useAnimatedStyle(() => {
    const drag = Math.min(Math.abs(translateY.value) / 300, 1);
    return { opacity: opened.value * (1 - drag) };
  });

  const containerStyle = useAnimatedStyle(() => {
    const shrink = Math.min(Math.abs(translateY.value) / 900, 0.12);
    return {
      opacity: opened.value,
      transform: [
        { translateY: translateY.value },
        { scale: 0.94 + 0.06 * opened.value - shrink },
      ],
    };
  });

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={dismiss}>
      <GestureHandlerRootView style={styles.root}>
        <Animated.View style={[styles.backdrop, backdropStyle]} pointerEvents="none" />

        <GestureDetector gesture={pan}>
          <Animated.View style={[styles.root, containerStyle]}>
            <FlatList
              ref={listRef}
              data={images}
              horizontal
              pagingEnabled
              initialScrollIndex={initialIndex}
              getItemLayout={(_, i) => ({ length: SCREEN_WIDTH, offset: SCREEN_WIDTH * i, index: i })}
              keyExtractor={(uri, i) => `${uri}-${i}`}
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) => {
                setIndex(Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH));
              }}
              renderItem={({ item }) => (
                <View style={styles.page}>
                  <Image source={{ uri: item }} style={styles.image} contentFit="contain" transition={150} />
                </View>
              )}
            />
          </Animated.View>
        </GestureDetector>

        {/* Chrome stays fixed and tappable, outside the drag gesture. */}
        <SafeAreaView style={styles.chrome} pointerEvents="box-none">
          <View style={styles.chromeRow} pointerEvents="box-none">
            {images.length > 1 ? (
              <Text style={styles.counter}>{index + 1} / {images.length}</Text>
            ) : (
              <View />
            )}
            <TouchableOpacity
              style={styles.close}
              onPress={dismiss}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons name="close" size={26} color="#fff" />
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },
  page: { width: SCREEN_WIDTH, height: SCREEN_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  image: { width: SCREEN_WIDTH, height: SCREEN_HEIGHT * 0.86 },
  chrome: { ...StyleSheet.absoluteFillObject },
  chromeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  counter: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    overflow: 'hidden',
  },
  close: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
});
