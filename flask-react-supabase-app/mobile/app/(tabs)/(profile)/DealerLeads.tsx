import { useNavigation, useLocalSearchParams } from 'expo-router';
import Screen from '../../../src/screens/dealer/DealerLeadsScreen';

export default function DealerLeadsRoute() {
  const navigation = useNavigation();
  const params = useLocalSearchParams();
  return <Screen navigation={navigation} route={{ params }} />;
}
