// Tab shell. iOS gets the real native UITabBarController (Liquid Glass on iOS 26)
// via expo-router's NativeTabs — this native module ships inside Expo Go, so it
// works without a dev build. Android uses the standard JS tab bar, styled dark
// with real icons to match the app. Route names below map to the sibling route
// groups in app/(tabs)/: (explore), (post), (saved), (profile).
import type { ComponentProps } from 'react';
import { Platform } from 'react-native';
import { Tabs } from 'expo-router';
import { NativeTabs, Icon, Label } from 'expo-router/unstable-native-tabs';
import { Ionicons } from '@expo/vector-icons';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

// tabBarIcon factory for the Android JS tabs.
const tabIcon = (name: IoniconName) => {
  const TabBarIcon = ({ color, size }: { color: string; size: number }) => (
    <Ionicons name={name} size={size} color={color} />
  );
  return TabBarIcon;
};

export default function TabsLayout() {
  if (Platform.OS === 'ios') {
    return (
      <NativeTabs
        tintColor="#4CAF50"
        // iOS 26: collapse the bar to a compact pill on scroll-down.
        minimizeBehavior="onScrollDown"
      >
        <NativeTabs.Trigger name="(explore)">
          <Icon sf="safari.fill" />
          <Label>Explore</Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="(post)">
          <Icon sf="plus.circle.fill" />
          <Label>Sell</Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="(saved)">
          <Icon sf="heart.fill" />
          <Label>Saved</Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="(profile)">
          <Icon sf="person.crop.circle.fill" />
          <Label>Profile</Label>
        </NativeTabs.Trigger>
      </NativeTabs>
    );
  }

  // Android fallback — standard JS tabs. Dark bar + real icons so it matches the
  // all-black app (react-navigation's default theme is light → white bar).
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#4CAF50',
        tabBarInactiveTintColor: 'rgba(255,255,255,0.45)',
        tabBarHideOnKeyboard: true,
        tabBarStyle: {
          backgroundColor: '#000',
          borderTopColor: 'rgba(255,255,255,0.08)',
        },
      }}
    >
      <Tabs.Screen name="(explore)" options={{ title: 'Explore', tabBarIcon: tabIcon('compass-outline') }} />
      <Tabs.Screen name="(post)" options={{ title: 'Sell', tabBarIcon: tabIcon('add-circle-outline') }} />
      <Tabs.Screen name="(saved)" options={{ title: 'Saved', tabBarIcon: tabIcon('heart-outline') }} />
      <Tabs.Screen name="(profile)" options={{ title: 'Profile', tabBarIcon: tabIcon('person-outline') }} />
    </Tabs>
  );
}
