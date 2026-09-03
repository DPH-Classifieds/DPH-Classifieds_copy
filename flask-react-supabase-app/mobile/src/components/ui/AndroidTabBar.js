import React, { useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Text from './AppText';
import Sidebar from './Sidebar';
import { FONTS, FONT_SIZES, BORDER_RADIUS, SPACING } from '../../constants/theme';
import { SPRING_FAST, SPRING_NORMAL } from '../../constants/motion';
import { useTheme } from '../../context/ThemeContext';

// route group name -> icon/label. Mirrors the (explore)/(post)/(saved)/(profile)
// groups wired in app/(tabs)/_layout.tsx and the iOS NativeTabs labels.
const TAB_META = {
  '(explore)': { label: 'Explore', outline: 'compass-outline', filled: 'compass' },
  '(post)': { label: 'Sell', outline: 'add-circle-outline', filled: 'add-circle' },
  '(saved)': { label: 'Saved', outline: 'heart-outline', filled: 'heart' },
  '(profile)': { label: 'Profile', outline: 'person-outline', filled: 'person' },
};

function TabButton({ route, isFocused, onPress, onLongPress }) {
  const { colors } = useTheme();
  const meta = TAB_META[route.name] || { label: route.name, outline: 'ellipse-outline', filled: 'ellipse' };
  const scale = useSharedValue(1);
  const iconStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={isFocused ? { selected: true } : {}}
      accessibilityLabel={meta.label}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={() => { scale.value = withSpring(0.85, SPRING_FAST); }}
      onPressOut={() => { scale.value = withSpring(1, SPRING_FAST); }}
      style={styles.tab}
    >
      <Animated.View style={iconStyle}>
        <Ionicons
          name={isFocused ? meta.filled : meta.outline}
          size={24}
          color={isFocused ? colors.accent : colors.textMuted}
        />
      </Animated.View>
      <Text style={[styles.label, { color: isFocused ? colors.accent : colors.textMuted }]}>
        {meta.label}
      </Text>
    </Pressable>
  );
}

export default function AndroidTabBar({ state, descriptors, navigation, insets }) {
  const { theme, colors } = useTheme();
  const [barWidth, setBarWidth] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const tabWidth = barWidth / state.routes.length;
  const pillX = useSharedValue(0);

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pillX.value }],
    width: tabWidth > 0 ? tabWidth - 12 : 0,
  }));

  const barBg = theme === 'dark' ? 'rgba(7,17,11,0.55)' : 'rgba(255,255,255,0.65)';
  const pillBg = theme === 'dark' ? 'rgba(139,214,180,0.16)' : 'rgba(11,107,76,0.12)';

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      <View style={styles.barRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open navigation menu"
          onPress={() => {
            Haptics.selectionAsync();
            setSidebarOpen(true);
          }}
          style={({ pressed }) => [
            styles.hamburgerBtn,
            { backgroundColor: pressed ? colors.surfaceHigh : barBg, borderColor: colors.border },
          ]}
        >
          <Ionicons name="menu-outline" size={24} color={colors.textPrimary} />
        </Pressable>
        <BlurView intensity={40} tint={theme === 'dark' ? 'dark' : 'light'} style={[styles.bar, { borderColor: colors.border, backgroundColor: barBg }, { marginLeft: SPACING.sm }]}>
          <View
            style={styles.row}
            onLayout={(e) => {
              const w = e.nativeEvent.layout.width;
              setBarWidth(w);
              pillX.value = (w / state.routes.length) * state.index + 6;
            }}
          >
            {tabWidth > 0 && (
              <Animated.View
                style={[styles.pill, pillStyle, { backgroundColor: pillBg, borderColor: colors.border }]}
                pointerEvents="none"
              />
            )}
            {state.routes.map((route, index) => {
              const isFocused = state.index === index;

              const onPress = () => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!isFocused && !event.defaultPrevented) {
                  Haptics.selectionAsync();
                  pillX.value = withSpring(tabWidth * index + 6, SPRING_NORMAL);
                  navigation.navigate(route.name);
                }
              };

              const onLongPress = () => {
                navigation.emit({ type: 'tabLongPress', target: route.key });
              };

              return (
                <TabButton
                  key={route.key}
                  route={route}
                  isFocused={isFocused}
                  onPress={onPress}
                  onLongPress={onLongPress}
                />
              );
            })}
          </View>
        </BlurView>
      </View>
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 12,
    paddingTop: 8,
    backgroundColor: 'transparent',
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  hamburgerBtn: {
    width: 52,
    height: 52,
    borderRadius: BORDER_RADIUS.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bar: {
    height: 60,
    borderRadius: BORDER_RADIUS.pill,
    borderWidth: 1,
    overflow: 'hidden',
    // borderColor/backgroundColor come from the theme, applied inline (see render).
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  pill: {
    position: 'absolute',
    left: 0,
    top: 6,
    bottom: 6,
    borderRadius: BORDER_RADIUS.pill,
    borderWidth: 1,
    // borderColor/backgroundColor come from the theme, applied inline (see render).
  },
  tab: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  label: {
    ...FONTS.medium,
    fontSize: FONT_SIZES.xs,
  },
});
