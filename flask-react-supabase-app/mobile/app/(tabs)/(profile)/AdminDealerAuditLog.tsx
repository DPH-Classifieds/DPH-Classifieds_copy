import { useNavigation, useLocalSearchParams } from 'expo-router';
import Screen from '../../../src/screens/admin/AdminDealerAuditLogScreen';

export default function AdminDealerAuditLogRoute() {
  const navigation = useNavigation();
  const params = useLocalSearchParams();
  return <Screen navigation={navigation} route={{ params }} />;
}
