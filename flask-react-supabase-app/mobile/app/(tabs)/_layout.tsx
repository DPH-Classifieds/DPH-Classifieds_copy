// Tab shell. iOS gets the real native UITabBarController (Liquid Glass on iOS 26)
// via expo-router's NativeTabs — this native module ships inside Expo Go, so it
// works without a dev build. Android gets a custom floating glass tab bar
// (AndroidTabBar) with a sliding pill indicator + press animations. Route
// names below map to the sibling route groups in app/(tabs)/: (explore),
// (post), (saved), (profile).
import { Platform } from 'react-native';
import { Tabs } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import AndroidTabBar from '../../src/components/ui/AndroidTabBar';

export default function TabsLayout() {
  if (Platform.OS === 'ios') {
    return (
      <NativeTabs
        tintColor="#4CAF50"
        // iOS 26: collapse the bar to a compact pill on scroll-down.
        minimizeBehavior="onScrollDown"
      >
        <NativeTabs.Trigger name="(explore)">
          <NativeTabs.Trigger.Icon sf="safari.fill" />
          <NativeTabs.Trigger.Label>Explore</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="(post)">
          <NativeTabs.Trigger.Icon sf="plus.circle.fill" />
          <NativeTabs.Trigger.Label>Sell</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="(saved)">
          <NativeTabs.Trigger.Icon sf="heart.fill" />
          <NativeTabs.Trigger.Label>Saved</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="(profile)">
          <NativeTabs.Trigger.Icon sf="person.crop.circle.fill" />
          <NativeTabs.Trigger.Label>Profile</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      </NativeTabs>
    );
  }

  // Android fallback — custom floating pill tab bar (AndroidTabBar) with a
  // sliding active-pill indicator, icon press-scale, and haptics. Sits in
  // normal layout flow (not absolutely positioned) so TAB_BAR_CLEARANCE and
  // safe-area math elsewhere keep working unchanged.
  return (
    <Tabs
      tabBar={(props) => <AndroidTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen name="(explore)" options={{ title: 'Explore' }} />
      <Tabs.Screen name="(post)" options={{ title: 'Sell' }} />
      <Tabs.Screen name="(saved)" options={{ title: 'Saved' }} />
      <Tabs.Screen name="(profile)" options={{ title: 'Profile' }} />
    </Tabs>
  );
}
