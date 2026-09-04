import { useNavigation, useLocalSearchParams } from 'expo-router';
import ScreenComponent from '../../src/screens/auth/ResetPasswordScreen';
import type { ComponentType } from "react";
const LegacyScreen = ScreenComponent as ComponentType<any>;

export default function ResetPasswordRoute() {
  const navigation = useNavigation();
  const params = useLocalSearchParams();
  return <LegacyScreen navigation={navigation} route={{ params }} />;
}
