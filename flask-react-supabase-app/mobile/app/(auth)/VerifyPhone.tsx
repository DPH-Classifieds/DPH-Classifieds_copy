import { useNavigation, useLocalSearchParams } from 'expo-router';
import Screen from '../../src/screens/auth/VerifyPhoneScreen';

export default function VerifyPhoneRoute() {
  const navigation = useNavigation();
  const params = useLocalSearchParams();
  return <Screen navigation={navigation} route={{ params }} />;
}
