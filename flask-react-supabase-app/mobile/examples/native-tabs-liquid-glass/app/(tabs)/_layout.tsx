// Native iOS tab bar backed by react-native-screens' real UITabBarController.
// Because the bar is genuine OS chrome (not a JS BlurView approximation), iOS 26
// renders it with the system "Liquid Glass" material automatically and blurs
// whatever content scrolls beneath it — no manual blur, no absolute positioning.
// Constraint of the native layout: triggers accept SF Symbol icons + text labels
// only, never arbitrary React components.
import { NativeTabs, Icon, Label } from 'expo-router/unstable-native-tabs';

export default function TabsLayout() {
  return (
    <NativeTabs
      // Accent for the selected tab. The translucent glass material itself is
      // owned by the OS and cannot be set/faked from JS.
      tintColor="#4CAF50"
      // iOS 26: collapse the bar into a compact pill on scroll-down and restore
      // it on scroll-up, matching Apple's first-party apps.
      minimizeBehavior="onScrollDown"
    >
      {/* `name` maps to the route/group folder under app/(tabs)/. */}
      <NativeTabs.Trigger name="(home)">
        <Icon sf="house.fill" />
        <Label>Home</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="explore">
        <Icon sf="safari.fill" />
        <Label>Explore</Label>
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="profile">
        <Icon sf="person.crop.circle.fill" />
        <Label>Profile</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
