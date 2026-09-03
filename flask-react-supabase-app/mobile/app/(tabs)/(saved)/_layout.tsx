import { Stack } from 'expo-router';
import { useTheme } from '../../../src/context/ThemeContext';
export default function SavedStackLayout() {
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
      <Stack.Screen name="CarDetail" options={{ title: 'Car Listing' }} />
      <Stack.Screen name="BikeDetail" options={{ title: 'Bike Listing' }} />
      <Stack.Screen name="PlateDetail" options={{ title: 'Plate Listing' }} />
      <Stack.Screen name="PartDetail" options={{ title: 'Part Listing' }} />
      <Stack.Screen name="EditListing" options={{ title: 'Edit Listing' }} />
    </Stack>
  );
}
