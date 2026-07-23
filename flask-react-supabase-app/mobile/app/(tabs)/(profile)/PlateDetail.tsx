import { useNavigation, useLocalSearchParams } from 'expo-router';
import Screen from '../../../src/screens/listing/PlateDetailScreen';

export default function PlateDetailRoute() {
  const navigation = useNavigation();
  const params = useLocalSearchParams();
  return <Screen navigation={navigation} route={{ params }} />;
}
