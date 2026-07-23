import { Stack } from 'expo-router';
export default function AuthStackLayout() {
  return (
    <Stack screenOptions={{
        headerStyle: { backgroundColor: '#000000' },
        headerTintColor: '#ffffff',
        headerTitleStyle: { fontWeight: '600' },
        contentStyle: { backgroundColor: '#000000' },
        animation: 'slide_from_right',
    }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="Login" options={{ headerShown: false }} />
      <Stack.Screen name="Signup" options={{ headerShown: false }} />
      <Stack.Screen name="ForgotPassword" options={{ title: 'Reset Password' }} />
      <Stack.Screen name="ResetPassword" options={{ title: 'Reset Password' }} />
      <Stack.Screen name="CheckEmail" options={{ title: 'Verify Email' }} />
      <Stack.Screen name="VerifyPhone" options={{ title: 'Verify Phone' }} />
    </Stack>
  );
}
