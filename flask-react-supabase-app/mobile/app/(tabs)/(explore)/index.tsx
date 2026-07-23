import { useNavigation, useLocalSearchParams } from 'expo-router';
import ExploreScreen from '../../../src/screens/explore/ExploreScreen';

export default function ExploreRoute() {
  const navigation = useNavigation();
  const params = useLocalSearchParams();
  return <ExploreScreen navigation={navigation} route={{ params }} />;
}
