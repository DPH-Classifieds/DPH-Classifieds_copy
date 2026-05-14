import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import apiClient from '../../utils/apiClient';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import { COLORS, SPACING, FONT_SIZES } from '../../constants/theme';

export default function ResetPasswordScreen({ route, navigation }) {
  const { email } = route.params || {};
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleReset = async () => {
    if (!password || password.length < 6) {
      Alert.alert('Invalid', 'Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert('Mismatch', 'Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      await apiClient.post('/api/auth/update-password', {
        email,
        password,
      });
      Alert.alert('Success', 'Your password has been reset. You can now log in.', [
        { text: 'OK', onPress: () => navigation.navigate('Login') },
      ]);
    } catch (err) {
      Alert.alert('Error', err.message || 'Failed to reset password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.content}>
          <View style={styles.iconContainer}>
            <Ionicons name="lock-closed-outline" size={48} color={COLORS.accent} />
          </View>
          <Text style={styles.title}>Reset Password</Text>
          <Text style={styles.subtitle}>Enter your new password below.</Text>

          <Input
            label="New Password"
            value={password}
            onChangeText={setPassword}
            placeholder="At least 6 characters"
            secureTextEntry
          />
          <Input
            label="Confirm Password"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="Re-enter password"
            secureTextEntry
          />

          <Button
            title="Reset Password"
            onPress={handleReset}
            loading={loading}
            style={styles.button}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { flex: 1, padding: SPACING.md, justifyContent: 'center' },
  iconContainer: { alignItems: 'center', marginBottom: SPACING.lg },
  title: {
    color: COLORS.white, fontSize: FONT_SIZES.xxl,
    fontWeight: '700', textAlign: 'center', marginBottom: SPACING.sm,
  },
  subtitle: {
    color: COLORS.textSecondary, fontSize: FONT_SIZES.md,
    textAlign: 'center', marginBottom: SPACING.lg, lineHeight: 22,
  },
  button: { marginTop: SPACING.sm },
});
