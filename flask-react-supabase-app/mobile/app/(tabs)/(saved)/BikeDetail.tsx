import { useNavigation, useLocalSearchParams } from 'expo-router';
import ScreenComponent from '../../../src/screens/listing/BikeDetailScreen';
import type { ComponentType } from "react";
const LegacyScreen = ScreenComponent as ComponentType<any>;

export default function BikeDetailRoute() {
  const navigation = useNavigation();
  const params = useLocalSearchParams();
  return <LegacyScreen navigation={navigation} route={{ params }} />;
}
