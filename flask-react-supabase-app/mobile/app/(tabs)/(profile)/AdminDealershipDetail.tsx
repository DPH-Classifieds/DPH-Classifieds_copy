import { useNavigation, useLocalSearchParams } from 'expo-router';
import Screen from '../../../src/screens/admin/AdminDealershipDetailScreen';

export default function AdminDealershipDetailRoute() {
  const navigation = useNavigation();
  const params = useLocalSearchParams();
  return <Screen navigation={navigation} route={{ params }} />;
}
