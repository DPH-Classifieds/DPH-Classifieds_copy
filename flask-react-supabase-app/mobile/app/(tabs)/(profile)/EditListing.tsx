import { useNavigation, useLocalSearchParams } from 'expo-router';
import Screen from '../../../src/screens/listing/PostListingScreen';

export default function EditListingRoute() {
  const navigation = useNavigation();
  const params = useLocalSearchParams();
  return <Screen navigation={navigation} route={{ params }} />;
}
