import { useNavigation, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../../src/context/AuthContext';
import Screen from '../../../src/screens/profile/SavedScreen';
import SignInRequired from '../../../src/components/ui/SignInRequired';

export default function GatedIndex() {
  const { user } = useAuth();
  const navigation = useNavigation();
  const params = useLocalSearchParams();
  const router = useRouter();
  if (!user) return <SignInRequired label="Sign in to see your saved listings." onSignIn={() => router.push('/Login')} />;
  return <Screen navigation={navigation} route={{ params }} />;
}
