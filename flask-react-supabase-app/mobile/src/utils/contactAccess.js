import { Alert } from 'react-native';

export const ensureContactAccess = (user, navigation) => {
  if (!user) {
    Alert.alert('Login Required', 'Please log in to contact the seller.', [
      { text: 'Log In', onPress: () => navigation.navigate('Auth', { screen: 'Login' }) },
      { text: 'Cancel', style: 'cancel' },
    ]);
    return false;
  }
  if (!user.phone_verified) {
    Alert.alert(
      'Phone Verification Required',
      'Please verify your phone number to view seller contact details.',
      [
        { text: 'Verify Now', onPress: () => navigation.navigate('Profile', { screen: 'VerifyPhone' }) },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
    return false;
  }
  return true;
};
