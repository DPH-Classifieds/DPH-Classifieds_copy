import React, { useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Dimensions,
  Animated,
  PanResponder,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, usePathname } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';
import { SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';

const TAB_NAV_ITEMS = [
  { key: '(explore)', label: 'Explore', icon: 'compass-outline', iconActive: 'compass', route: '/(explore)' },
  { key: '(post)', label: 'Sell', icon: 'add-circle-outline', iconActive: 'add-circle', route: '/(post)' },
  { key: '(saved)', label: 'Saved', icon: 'heart-outline', iconActive: 'heart', route: '/(saved)' },
  { key: '(profile)', label: 'Profile', icon: 'person-outline', iconActive: 'person', route: '/(profile)' },
];

const DRAWER_WIDTH = Math.min(360, Dimensions.get('window').width * 0.85);
const SWIPE_TO_CLOSE_THRESHOLD = 0.3;
const VELOCITY_TO_CLOSE = 0.4;

export default function Sidebar({ open, onClose, onSignOut }) {
  const { theme, colors, toggleTheme } = useTheme();
  const shellColors = theme === 'light'
    ? { ...colors, background: colors.chromeBackground, surface: colors.chromeSurface, textPrimary: colors.chromeText, textSecondary: colors.chromeMuted, border: colors.chromeBorder, line: colors.chromeBorderLight }
    : colors;
  const translateX = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    Animated.spring(translateX, {
      toValue: open ? 0 : -DRAWER_WIDTH,
      useNativeDriver: true,
      bounciness: 0,
      speed: 14,
    }).start();
  }, [open, translateX]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          open && Math.abs(gesture.dx) > 8 && Math.abs(gesture.dy) < Math.abs(gesture.dx),
        onPanResponderMove: (_, gesture) => {
          if (gesture.dx < 0) {
            translateX.setValue(Math.max(gesture.dx, -DRAWER_WIDTH));
          }
        },
        onPanResponderRelease: (_, gesture) => {
          const shouldClose =
            gesture.dx < 0 &&
            (Math.abs(gesture.dx) > DRAWER_WIDTH * SWIPE_TO_CLOSE_THRESHOLD ||
              gesture.vx < -VELOCITY_TO_CLOSE);
          if (shouldClose) {
            onClose();
          } else {
            Animated.spring(translateX, {
              toValue: 0,
              useNativeDriver: true,
              bounciness: 0,
              speed: 14,
            }).start();
          }
        },
      }),
    [open, onClose, translateX]
  );

  const isDark = theme === 'dark';
  const backdropOpacity = translateX.interpolate({
    inputRange: [-DRAWER_WIDTH, 0],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  return (
    <>
      <Animated.View
        pointerEvents={open ? 'auto' : 'none'}
        style={[styles.backdrop, { opacity: backdropOpacity }]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close navigation menu"
          onPress={onClose}
          style={styles.backdropPressable}
        />
      </Animated.View>

      <Animated.View
        accessibilityViewIsModal={open}
        style={[styles.drawer, { width: DRAWER_WIDTH, transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        <SafeAreaView edges={['top', 'bottom']} style={[styles.safe, { backgroundColor: shellColors.background }]}>
          <View style={styles.header}>
            <Text style={[styles.brand, { color: shellColors.textPrimary }]}>DPH Classifieds</Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close menu"
              hitSlop={12}
              style={styles.closeBtn}
            >
              <Ionicons name="close" size={26} color={shellColors.textPrimary} />
            </Pressable>
          </View>

          <View style={styles.navSection}>
            {TAB_NAV_ITEMS.map((item) => {
              const isActive = pathname ? pathname.includes(item.key) : false;
              const iconName = isActive ? item.iconActive : item.icon;
              return (
                <Pressable
                  key={item.key}
                  accessibilityRole="button"
                  accessibilityLabel={item.label}
                  accessibilityState={isActive ? { selected: true } : {}}
                  onPress={() => {
                    onClose();
                    router.push(item.route);
                  }}
                  style={({ pressed }) => [
                    styles.navItem,
                    { backgroundColor: pressed ? shellColors.surfaceHigh : 'transparent' },
                  ]}
                >
                  <Ionicons
                    name={iconName}
                    size={22}
                    color={isActive ? shellColors.accent : shellColors.textPrimary}
                  />
                  <Text
                    style={[
                      styles.navLabel,
                      { color: isActive ? shellColors.accent : shellColors.textPrimary },
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={[styles.divider, { backgroundColor: shellColors.line || shellColors.border }]} />

          <Pressable
            accessibilityRole="switch"
            accessibilityLabel={`Dark mode, currently ${isDark ? 'on' : 'off'}`}
            accessibilityState={{ checked: isDark }}
            onPress={() => toggleTheme()}
            style={({ pressed }) => [
              styles.themeToggle,
              { backgroundColor: pressed ? shellColors.surfaceHigh : shellColors.surface, borderColor: shellColors.border, borderWidth: 1 },
            ]}
          >
            <Ionicons
              name={isDark ? 'sunny-outline' : 'moon-outline'}
              size={22}
              color={shellColors.accent}
            />
            <Text style={[styles.themeToggleLabel, { color: shellColors.textPrimary }]}>
              {isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            </Text>
          </Pressable>

          {onSignOut && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sign out"
              onPress={() => {
                onClose();
                onSignOut();
              }}
              style={styles.signOut}
            >
              <Ionicons name="log-out-outline" size={22} color={colors.error} />
              <Text style={[styles.signOutLabel, { color: colors.error }]}>Sign Out</Text>
            </Pressable>
          )}
        </SafeAreaView>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    zIndex: 998,
  },
  backdropPressable: { flex: 1 },
  drawer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    zIndex: 999,
    backgroundColor: 'transparent',
  },
  safe: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  brand: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  closeBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: BORDER_RADIUS.pill,
  },
  navSection: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    height: 48,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: 4,
  },
  navLabel: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
  },
  divider: {
    height: 1,
    marginHorizontal: SPACING.lg,
    marginVertical: SPACING.sm,
  },
  themeToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    height: 48,
    paddingHorizontal: SPACING.lg,
    marginHorizontal: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
  },
  themeToggleLabel: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
  },
  signOut: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    height: 48,
    paddingHorizontal: SPACING.lg,
    marginHorizontal: SPACING.sm,
    marginTop: 'auto',
    borderRadius: BORDER_RADIUS.md,
  },
  signOutLabel: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
  },
});
