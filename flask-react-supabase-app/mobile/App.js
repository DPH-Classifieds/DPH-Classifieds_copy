import 'react-native-gesture-handler';
import React, { useState, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Toast from 'react-native-toast-message';
import { PostHogProvider } from 'posthog-react-native';
import { AuthProvider } from './src/context/AuthContext';
import { SavedListingsProvider } from './src/context/SavedListingsContext';
import AppNavigator from './src/navigation/AppNavigator';
import ErrorBoundary from './src/components/ui/ErrorBoundary';
import SplashIntro from './src/components/ui/SplashIntro';

export default function App() {
  const [introVisible, setIntroVisible] = useState(true);
  // Shared with AppNavigator's NavigationContainer; used by our own screen
  // tracking (onStateChange -> trackMobilePlatformEvent) and push-notification
  // deep-linking.
  const navigationRef = useRef(null);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ErrorBoundary>
        {/* captureScreens:false — PostHog's screen autocapture hook mounts
            above NavigationContainer, so its useNavigationState()/useNavigation()
            calls throw every render. We already track screen views ourselves via
            NavigationContainer's onStateChange, so this is pure redundant noise. */}
        <PostHogProvider
          apiKey={process.env.EXPO_PUBLIC_POSTHOG_API_KEY}
          options={{ host: process.env.EXPO_PUBLIC_POSTHOG_HOST }}
          autocapture={{ captureScreens: false, captureTouches: true }}
        >
          <AuthProvider>
            <SavedListingsProvider>
              <StatusBar style="light" />
              <AppNavigator navigationRef={navigationRef} />
              <Toast />
              {introVisible && <SplashIntro onFinish={() => setIntroVisible(false)} />}
            </SavedListingsProvider>
          </AuthProvider>
        </PostHogProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}
