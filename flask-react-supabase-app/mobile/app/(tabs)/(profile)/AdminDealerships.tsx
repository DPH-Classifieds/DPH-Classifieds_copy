import { useNavigation, useLocalSearchParams } from 'expo-router';
import Screen from '../../../src/screens/admin/AdminDealershipsScreen';

export default function AdminDealershipsRoute() {
  const navigation = useNavigation();
  const params = useLocalSearchParams();
  return <Screen navigation={navigation} route={{ params }} />;
}
