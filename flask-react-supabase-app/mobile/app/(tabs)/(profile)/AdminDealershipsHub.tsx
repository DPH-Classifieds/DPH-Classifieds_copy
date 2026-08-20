import { useNavigation } from 'expo-router';
import Screen from '../../../src/screens/admin/AdminDealershipsHubScreen';

export default function AdminDealershipsHubRoute() {
  const navigation = useNavigation();
  return <Screen navigation={navigation} />;
}
