import { useNavigation, useLocalSearchParams } from 'expo-router';
import Screen from '../../src/screens/auth/SignupScreen';

export default function SignupRoute() {
  const navigation = useNavigation();
  const params = useLocalSearchParams();
  return <Screen navigation={navigation} route={{ params }} />;
}
