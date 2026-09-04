import { useNavigation, useLocalSearchParams } from 'expo-router';
import ScreenComponent from '../../src/screens/auth/CheckEmailScreen';
import type { ComponentType } from "react";
const LegacyScreen = ScreenComponent as ComponentType<any>;

export default function CheckEmailRoute() {
  const navigation = useNavigation();
  const params = useLocalSearchParams();
  return <LegacyScreen navigation={navigation} route={{ params }} />;
}
