import { Alert } from 'react-native';
import { router } from 'expo-router';

// Gate for seller-contact actions (call / WhatsApp). Uses expo-router `router` —
// navigation.navigate('Auth'/'Profile') silently no-ops under Expo Router (those
// are React-Navigation route names that don't exist in the app/ tree).
export const ensureContactAccess = (user, _navigation) => {
  if (!user) {
    Alert.alert('Login Required', 'Please log in to contact the seller.', [
      { text: 'Log In', onPress: () => router.push('/Login') },
      { text: 'Cancel', style: 'cancel' },
    ]);
    return false;
  }
  if (!user.phone_verified) {
    Alert.alert(
      'Phone Verification Required',
      'Please verify your phone number to view seller contact details.',
      [
        { text: 'Verify Now', onPress: () => router.push('/(auth)/VerifyPhone') },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
    return false;
  }
  return true;
};
