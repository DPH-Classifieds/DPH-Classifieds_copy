import { useNavigation, useLocalSearchParams } from 'expo-router';
import Screen from '../../../src/screens/profile/PrivacyPolicyScreen';

export default function PrivacyPolicyRoute() {
  const navigation = useNavigation();
  const params = useLocalSearchParams();
  return <Screen navigation={navigation} route={{ params }} />;
}
