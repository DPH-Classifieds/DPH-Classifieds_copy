// Expo Router root layout. Replaces App.js as the app entry (package.json main
// is now "expo-router/entry"). It re-creates the exact provider stack App.js
// had, then renders a headerless Stack whose only child is the (tabs) group —
// Expo Router owns the NavigationContainer, so we must NOT add our own.
import 'react-native-gesture-handler';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import Toast from 'react-native-toast-message';
import { PostHogProvider } from 'posthog-react-native';
import { posthog } from '../src/utils/posthogClient';
// Existing app code (JS) reused as-is.
import { AuthProvider } from '../src/context/AuthContext';
import { SavedListingsProvider } from '../src/context/SavedListingsContext';
import ErrorBoundary from '../src/components/ui/ErrorBoundary';
import { attachNotificationResponseHandler } from '../src/utils/pushNotifications';

// Anchor the root "/" match to the (tabs) group so cold start lands on the
// (explore) tab, not (auth)/index's Redirect-to-Login. Route groups are URL-
// transparent, so (auth)/(tabs) indexes all collide at "/"; without this the
// resolver picked (auth) by group order and forced Login on launch.
export const unstable_settings = { anchor: '(tabs)' };

export default function RootLayout() {
  // Route notification taps (warm + cold start) into the app. Uses the global
  // expo-router `router` internally, so no navigation ref is needed.
  useEffect(() => attachNotificationResponseHandler(), []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ErrorBoundary>
        <PostHogProvider
          client={posthog}
          autocapture={{ captureScreens: false, captureTouches: true }}
        >
          <AuthProvider>
            <SavedListingsProvider>
              <StatusBar style="light" />
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="(auth)" options={{ presentation: 'modal' }} />
              </Stack>
              <Toast />
            </SavedListingsProvider>
          </AuthProvider>
        </PostHogProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}
