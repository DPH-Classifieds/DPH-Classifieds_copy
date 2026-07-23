// Explore tab = a native stack so listing detail/list screens push ON TOP of the
// browse screen while the Liquid Glass tab bar stays put. Route names match the
// filenames, so the existing screens' navigation.navigate('CarDetail', {...})
// calls resolve here.
import { Stack } from 'expo-router';

export default function ExploreStackLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#000000' },
        headerTintColor: '#ffffff',
        headerTitleStyle: { fontWeight: '600' },
        contentStyle: { backgroundColor: '#000000' },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="CarList" options={{ title: 'Cars' }} />
      <Stack.Screen name="BikeList" options={{ title: 'Bikes' }} />
      <Stack.Screen name="PlateList" options={{ title: 'Plates' }} />
      <Stack.Screen name="PartList" options={{ title: 'Car Parts' }} />
      <Stack.Screen name="CarDetail" options={{ title: 'Car Listing' }} />
      <Stack.Screen name="BikeDetail" options={{ title: 'Bike Listing' }} />
      <Stack.Screen name="PlateDetail" options={{ title: 'Plate Listing' }} />
      <Stack.Screen name="PartDetail" options={{ title: 'Part Listing' }} />
      <Stack.Screen name="EditListing" options={{ title: 'Edit Listing' }} />
      <Stack.Screen name="BuyingRequests" options={{ title: 'Buying Requests' }} />
      <Stack.Screen name="BuyingRequestDetail" options={{ title: 'Request Detail' }} />
      <Stack.Screen name="PostBuyingRequest" options={{ title: 'Post Request' }} />
    </Stack>
  );
}
