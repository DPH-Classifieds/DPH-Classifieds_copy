import { Stack } from 'expo-router';
export default function ProfileStackLayout() {
  return (
    <Stack screenOptions={{
        headerStyle: { backgroundColor: '#000000' },
        headerTintColor: '#ffffff',
        headerTitleStyle: { fontWeight: '600' },
        contentStyle: { backgroundColor: '#000000' },
        animation: 'slide_from_right',
    }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="Settings" options={{ title: 'Settings' }} />
      <Stack.Screen name="MyListings" options={{ title: 'My Listings' }} />
      <Stack.Screen name="CarDetail" options={{ title: 'Car Listing' }} />
      <Stack.Screen name="BikeDetail" options={{ title: 'Bike Listing' }} />
      <Stack.Screen name="PlateDetail" options={{ title: 'Plate Listing' }} />
      <Stack.Screen name="PartDetail" options={{ title: 'Part Listing' }} />
      <Stack.Screen name="PrivacyPolicy" options={{ title: 'Privacy Policy' }} />
      <Stack.Screen name="TermsOfService" options={{ title: 'Terms of Service' }} />
      <Stack.Screen name="About" options={{ title: 'About' }} />
      <Stack.Screen name="VerifyPhone" options={{ title: 'Verify Phone' }} />
      <Stack.Screen name="EditListing" options={{ title: 'Edit Listing' }} />
      <Stack.Screen name="AdminDashboard" options={{ title: 'Admin' }} />
      <Stack.Screen name="AdminUsers" options={{ title: 'Users' }} />
      <Stack.Screen name="AdminListings" options={{ title: 'Listings' }} />
      <Stack.Screen name="AdminDealers" options={{ title: 'Dealers' }} />
      <Stack.Screen name="AdminReports" options={{ title: 'Reports' }} />
      <Stack.Screen name="AdminUserDetail" options={{ title: 'User Detail' }} />
      <Stack.Screen name="AdminListingDetail" options={{ title: 'Listing Detail' }} />
      <Stack.Screen name="AdminDealerDetail" options={{ title: 'Dealer Detail' }} />
      <Stack.Screen name="AdminMetrics" options={{ title: 'Metrics' }} />
      <Stack.Screen name="AdminExpiredListings" options={{ title: 'Expired & Deleted' }} />
      <Stack.Screen name="AdminTools" options={{ title: 'Operational Tools' }} />
      <Stack.Screen name="DealerDashboard" options={{ title: 'Dealer' }} />
      <Stack.Screen name="DealerLeads" options={{ title: 'Leads' }} />
      <Stack.Screen name="DealerLeadDetail" options={{ title: 'Lead Detail' }} />
    </Stack>
  );
}
