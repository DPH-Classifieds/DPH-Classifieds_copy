// Explore tab = a native stack so listing detail/list screens push ON TOP of the
// browse screen while the Liquid Glass tab bar stays put. Route names match the
// filenames, so the existing screens' navigation.navigate('CarDetail', {...})
// calls resolve here.
import { Stack } from 'expo-router';
import { useTheme } from '../../../src/context/ThemeContext';

export default function ExploreStackLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: { fontWeight: '600' },
        // Chevron only, no previous-screen-name label (it showed "index") —
        // matches the icon-only back button every custom ListHeader uses.
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: colors.background },
        animation: 'slide_from_right',
        fullScreenGestureEnabled: true,
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      {/* List screens render their own compact header (back arrow + layout
          toggle) via ListHeader, so hide the native one — it showed an "index"
          back label and doubled the top inset. */}
      <Stack.Screen name="CarList" options={{ headerShown: false }} />
      <Stack.Screen name="BikeList" options={{ headerShown: false }} />
      <Stack.Screen name="PlateList" options={{ headerShown: false }} />
      <Stack.Screen name="PartList" options={{ headerShown: false }} />
      <Stack.Screen name="RedditList" options={{ headerShown: false }} />
      <Stack.Screen name="CarDetail" options={{ title: 'Car Listing' }} />
      <Stack.Screen name="BikeDetail" options={{ title: 'Bike Listing' }} />
      <Stack.Screen name="PlateDetail" options={{ title: 'Plate Listing' }} />
      <Stack.Screen name="PartDetail" options={{ title: 'Part Listing' }} />
      <Stack.Screen name="EditListing" options={{ title: 'Edit Listing' }} />
      {/* Renders its own back arrow + title + Post Request button, same as
          the List screens above — hide the native header so it isn't doubled. */}
      <Stack.Screen name="BuyingRequests" options={{ headerShown: false }} />
      <Stack.Screen name="BuyingRequestDetail" options={{ title: 'Request Detail' }} />
      <Stack.Screen name="PostBuyingRequest" options={{ title: 'Post Request' }} />
    </Stack>
  );
}
