import { useNavigation, useLocalSearchParams } from 'expo-router';
import Screen from '../../../src/screens/admin/AdminVinOpensScreen';

export default function AdminVinOpensRoute() {
  const navigation = useNavigation();
  const params = useLocalSearchParams();
  return <Screen navigation={navigation} route={{ params }} />;
}
