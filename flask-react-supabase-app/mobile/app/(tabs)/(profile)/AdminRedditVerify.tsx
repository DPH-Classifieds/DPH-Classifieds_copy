import { useNavigation, useLocalSearchParams } from 'expo-router';
import Screen from '../../../src/screens/admin/AdminRedditVerifyScreen';

export default function AdminRedditVerifyRoute() {
  const navigation = useNavigation();
  const params = useLocalSearchParams();
  return <Screen navigation={navigation} route={{ params }} />;
}
