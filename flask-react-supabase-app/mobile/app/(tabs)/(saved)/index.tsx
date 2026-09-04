import { useNavigation, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../../src/context/AuthContext';
import ScreenComponent from '../../../src/screens/profile/SavedScreen';
import type { ComponentType } from "react";
const LegacyScreen = ScreenComponent as ComponentType<any>;
import SignInRequired from '../../../src/components/ui/SignInRequired';

export default function GatedIndex() {
  const { user } = useAuth();
  const navigation = useNavigation();
  const params = useLocalSearchParams();
  const router = useRouter();
  if (!user) return <SignInRequired label="Sign in to see your saved listings." onSignIn={() => router.push('/Login')} />;
  return <LegacyScreen navigation={navigation} route={{ params }} />;
}
