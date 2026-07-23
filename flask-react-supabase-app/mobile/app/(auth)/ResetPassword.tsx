import { useNavigation, useLocalSearchParams } from 'expo-router';
import Screen from '../../src/screens/auth/ResetPasswordScreen';

export default function ResetPasswordRoute() {
  const navigation = useNavigation();
  const params = useLocalSearchParams();
  return <Screen navigation={navigation} route={{ params }} />;
}
