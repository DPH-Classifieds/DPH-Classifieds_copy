import { useNavigation, useLocalSearchParams } from 'expo-router';
import Screen from '../../../src/screens/listing/PostBuyingRequestScreen';

export default function PostBuyingRequestRoute() {
  const navigation = useNavigation();
  const params = useLocalSearchParams();
  return <Screen navigation={navigation} route={{ params }} />;
}
