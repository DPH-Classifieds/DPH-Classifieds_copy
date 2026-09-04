import { useNavigation, useLocalSearchParams } from 'expo-router';
import ScreenComponent from '../../../src/screens/profile/SettingsScreen';
import type { ComponentType } from "react";
const LegacyScreen = ScreenComponent as ComponentType<any>;

export default function SettingsRoute() {
  const navigation = useNavigation();
  const params = useLocalSearchParams();
  return <LegacyScreen navigation={navigation} route={{ params }} />;
}
