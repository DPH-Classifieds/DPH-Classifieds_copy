import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import apiClient from '../../utils/apiClient';
import { useAuth } from '../../context/AuthContext';
import Input from '../../components/ui/Input';
import Button from '../../components/ui/Button';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';

const PHONE_CODES = ['+971', '+966', '+973', '+974', '+965', '+968', '+92', '+91', '+1', '+44'];

export default function VerifyPhoneScreen({ navigation, route }) {
  const { user, updateUser } = useAuth();
  const purpose = route?.params?.purpose || 'profile_verify';
  const redirect = route?.params?.redirect || null;
  const [step, setStep] = useState('phone');
  const [countryCode, setCountryCode] = useState(
    route?.params?.countryCode || user?.country_code || '+971'
  );
  const [phoneNumber, setPhoneNumber] = useState(route?.params?.phone || user?.phone || '');
  const [otp, setOtp] = useState('');
  const [verificationId, setVerificationId] = useState(route?.params?.verificationId || '');
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const [canResend, setCanResend] = useState(false);
  const countdownRef = useRef(null);

  useEffect(() => {
    if (step === 'otp' && countdown > 0) {
      countdownRef.current = setTimeout(() => {
        setCountdown(prev => prev - 1);
      }, 1000);
    } else if (countdown === 0) {
      setCanResend(true);
    }
    return () => {
      if (countdownRef.current) {
        clearTimeout(countdownRef.current);
      }
    };
  }, [countdown, step]);

  const handleSendCode = async () => {
    if (!phoneNumber.trim()) {
      Alert.alert('Error', 'Please enter your phone number');
      return;
    }

    setLoading(true);
    try {
      const response = await apiClient.post('/api/phone-verifications/start', {
        phone: phoneNumber.trim(),
        country_code: countryCode,
        purpose,
        source: 'mobile',
      });
      const nextVerificationId = response?.phone_verification?.verification_id || '';
      const normalizedPhone = response?.phone_verification?.phone || phoneNumber.trim();
      setVerificationId(nextVerificationId);
      setPhoneNumber(normalizedPhone);
      setStep('otp');
      setCountdown(60);
      setCanResend(false);
    } catch (err) {
      Alert.alert('Error', err.message || 'Failed to send verification code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    if (!otp.trim() || otp.length !== 6) {
      Alert.alert('Error', 'Please enter a valid 6-digit code');
      return;
    }
    if (!verificationId) {
      Alert.alert('Error', 'Please request a verification code first');
      return;
    }

    setLoading(true);
    try {
      await apiClient.post('/api/phone-verifications/verify', {
        verification_id: verificationId,
        code: otp.trim(),
        purpose,
      });
      const me = await apiClient.get('/api/auth/me').catch(() => null);
      if (updateUser) {
        await updateUser(me || { ...user, phone_verified: true });
      }
      Alert.alert('Success', 'Phone number verified successfully!', [
        {
          text: 'OK',
          // Verification done: dismiss the (auth) modal and show the app.
          onPress: () => router.replace('/(tabs)/(explore)'),
        },
      ]);
    } catch (err) {
      Alert.alert('Error', err.message || 'Invalid verification code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    setResendLoading(true);
    try {
      const response = await apiClient.post('/api/phone-verifications/start', {
        verification_id: verificationId,
        phone: phoneNumber.trim(),
        country_code: countryCode,
        purpose,
        source: 'mobile',
      });
      const nextVerificationId = response?.phone_verification?.verification_id;
      if (nextVerificationId) {
        setVerificationId(nextVerificationId);
      }
      setCountdown(60);
      setCanResend(false);
      Alert.alert('Success', 'Verification code sent again!');
    } catch (err) {
      Alert.alert('Error', err.message || 'Failed to resend code. Please try again.');
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backButton}
          >
            <Ionicons name="arrow-back" size={24} color={COLORS.white} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {step === 'phone' ? 'Verify Phone Number' : 'Enter Code'}
          </Text>
          <View style={{ width: 24 }} />
        </View>

        <View style={styles.content}>
          {step === 'phone' ? (
            <View style={styles.stepContainer}>
              <Text style={styles.description}>
                Enter your phone number to receive a verification code.
              </Text>
              
              <View style={styles.phoneRow}>
                <View style={styles.codePickerContainer}>
                  <Text style={styles.label}>Country Code</Text>
                  <TouchableOpacity style={styles.codePicker}>
                    <Text style={styles.codePickerText}>{countryCode}</Text>
                    <Ionicons name="chevron-down" size={14} color={COLORS.textSecondary} />
                  </TouchableOpacity>
                </View>
                <View style={styles.phoneInputContainer}>
                  <Input
                    label="Phone Number *"
                    value={phoneNumber}
                    onChangeText={setPhoneNumber}
                    placeholder="501234567"
                    keyboardType="phone-pad"
                  />
                </View>
              </View>

              <Button
                title="Send Code"
                onPress={handleSendCode}
                loading={loading}
                disabled={loading}
                style={styles.button}
              />
            </View>
          ) : (
            <View style={styles.stepContainer}>
              <Text style={styles.description}>
                We've sent a 6-digit code to {countryCode} {phoneNumber}
              </Text>

              <Input
                label="Verification Code *"
                value={otp}
                onChangeText={setOtp}
                placeholder="000000"
                keyboardType="numeric"
                maxLength={6}
              />

              <Button
                title="Verify"
                onPress={handleVerify}
                loading={loading}
                disabled={loading}
                style={styles.button}
              />

              <View style={styles.resendContainer}>
                {canResend ? (
                  <TouchableOpacity
                    onPress={handleResendCode}
                    disabled={resendLoading}
                  >
                    <Text style={styles.resendText}>
                      {resendLoading ? 'Sending...' : 'Resend Code'}
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={styles.countdownText}>
                    Resend code in {countdown}s
                  </Text>
                )}
              </View>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  keyboardView: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  backButton: {
    padding: SPACING.xs,
  },
  headerTitle: {
    color: COLORS.white,
    fontSize: FONT_SIZES.lg,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    paddingHorizontal: SPACING.lg,
  },
  stepContainer: {
    marginTop: SPACING.xl,
  },
  description: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.md,
    marginBottom: SPACING.xl,
    lineHeight: 22,
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: SPACING.lg,
  },
  codePickerContainer: {
    width: 100,
  },
  codePicker: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: COLORS.surfaceHigher,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 10,
    paddingVertical: 12,
    marginTop: 24,
  },
  codePickerText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.md,
  },
  phoneInputContainer: {
    flex: 1,
  },
  label: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.sm,
    marginBottom: 6,
    fontWeight: '500',
  },
  button: {
    marginTop: SPACING.md,
  },
  resendContainer: {
    alignItems: 'center',
    marginTop: SPACING.xl,
  },
  resendText: {
    color: COLORS.accent,
    fontSize: FONT_SIZES.md,
    fontWeight: '500',
  },
  countdownText: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.md,
  },
});
