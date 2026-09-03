// Expo Router root layout. Replaces App.js as the app entry (package.json main
// is now "expo-router/entry"). It re-creates the exact provider stack App.js
// had, then renders a headerless Stack whose only child is the (tabs) group —
// Expo Router owns the NavigationContainer, so we must NOT add our own.
import 'react-native-gesture-handler';
import React, { useEffect, useState } from 'react';
import { AppState, Pressable } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  useFonts,
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';
import Toast from 'react-native-toast-message';
import { PostHogProvider } from 'posthog-react-native';
import { posthog } from '../src/utils/posthogClient';
// Existing app code (JS) reused as-is.
import { AuthProvider } from '../src/context/AuthContext';
import { SavedListingsProvider } from '../src/context/SavedListingsContext';
import { ThemeProvider, useTheme } from '../src/context/ThemeContext';
import ErrorBoundary from '../src/components/ui/ErrorBoundary';
import { attachNotificationResponseHandler } from '../src/utils/pushNotifications';
import { trackMobilePlatformEvent } from '../src/utils/platformTracker';
import Sidebar from '../src/components/ui/Sidebar';
import { BORDER_RADIUS } from '../src/constants/theme';

// Anchor the root "/" match to the (tabs) group so cold start lands on the
// (explore) tab, not (auth)/index's Redirect-to-Login. Route groups are URL-
// transparent, so (auth)/(tabs) indexes all collide at "/"; without this the
// resolver picked (auth) by group order and forced Login on launch.
export const unstable_settings = { anchor: '(tabs)' };

export default function RootLayout() {
  // Route notification taps (warm + cold start) into the app. Uses the global
  // expo-router `router` internally, so no navigation ref is needed.
  useEffect(() => attachNotificationResponseHandler(), []);

  // Emit app_open / app_close so reminder timing can key off real usage (this is
  // also the only place app_open fires under Expo Router — the old AppNavigator
  // path is dead code).
  useEffect(() => {
    trackMobilePlatformEvent('app_open', { page_kind: 'app_open' });
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') {
        trackMobilePlatformEvent('app_close', { page_kind: 'app_close' });
      }
    });
    return () => sub.remove();
  }, []);

  // Brand typeface (DPHClassifieds Brand Kit). Gate the first render until the
  // faces are ready so text doesn't flash in the system font, then swap.
  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });
  if (!fontsLoaded && !fontError) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ErrorBoundary>
        <PostHogProvider
          client={posthog}
          autocapture={{ captureScreens: false, captureTouches: true }}
        >
          <ThemeProvider>
            <AuthProvider>
              <SavedListingsProvider>
                <AppShell />
                <Toast />
              </SavedListingsProvider>
            </AuthProvider>
          </ThemeProvider>
        </PostHogProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}

// Needs to render INSIDE ThemeProvider to read the current theme via
// useTheme() — the status bar's icon/text color is the inverse of the
// background (light icons need a dark bg and vice versa).
function AppShell() {
  const { theme } = useTheme();
  return (
    <>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(auth)" options={{ presentation: 'modal' }} />
      </Stack>
      <SidebarTrigger />
    </>
  );
}

// iOS doesn't expose a hamburger slot in the native tab bar, so we mount a
// small floating trigger in the top-left that opens the sidebar. Android gets
// the same trigger via AndroidTabBar's built-in hamburger. Cross-platform
// coverage without iOS-specific navigation code.
function SidebarTrigger() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open navigation menu"
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          triggerStyles.btn,
          {
            top: insets.top + 12,
            backgroundColor: pressed ? colors.surfaceHigh : colors.surface,
            borderColor: colors.border,
          },
        ]}
      >
        <Ionicons name="menu-outline" size={24} color={colors.textPrimary} />
      </Pressable>
      <Sidebar open={open} onClose={() => setOpen(false)} />
    </>
  );
}

const triggerStyles = {
  btn: {
    position: 'absolute',
    left: 16,
    width: 52,
    height: 52,
    borderRadius: BORDER_RADIUS.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
    elevation: 8,
  },
};