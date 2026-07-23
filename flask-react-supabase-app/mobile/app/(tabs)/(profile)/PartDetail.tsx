import { useNavigation, useLocalSearchParams } from 'expo-router';
import Screen from '../../../src/screens/listing/PartDetailScreen';

export default function PartDetailRoute() {
  const navigation = useNavigation();
  const params = useLocalSearchParams();
  return <Screen navigation={navigation} route={{ params }} />;
}
