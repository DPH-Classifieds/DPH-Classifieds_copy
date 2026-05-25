import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';

const API_BASE = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:5000';

export default function CheckEmailScreen({ navigation, route }) {
  const email = route?.params?.email || '';
  const [resendLoading, setResendLoading] = useState(false);
  const [resendSent, setResendSent] = useState(false);
  const [showChangeEmail, setShowChangeEmail] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [updateLoading, setUpdateLoading] = useState(false);
  const [newEmailError, setNewEmailError] = useState('');

  const handleResend = async () => {
    setResendLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/resend-confirmation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to resend');
      setResendSent(true);
    } catch (err) {
      Alert.alert('Error', err.message || 'Could not resend confirmation email.');
    } finally {
      setResendLoading(false);
    }
  };

  const handleUpdateEmail = async () => {
    setNewEmailError('');
    if (!newEmail.trim()) {
      setNewEmailError('Email is required');
      return;
    }
    if (!/\S+@\S+\.\S+/.test(newEmail)) {
      setNewEmailError('Enter a valid email address');
      return;
    }
    if (newEmail.trim() === email) {
      setNewEmailError('New email must be different');
      return;
    }

    setUpdateLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/update-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, new_email: newEmail.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update email');
      Alert.alert('Email Updated', 'A new confirmation link has been sent to your new email address.', [
        { text: 'OK', onPress: () => navigation.navigate('Login') },
      ]);
    } catch (err) {
      Alert.alert('Error', err.message || 'Could not update email.');
    } finally {
      setUpdateLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.iconContainer}>
            <View style={styles.iconCircle}>
              <Ionicons name="mail-open-outline" size={48} color={COLORS.accent} />
            </View>
          </View>

          <Text style={styles.title}>Check Your Email</Text>

          <Text style={styles.emailText}>{email}</Text>

          <View style={styles.stepsContainer}>
            <View style={styles.step}>
              <View style={styles.stepNumber}>
                <Text style={styles.stepNumberText}>1</Text>
              </View>
              <Text style={styles.stepText}>Check your inbox for a confirmation email</Text>
            </View>
            <View style={styles.step}>
              <View style={styles.stepNumber}>
                <Text style={styles.stepNumberText}>2</Text>
              </View>
              <Text style={styles.stepText}>Click the confirmation link in the email</Text>
            </View>
            <View style={styles.step}>
              <View style={styles.stepNumber}>
                <Text style={styles.stepNumberText}>3</Text>
              </View>
              <Text style={styles.stepText}>Return here and sign in to your account</Text>
            </View>
          </View>

          <Button
            title={resendSent ? 'Confirmation Resent!' : 'Resend Confirmation'}
            onPress={handleResend}
            loading={resendLoading}
            disabled={resendLoading || resendSent}
            size="lg"
            style={styles.resendButton}
          />

          <TouchableOpacity
            onPress={() => setShowChangeEmail(!showChangeEmail)}
            style={styles.changeEmailToggle}
          >
            <Text style={styles.changeEmailToggleText}>
              {showChangeEmail ? 'Cancel' : 'Change Email'}
            </Text>
          </TouchableOpacity>

          {showChangeEmail && (
            <View style={styles.changeEmailForm}>
              <Input
                label="New Email"
                value={newEmail}
                onChangeText={(text) => {
                  setNewEmail(text);
                  if (newEmailError) setNewEmailError('');
                }}
                placeholder="you@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
                icon="mail-outline"
                error={newEmailError}
              />
              <Button
                title="Update Email"
                onPress={handleUpdateEmail}
                loading={updateLoading}
                disabled={updateLoading}
                size="lg"
                style={styles.updateButton}
              />
            </View>
          )}

          <TouchableOpacity
            onPress={() => navigation.navigate('Login')}
            style={styles.backButton}
          >
            <Ionicons name="arrow-back-outline" size={16} color={COLORS.textSecondary} />
            <Text style={styles.backButtonText}>Back to Login</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#000000',
  },
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.xxl,
    alignItems: 'center',
  },
  iconContainer: {
    marginBottom: SPACING.xl,
  },
  iconCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: COLORS.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.accent,
  },
  title: {
    fontSize: FONT_SIZES.xl,
    fontWeight: '700',
    color: COLORS.white,
    marginBottom: SPACING.md,
    textAlign: 'center',
  },
  emailText: {
    fontSize: FONT_SIZES.lg,
    color: COLORS.accent,
    fontWeight: '600',
    marginBottom: SPACING.xl,
    textAlign: 'center',
  },
  stepsContainer: {
    width: '100%',
    marginBottom: SPACING.xl,
    gap: SPACING.md,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepNumberText: {
    color: COLORS.black,
    fontSize: FONT_SIZES.sm,
    fontWeight: '700',
  },
  stepText: {
    flex: 1,
    fontSize: FONT_SIZES.md,
    color: COLORS.textSecondary,
    lineHeight: 20,
  },
  resendButton: {
    width: '100%',
    marginBottom: SPACING.md,
  },
  changeEmailToggle: {
    paddingVertical: SPACING.sm,
    marginBottom: SPACING.md,
  },
  changeEmailToggleText: {
    color: COLORS.accent,
    fontSize: FONT_SIZES.sm,
    fontWeight: '500',
  },
  changeEmailForm: {
    width: '100%',
    marginBottom: SPACING.md,
  },
  updateButton: {
    width: '100%',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.md,
    marginTop: SPACING.md,
  },
  backButtonText: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.md,
    fontWeight: '500',
  },
});
