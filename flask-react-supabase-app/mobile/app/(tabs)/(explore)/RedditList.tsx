import { useNavigation, useLocalSearchParams } from 'expo-router';
import Screen from '../../../src/screens/listing/RedditListScreen';

export default function RedditListRoute() {
  const navigation = useNavigation();
  const params = useLocalSearchParams();
  return <Screen navigation={navigation} route={{ params }} />;
}
