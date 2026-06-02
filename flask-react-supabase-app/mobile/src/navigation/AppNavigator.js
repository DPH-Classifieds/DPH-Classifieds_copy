import React, { useRef, useMemo } from 'react';
import { View } from 'react-native';
import { NavigationContainer, useNavigation } from '@react-navigation/native';
import { buildNavigationStateChangeHandler } from '../utils/platformTracker';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import RequireAuth from '../components/ui/RequireAuth';

import LoginScreen from '../screens/auth/LoginScreen';
import SignupScreen from '../screens/auth/SignupScreen';
import ForgotPasswordScreen from '../screens/auth/ForgotPasswordScreen';
import ResetPasswordScreen from '../screens/auth/ResetPasswordScreen';
import VerifyPhoneScreen from '../screens/auth/VerifyPhoneScreen';
import CheckEmailScreen from '../screens/auth/CheckEmailScreen';

import ExploreScreen from '../screens/explore/ExploreScreen';
import CarDetailScreen from '../screens/listing/CarDetailScreen';
import BikeDetailScreen from '../screens/listing/BikeDetailScreen';
import PlateDetailScreen from '../screens/listing/PlateDetailScreen';
import PartDetailScreen from '../screens/listing/PartDetailScreen';
import PostListingScreen from '../screens/listing/PostListingScreen';
import CarListScreen from '../screens/listing/CarListScreen';
import BikeListScreen from '../screens/listing/BikeListScreen';
import PlateListScreen from '../screens/listing/PlateListScreen';
import PartListScreen from '../screens/listing/PartListScreen';
import SavedScreen from '../screens/profile/SavedScreen';
import ProfileScreen from '../screens/profile/ProfileScreen';
import SettingsScreen from '../screens/profile/SettingsScreen';
import MyListingsScreen from '../screens/profile/MyListingsScreen';
import PrivacyPolicyScreen from '../screens/profile/PrivacyPolicyScreen';
import TermsOfServiceScreen from '../screens/profile/TermsOfServiceScreen';
import AboutScreen from '../screens/profile/AboutScreen';

import AdminDashboardScreen from '../screens/admin/AdminDashboardScreen';
import AdminUsersScreen from '../screens/admin/AdminUsersScreen';
import AdminListingsScreen from '../screens/admin/AdminListingsScreen';
import AdminDealersScreen from '../screens/admin/AdminDealersScreen';
import AdminReportsScreen from '../screens/admin/AdminReportsScreen';
import AdminUserDetailScreen from '../screens/admin/AdminUserDetailScreen';
import AdminListingDetailScreen from '../screens/admin/AdminListingDetailScreen';
import AdminDealerDetailScreen from '../screens/admin/AdminDealerDetailScreen';
import AdminMetricsScreen from '../screens/admin/AdminMetricsScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const screenOptions = {
  headerStyle: { backgroundColor: '#000000' },
  headerTintColor: '#ffffff',
  headerTitleStyle: { fontWeight: '600', fontSize: 17 },
  contentStyle: { backgroundColor: '#000000' },
  animation: 'slide_from_right',
};

function AuthStack() {
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Signup" component={SignupScreen} options={{ headerShown: false }} />
      <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} options={{ title: 'Reset Password' }} />
      <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} options={{ title: 'Reset Password' }} />
      <Stack.Screen name="CheckEmail" component={CheckEmailScreen} options={{ title: 'Verify Email' }} />
    </Stack.Navigator>
  );
}

function ExploreStack() {
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen name="ExploreMain" component={ExploreScreen} options={{ headerShown: false }} />
      <Stack.Screen name="CarList" component={CarListScreen} options={{ title: 'Cars' }} />
      <Stack.Screen name="BikeList" component={BikeListScreen} options={{ title: 'Bikes' }} />
      <Stack.Screen name="PlateList" component={PlateListScreen} options={{ title: 'Plates' }} />
      <Stack.Screen name="PartList" component={PartListScreen} options={{ title: 'Car Parts' }} />
      <Stack.Screen name="CarDetail" component={CarDetailScreen} options={{ title: 'Car Listing', headerBackTitle: 'Explore' }} />
      <Stack.Screen name="BikeDetail" component={BikeDetailScreen} options={{ title: 'Bike Listing', headerBackTitle: 'Explore' }} />
      <Stack.Screen name="PlateDetail" component={PlateDetailScreen} options={{ title: 'Plate Listing', headerBackTitle: 'Explore' }} />
      <Stack.Screen name="PartDetail" component={PartDetailScreen} options={{ title: 'Part Listing', headerBackTitle: 'Explore' }} />
      <Stack.Screen name="EditListing" component={PostListingScreen} options={{ title: 'Edit Listing' }} />
    </Stack.Navigator>
  );
}

function PostStack() {
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen name="PostListing" component={PostListingScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}

function SavedStack() {
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen name="SavedMain" component={SavedScreen} options={{ headerShown: false }} />
      <Stack.Screen name="CarList" component={CarListScreen} options={{ title: 'Cars' }} />
      <Stack.Screen name="BikeList" component={BikeListScreen} options={{ title: 'Bikes' }} />
      <Stack.Screen name="PlateList" component={PlateListScreen} options={{ title: 'Plates' }} />
      <Stack.Screen name="PartList" component={PartListScreen} options={{ title: 'Car Parts' }} />
      <Stack.Screen name="CarDetail" component={CarDetailScreen} options={{ title: 'Car Listing', headerBackTitle: 'Saved' }} />
      <Stack.Screen name="BikeDetail" component={BikeDetailScreen} options={{ title: 'Bike Listing', headerBackTitle: 'Saved' }} />
      <Stack.Screen name="PlateDetail" component={PlateDetailScreen} options={{ title: 'Plate Listing', headerBackTitle: 'Saved' }} />
      <Stack.Screen name="PartDetail" component={PartDetailScreen} options={{ title: 'Part Listing', headerBackTitle: 'Saved' }} />
    </Stack.Navigator>
  );
}

function ProfileStack() {
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen name="ProfileMain" component={ProfileScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
      <Stack.Screen name="MyListings" component={MyListingsScreen} options={{ title: 'My Listings' }} />
      <Stack.Screen name="PrivacyPolicy" component={PrivacyPolicyScreen} options={{ title: 'Privacy Policy' }} />
      <Stack.Screen name="TermsOfService" component={TermsOfServiceScreen} options={{ title: 'Terms of Service' }} />
      <Stack.Screen name="AdminDashboard" component={AdminDashboardScreen} options={{ title: 'Admin' }} />
      <Stack.Screen name="AdminUsers" component={AdminUsersScreen} options={{ title: 'Users' }} />
      <Stack.Screen name="AdminListings" component={AdminListingsScreen} options={{ title: 'Listings' }} />
      <Stack.Screen name="AdminDealers" component={AdminDealersScreen} options={{ title: 'Dealers' }} />
      <Stack.Screen name="AdminReports" component={AdminReportsScreen} options={{ title: 'Reports' }} />
      <Stack.Screen name="AdminUserDetail" component={AdminUserDetailScreen} options={{ title: 'User Detail' }} />
      <Stack.Screen name="AdminListingDetail" component={AdminListingDetailScreen} options={{ title: 'Listing Detail' }} />
      <Stack.Screen name="AdminDealerDetail" component={AdminDealerDetailScreen} options={{ title: 'Dealer Detail' }} />
      <Stack.Screen name="AdminMetrics" component={AdminMetricsScreen} options={{ title: 'Metrics' }} />
      <Stack.Screen name="About" component={AboutScreen} options={{ title: 'About' }} />
      <Stack.Screen name="VerifyPhone" component={VerifyPhoneScreen} options={{ title: 'Verify Phone' }} />
      <Stack.Screen name="EditListing" component={PostListingScreen} options={{ title: 'Edit Listing' }} />
    </Stack.Navigator>
  );
}

function AuthGatePostStack() {
  const navigation = useNavigation();
  return (
    <RequireAuth navigation={navigation} redirectRoute="Post">
      <PostStack />
    </RequireAuth>
  );
}

function AuthGateSavedStack() {
  const navigation = useNavigation();
  return (
    <RequireAuth navigation={navigation} redirectRoute="Saved">
      <SavedStack />
    </RequireAuth>
  );
}

function AuthGateProfileStack() {
  const navigation = useNavigation();
  return (
    <RequireAuth navigation={navigation} redirectRoute="Profile">
      <ProfileStack />
    </RequireAuth>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#000000',
          borderTopColor: 'rgba(255,255,255,0.15)',
          borderTopWidth: 0.5,
          paddingBottom: 8,
          paddingTop: 8,
          height: 60,
        },
        tabBarActiveTintColor: '#4CAF50',
        tabBarInactiveTintColor: 'rgba(255,255,255,0.4)',
        tabBarIcon: ({ focused, color, size }) => {
          let iconName;
          if (route.name === 'Explore') iconName = focused ? 'compass' : 'compass-outline';
          else if (route.name === 'Post') iconName = focused ? 'add-circle' : 'add-circle-outline';
          else if (route.name === 'Saved') iconName = focused ? 'heart' : 'heart-outline';
          else if (route.name === 'Profile') iconName = focused ? 'person' : 'person-outline';
          return <Ionicons name={iconName} size={24} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Explore" component={ExploreStack} options={{ tabBarLabel: 'Explore' }} />
      <Tab.Screen name="Post" component={AuthGatePostStack} options={{ tabBarLabel: 'Sell' }} />
      <Tab.Screen name="Saved" component={AuthGateSavedStack} options={{ tabBarLabel: 'Saved' }} />
      <Tab.Screen name="Profile" component={AuthGateProfileStack} options={{ tabBarLabel: 'Profile' }} />
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  const { isLoading } = useAuth();
  const navigationRef = useRef(null);
  const handleStateChange = useMemo(
    () => buildNavigationStateChangeHandler(navigationRef),
    []
  );

  if (isLoading) {
    return <LoadingSpinner message="Loading..." />;
  }

  return (
    <NavigationContainer ref={navigationRef} onStateChange={handleStateChange}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Main" component={MainTabs} />
        <Stack.Screen
          name="Auth"
          component={AuthStack}
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
