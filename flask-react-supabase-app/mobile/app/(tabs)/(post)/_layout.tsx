import { Stack } from 'expo-router';
import { useTheme } from '../../../src/context/ThemeContext';
export default function PostStackLayout() {
  const { colors } = useTheme();
  return (
    <Stack screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: { fontWeight: '600' },
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: colors.background },
        animation: 'slide_from_right',
    }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="PostBuyingRequest" options={{ title: 'Post Buying Request' }} />
    </Stack>
  );
}
