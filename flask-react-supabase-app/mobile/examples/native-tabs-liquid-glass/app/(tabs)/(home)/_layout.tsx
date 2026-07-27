// Per-tab stack that gives the Home tab a transparent, blurred large-title
// header (Apple HIG). `headerTransparent: true` is what lets the scroll view
// render *behind* the bar so the system blur engages dynamically as you scroll;
// `headerBlurEffect` selects the native material.
import { Stack } from 'expo-router';

export default function HomeStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerTransparent: true,
        headerBlurEffect: 'systemChromeMaterial',
        headerLargeTitle: true,
        headerShadowVisible: false,
        headerTintColor: '#4CAF50',
        headerLargeTitleStyle: { color: '#ffffff' },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Home' }} />
    </Stack>
  );
}
