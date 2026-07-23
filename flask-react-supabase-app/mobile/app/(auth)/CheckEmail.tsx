import { useNavigation, useLocalSearchParams } from 'expo-router';
import Screen from '../../src/screens/auth/CheckEmailScreen';

export default function CheckEmailRoute() {
  const navigation = useNavigation();
  const params = useLocalSearchParams();
  return <Screen navigation={navigation} route={{ params }} />;
}
