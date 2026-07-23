import { useNavigation, useLocalSearchParams } from 'expo-router';
import Screen from '../../../src/screens/profile/AboutScreen';

export default function AboutRoute() {
  const navigation = useNavigation();
  const params = useLocalSearchParams();
  return <Screen navigation={navigation} route={{ params }} />;
}
