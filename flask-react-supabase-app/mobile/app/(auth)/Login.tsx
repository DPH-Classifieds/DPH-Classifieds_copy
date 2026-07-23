import { useNavigation, useLocalSearchParams } from 'expo-router';
import Screen from '../../src/screens/auth/LoginScreen';

export default function LoginRoute() {
  const navigation = useNavigation();
  const params = useLocalSearchParams();
  return <Screen navigation={navigation} route={{ params }} />;
}
