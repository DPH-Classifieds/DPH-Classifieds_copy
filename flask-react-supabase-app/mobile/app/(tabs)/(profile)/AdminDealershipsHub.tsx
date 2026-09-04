import { useNavigation } from 'expo-router';
import ScreenComponent from '../../../src/screens/admin/AdminDealershipsHubScreen';
import type { ComponentType } from "react";
const LegacyScreen = ScreenComponent as ComponentType<any>;

export default function AdminDealershipsHubRoute() {
  const navigation = useNavigation();
  return <LegacyScreen navigation={navigation} />;
}
