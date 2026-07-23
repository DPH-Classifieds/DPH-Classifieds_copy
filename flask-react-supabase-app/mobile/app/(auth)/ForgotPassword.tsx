import { useNavigation, useLocalSearchParams } from 'expo-router';
import Screen from '../../src/screens/auth/ForgotPasswordScreen';

export default function ForgotPasswordRoute() {
  const navigation = useNavigation();
  const params = useLocalSearchParams();
  return <Screen navigation={navigation} route={{ params }} />;
}
