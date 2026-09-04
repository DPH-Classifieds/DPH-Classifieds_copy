import { useNavigation, useLocalSearchParams } from 'expo-router';
import ScreenComponent from '../../../src/screens/listing/PlateListScreen';
import type { ComponentType } from "react";
const LegacyScreen = ScreenComponent as ComponentType<any>;

export default function PlateListRoute() {
  const navigation = useNavigation();
  const params = useLocalSearchParams();
  return <LegacyScreen navigation={navigation} route={{ params }} />;
}
