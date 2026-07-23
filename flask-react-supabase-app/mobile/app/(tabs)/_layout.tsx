// Tab shell. iOS gets the real native UITabBarController (Liquid Glass on iOS 26)
// via expo-router's NativeTabs — this native module ships inside Expo Go, so it
// works without a dev build. Android keeps the standard JS tab bar for now
// (icons/polish to follow). Route names below map to the sibling files in
// app/(tabs)/: index.tsx, post.tsx, saved.tsx, profile.tsx.
import { Platform } from 'react-native';
import { Tabs } from 'expo-router';
import { NativeTabs, Icon, Label } from 'expo-router/unstable-native-tabs';

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

  // Android fallback — standard JS tabs.
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: '#4CAF50' }}>
      <Tabs.Screen name="(explore)" options={{ title: 'Explore' }} />
      <Tabs.Screen name="(post)" options={{ title: 'Sell' }} />
      <Tabs.Screen name="(saved)" options={{ title: 'Saved' }} />
      <Tabs.Screen name="(profile)" options={{ title: 'Profile' }} />
    </Tabs>
  );
}
