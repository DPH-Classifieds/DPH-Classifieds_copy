import { useNavigation, useLocalSearchParams } from 'expo-router';
import Screen from '../../../src/screens/profile/SettingsScreen';

export default function SettingsRoute() {
  const navigation = useNavigation();
  const params = useLocalSearchParams();
  return <Screen navigation={navigation} route={{ params }} />;
}
