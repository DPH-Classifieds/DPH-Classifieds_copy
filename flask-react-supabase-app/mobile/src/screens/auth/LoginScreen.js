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
import { useAuth } from '../../context/AuthContext';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import apiClient from '../../utils/apiClient';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';

export default function LoginScreen({ navigation, route }) {
  const { signIn, signInWithGoogle } = useAuth();
  const redirect = route?.params?.redirect;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [errors, setErrors] = useState({});

  const navigateAfterAuth = (signedInUser) => {
    const rootNav = navigation.getParent();
    if (!signedInUser?.phone_verified) {
      navigation.navigate('VerifyPhone', {
        phone: signedInUser?.phone || '',
        countryCode: signedInUser?.country_code || '+971',
        purpose: 'profile_verify',
        redirect: redirect || 'Profile',
      });
      return;
    }
    if (redirect && rootNav) {
      rootNav.navigate('Main', { screen: redirect });
    } else if (rootNav) {
      rootNav.goBack();
    }
  };

  const handleGoogle = async () => {
    setGoogleLoading(true);
    try {
      await signInWithGoogle();
      // signInWithGoogle already calls syncWithSupabase which installs the
      // bearer token on apiClient. Pull a fresh /api/auth/me so we have the
      // current phone_verified state before routing.
      const me = await apiClient.get('/api/auth/me').catch(() => null);
      navigateAfterAuth(me);
    } catch (err) {
      const message = err?.message || 'Google sign-in failed. Please try again.';
      if (message.toLowerCase() !== 'sign-in cancelled') {
        Alert.alert('Google Sign-in Failed', message);
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  const validate = () => {
    const newErrors = {};
    if (!email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(email)) {
      newErrors.email = 'Enter a valid email address';
    }
    if (!password) {
      newErrors.password = 'Password is required';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSignIn = async () => {
    if (!validate()) return;

    setLoading(true);
    try {
      await signIn(email.trim(), password);
      const rootNav = navigation.getParent();
      if (redirect && rootNav) {
        rootNav.navigate('Main', { screen: redirect });
      } else if (rootNav) {
        rootNav.goBack();
      }
    } catch (err) {
      Alert.alert('Sign In Failed', err.message || 'Invalid email or password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.logoText}>DPH Classifieds</Text>
          <Text style={styles.subtitle}>Sign in to continue</Text>
        </View>

        <View style={styles.form}>
          <Input
            label="Email or Username"
            value={email}
            onChangeText={(text) => {
              setEmail(text);
              if (errors.email) setErrors((prev) => ({ ...prev, email: null }));
            }}
            placeholder="you@example.com or username"
            keyboardType="default"
            autoCapitalize="none"
            icon="mail-outline"
            error={errors.email}
          />

          <View style={styles.passwordContainer}>
            <Input
              label="Password"
              value={password}
              onChangeText={(text) => {
                setPassword(text);
                if (errors.password) setErrors((prev) => ({ ...prev, password: null }));
              }}
              placeholder="Enter your password"
              secureTextEntry={!showPassword}
              icon="lock-closed-outline"
              error={errors.password}
            />
            <TouchableOpacity
              style={styles.eyeButton}
              onPress={() => setShowPassword(!showPassword)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons
                name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                size={20}
                color="rgba(255,255,255,0.4)"
              />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            onPress={() => navigation.navigate('ForgotPassword')}
            style={styles.forgotButton}
          >
            <Text style={styles.forgotText}>Forgot Password?</Text>
          </TouchableOpacity>

          <Button
            title="Sign In"
            onPress={handleSignIn}
            loading={loading}
            disabled={loading || googleLoading}
            size="lg"
            style={styles.signInButton}
          />

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerLabel}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity
            style={[styles.googleButton, (googleLoading || loading) && styles.googleButtonDisabled]}
            onPress={handleGoogle}
            disabled={googleLoading || loading}
            activeOpacity={0.8}
          >
            <Ionicons name="logo-google" size={18} color="#1f2937" />
            <Text style={styles.googleButtonText}>
              {googleLoading ? 'Opening Google...' : 'Continue with Google'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Don't have an account? </Text>
          <TouchableOpacity onPress={() => navigation.navigate('Signup')}>
            <Text style={styles.footerLink}>Sign Up</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.xxl,
  },
  header: {
    alignItems: 'center',
    marginBottom: SPACING.xl,
  },
  logoText: {
    fontSize: 26,
    fontWeight: '800',
    color: COLORS.accent,
    letterSpacing: 1,
  },
  subtitle: {
    fontSize: FONT_SIZES.md,
    color: COLORS.textSecondary,
    marginTop: SPACING.sm,
  },
  form: {
    marginBottom: SPACING.lg,
  },
  passwordContainer: {
    position: 'relative',
  },
  eyeButton: {
    position: 'absolute',
    right: 14,
    top: 38,
    zIndex: 1,
  },
  forgotButton: {
    alignSelf: 'flex-end',
    marginBottom: SPACING.lg,
    marginTop: -SPACING.xs,
  },
  forgotText: {
    color: COLORS.accent,
    fontSize: FONT_SIZES.sm,
    fontWeight: '500',
  },
  signInButton: {
    width: '100%',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: SPACING.md,
    gap: 10,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  dividerLabel: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: FONT_SIZES.xs,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: COLORS.white,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: 14,
    width: '100%',
  },
  googleButtonDisabled: {
    opacity: 0.7,
  },
  googleButtonText: {
    color: '#1f2937',
    fontWeight: '600',
    fontSize: FONT_SIZES.md,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: SPACING.lg,
  },
  footerText: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.md,
  },
  footerLink: {
    color: COLORS.accent,
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
  },
});
