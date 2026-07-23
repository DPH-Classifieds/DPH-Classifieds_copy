import { useNavigation, useLocalSearchParams } from 'expo-router';
import Screen from '../../../src/screens/dealer/DealerLeadDetailScreen';

export default function DealerLeadDetailRoute() {
  const navigation = useNavigation();
  const params = useLocalSearchParams();
  return <Screen navigation={navigation} route={{ params }} />;
}
