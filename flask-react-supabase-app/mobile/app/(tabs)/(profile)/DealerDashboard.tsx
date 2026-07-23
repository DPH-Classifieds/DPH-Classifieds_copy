import { useNavigation, useLocalSearchParams } from 'expo-router';
import Screen from '../../../src/screens/dealer/DealerDashboardScreen';

export default function DealerDashboardRoute() {
  const navigation = useNavigation();
  const params = useLocalSearchParams();
  return <Screen navigation={navigation} route={{ params }} />;
}
