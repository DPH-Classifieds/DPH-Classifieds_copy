import { useNavigation, useLocalSearchParams } from 'expo-router';
import Screen from '../../../src/screens/profile/TermsOfServiceScreen';

export default function TermsOfServiceRoute() {
  const navigation = useNavigation();
  const params = useLocalSearchParams();
  return <Screen navigation={navigation} route={{ params }} />;
}
