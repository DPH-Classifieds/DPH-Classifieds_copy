import { Stack } from 'expo-router';
export default function PostStackLayout() {
  return (
    <Stack screenOptions={{
        headerStyle: { backgroundColor: '#000000' },
        headerTintColor: '#ffffff',
        headerTitleStyle: { fontWeight: '600' },
        contentStyle: { backgroundColor: '#000000' },
        animation: 'slide_from_right',
    }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="PostBuyingRequest" options={{ title: 'Post Buying Request' }} />
    </Stack>
  );
}
