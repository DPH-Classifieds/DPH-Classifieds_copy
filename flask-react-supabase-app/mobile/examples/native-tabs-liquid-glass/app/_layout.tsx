// Root stack. The (tabs) group owns the native Liquid Glass tab bar *and* each
// tab's own header, so the root stack itself stays headerless — it exists only
// to host the tab group (and could later host modals / auth screens as siblings).
import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}
