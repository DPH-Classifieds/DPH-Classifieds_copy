import { Stack } from 'expo-router';
export default function SavedStackLayout() {
  return (
    <Stack screenOptions={{
        headerStyle: { backgroundColor: '#000000' },
        headerTintColor: '#ffffff',
        headerTitleStyle: { fontWeight: '600' },
        contentStyle: { backgroundColor: '#000000' },
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
