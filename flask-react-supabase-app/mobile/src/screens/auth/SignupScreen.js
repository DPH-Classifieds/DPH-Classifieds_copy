import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Linking,
  Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import apiClient from '../../utils/apiClient';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';

const API_BASE = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:5000';

const UAE_EMIRATES = [
  'Abu Dhabi',
  'Ajman',
  'Al Ain',
  'Dubai',
  'Fujairah',
  'Ras Al Khaimah',
  'Sharjah',
  'Umm Al Quwain',
];

const DUBAI_AREAS = [
  'Al Barsha',
  'Al Quoz',
  'Al Sufouh',
  'Bur Dubai',
  'Business Bay',
  'Deira',
  'DIFC',
  'Downtown Dubai',
  'Dubai Creek Harbour',
  'Dubai Harbour',
  'Dubai Investment Park',
  'Dubai Marina',
  'Dubai Silicon Oasis',
  'Dubai Sports City',
  'Dubai Studio City',
  'Emirates Hills',
  'JBR (Jumeirah Beach Residence)',
  'JLT (Jumeirah Lake Towers)',
  'Jumeirah',
  'Jumeirah Village Circle',
  'Jumeirah Village Triangle',
  'Motor City',
  'Mirdif',
  'Palm Jumeirah',
  'Silicon Oasis',
  'Town Square',
  'The Springs',
  'Umm Suqeim',
];

const COUNTRY_CODES = [
  { code: '+971', label: 'UAE', flag: '🇦🇪' },
  { code: '+966', label: 'SA', flag: '🇸🇦' },
  { code: '+973', label: 'BH', flag: '🇧🇭' },
  { code: '+974', label: 'QA', flag: '🇶🇦' },
  { code: '+968', label: 'OM', flag: '🇴🇲' },
  { code: '+965', label: 'KW', flag: '🇰🇼' },
  { code: '+20', label: 'EG', flag: '🇪🇬' },
  { code: '+92', label: 'PK', flag: '🇵🇰' },
  { code: '+91', label: 'IN', flag: '🇮🇳' },
  { code: '+44', label: 'UK', flag: '🇬🇧' },
  { code: '+1', label: 'US', flag: '🇺🇸' },
];

function getPasswordStrength(pw) {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/[^a-zA-Z0-9]/.test(pw)) score++;
  if (score <= 1) return { level: 'weak', color: '#FF3B30', label: 'Weak' };
  if (score <= 2) return { level: 'fair', color: '#FF9500', label: 'Fair' };
  if (score <= 3) return { level: 'good', color: '#34C759', label: 'Good' };
  return { level: 'strong', color: '#30D158', label: 'Strong' };
}

export default function SignupScreen({ navigation }) {
  const { signUp, signInWithGoogle } = useAuth();
  const [googleLoading, setGoogleLoading] = useState(false);

  const handleGoogle = async () => {
    setGoogleLoading(true);
    try {
      await signInWithGoogle();
      const me = await apiClient.get('/api/auth/me').catch(() => null);
      const rootNav = navigation.getParent();
      if (!me?.phone_verified) {
        navigation.navigate('VerifyPhone', {
          phone: me?.phone || '',
          countryCode: me?.country_code || '+971',
          purpose: 'profile_verify',
          redirect: 'Profile',
        });
      } else if (rootNav) {
        rootNav.goBack();
      }
    } catch (err) {
      const message = err?.message || 'Google sign-up failed. Please try again.';
      if (message.toLowerCase() !== 'sign-in cancelled') {
        Alert.alert('Google Sign-up Failed', message);
      }
    } finally {
      setGoogleLoading(false);
    }
  };
  const [accountType, setAccountType] = useState('individual');
  const [username, setUsername] = useState('');
  const [usernameStatus, setUsernameStatus] = useState(null);
  const [usernameChecking, setUsernameChecking] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [countryCode, setCountryCode] = useState('+971');
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [phone, setPhone] = useState('');
  const [emirate, setEmirate] = useState('');
  const [area, setArea] = useState('');
  const [showEmiratePicker, setShowEmiratePicker] = useState(false);
  const [showAreaPicker, setShowAreaPicker] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [emailComms, setEmailComms] = useState(true);
  const [smsComms, setSmsComms] = useState(true);
  const [marketingComms, setMarketingComms] = useState(true);

  const usernameTimeout = useRef(null);

  const checkUsername = useCallback(async (value) => {
    if (!value || value.length < 3) {
      setUsernameStatus(null);
      setUsernameChecking(false);
      return;
    }
    setUsernameChecking(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/check-username?username=${encodeURIComponent(value)}`);
      const data = await res.json();
      setUsernameStatus(data.available ? 'available' : 'taken');
    } catch {
      setUsernameStatus(null);
    } finally {
      setUsernameChecking(false);
    }
  }, []);

  const handleUsernameChange = (text) => {
    const cleaned = text.replace(/[^a-zA-Z0-9_]/g, '');
    setUsername(cleaned);
    setUsernameStatus(null);
    if (usernameTimeout.current) clearTimeout(usernameTimeout.current);
    usernameTimeout.current = setTimeout(() => checkUsername(cleaned), 500);
  };

  useEffect(() => {
    return () => {
      if (usernameTimeout.current) clearTimeout(usernameTimeout.current);
    };
  }, []);

  const passwordStrength = getPasswordStrength(password);

  const passwordChecks = [
    { label: 'At least 8 characters', met: password.length >= 8 },
    { label: 'At least 1 number', met: /[0-9]/.test(password) },
    { label: 'At least 1 symbol', met: /[^a-zA-Z0-9]/.test(password) },
  ];

  const isFormValid =
    username.trim().length >= 3 &&
    usernameStatus === 'available' &&
    firstName.trim() &&
    lastName.trim() &&
    email.trim() &&
    /\S+@\S+\.\S+/.test(email) &&
    phone.trim() &&
    emirate &&
    password.length >= 8 &&
    password === confirmPassword &&
    termsAccepted &&
    privacyAccepted;

  const validate = () => {
    const newErrors = {};
    if (!username.trim() || username.length < 3) newErrors.username = 'Username must be at least 3 characters';
    else if (usernameStatus !== 'available') newErrors.username = 'Username is not available';
    if (!firstName.trim()) newErrors.firstName = 'First name is required';
    if (!lastName.trim()) newErrors.lastName = 'Last name is required';
    if (!email.trim()) newErrors.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(email)) newErrors.email = 'Enter a valid email address';
    if (!phone.trim()) newErrors.phone = 'Phone number is required';
    if (!emirate) newErrors.emirate = 'Please select an emirate';
    if (!password) newErrors.password = 'Password is required';
    else if (password.length < 8) newErrors.password = 'Password must be at least 8 characters';
    if (!confirmPassword) newErrors.confirmPassword = 'Please confirm your password';
    else if (password !== confirmPassword) newErrors.confirmPassword = 'Passwords do not match';
    if (!termsAccepted) newErrors.terms = 'You must accept the Terms of Service';
    if (!privacyAccepted) newErrors.privacy = 'You must accept the Privacy Policy';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSignUp = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      const fullPhone = `${countryCode}${phone.replace(/[^0-9]/g, '')}`;
      await signUp(email.trim(), password, {
        username: username.trim().toLowerCase(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: fullPhone,
        accountType,
        emirate,
        area: area || undefined,
        emailComms,
        smsComms,
        marketingComms,
      });
      navigation.navigate('CheckEmail', { email: email.trim() });
    } catch (err) {
      Alert.alert('Sign Up Failed', err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const selectedCountry = COUNTRY_CODES.find((c) => c.code === countryCode) || COUNTRY_CODES[0];
  const areasForEmirate = emirate === 'Dubai' ? DUBAI_AREAS : [];

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
          <Text style={styles.logoText}>DPH</Text>
          <Text style={styles.logoSubtext}>Classifieds</Text>
          <Text style={styles.subtitle}>Create your account</Text>
        </View>

        <TouchableOpacity
          style={[styles.googleSignupButton, googleLoading && { opacity: 0.7 }]}
          onPress={handleGoogle}
          disabled={googleLoading || loading}
          activeOpacity={0.8}
        >
          <Ionicons name="logo-google" size={18} color="#1f2937" />
          <Text style={styles.googleSignupButtonText}>
            {googleLoading ? 'Opening Google...' : 'Continue with Google'}
          </Text>
        </TouchableOpacity>
        <Text style={styles.googleSignupNote}>
          After Google sign-up, we still need to verify your phone number.
        </Text>

        <View style={styles.signupDividerRow}>
          <View style={styles.signupDividerLine} />
          <Text style={styles.signupDividerLabel}>or use email</Text>
          <View style={styles.signupDividerLine} />
        </View>

        <View style={styles.accountTypeContainer}>
          <TouchableOpacity
            style={[styles.accountTypePill, accountType === 'individual' && styles.accountTypePillActive]}
            onPress={() => setAccountType('individual')}
            activeOpacity={0.7}
          >
            <Ionicons
              name="person-outline"
              size={16}
              color={accountType === 'individual' ? COLORS.black : COLORS.textSecondary}
            />
            <Text style={[styles.accountTypeText, accountType === 'individual' && styles.accountTypeTextActive]}>
              Individual
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.accountTypePill, accountType === 'dealer' && styles.accountTypePillActive]}
            onPress={() => setAccountType('dealer')}
            activeOpacity={0.7}
          >
            <Ionicons
              name="business-outline"
              size={16}
              color={accountType === 'dealer' ? COLORS.black : COLORS.textSecondary}
            />
            <Text style={[styles.accountTypeText, accountType === 'dealer' && styles.accountTypeTextActive]}>
              Dealer / Business
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.form}>
          <View style={styles.fieldWithStatus}>
            <Input
              label="Username"
              value={username}
              onChangeText={handleUsernameChange}
              placeholder="choose_a_username"
              autoCapitalize="none"
              autoCorrect={false}
              icon="at-outline"
              error={errors.username}
            />
            {username.length >= 3 && (
              <View style={styles.usernameStatus}>
                {usernameChecking ? (
                  <Ionicons name="time-outline" size={16} color={COLORS.textMuted} />
                ) : usernameStatus === 'available' ? (
                  <Ionicons name="checkmark-circle" size={16} color="#34C759" />
                ) : usernameStatus === 'taken' ? (
                  <Ionicons name="close-circle" size={16} color="#FF3B30" />
                ) : null}
              </View>
            )}
          </View>

          <View style={styles.row}>
            <View style={styles.halfInput}>
              <Input
                label="First Name"
                value={firstName}
                onChangeText={(text) => {
                  setFirstName(text);
                  if (errors.firstName) setErrors((prev) => ({ ...prev, firstName: null }));
                }}
                placeholder="First name"
                icon="person-outline"
                error={errors.firstName}
              />
            </View>
            <View style={styles.halfInput}>
              <Input
                label="Last Name"
                value={lastName}
                onChangeText={(text) => {
                  setLastName(text);
                  if (errors.lastName) setErrors((prev) => ({ ...prev, lastName: null }));
                }}
                placeholder="Last name"
                icon="person-outline"
                error={errors.lastName}
              />
            </View>
          </View>

          <Input
            label="Email"
            value={email}
            onChangeText={(text) => {
              setEmail(text);
              if (errors.email) setErrors((prev) => ({ ...prev, email: null }));
            }}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            icon="mail-outline"
            error={errors.email}
          />

          <View style={styles.phoneContainer}>
            <TouchableOpacity
              style={styles.phonePrefix}
              onPress={() => setShowCountryPicker(!showCountryPicker)}
            >
              <Text style={styles.flagText}>{selectedCountry.flag}</Text>
              <Text style={styles.phonePrefixText}>{selectedCountry.code}</Text>
              <Ionicons name="chevron-down" size={14} color={COLORS.textSecondary} />
            </TouchableOpacity>
            <View style={styles.phoneInput}>
              <Input
                label="Phone"
                value={phone}
                onChangeText={(text) => {
                  setPhone(text.replace(/[^0-9]/g, ''));
                  if (errors.phone) setErrors((prev) => ({ ...prev, phone: null }));
                }}
                placeholder="50 123 4567"
                keyboardType="phone-pad"
                error={errors.phone}
              />
            </View>
          </View>

          {showCountryPicker && (
            <View style={styles.pickerDropdown}>
              {COUNTRY_CODES.map((c) => (
                <TouchableOpacity
                  key={c.code}
                  style={[
                    styles.pickerItem,
                    c.code === countryCode && styles.pickerItemActive,
                  ]}
                  onPress={() => {
                    setCountryCode(c.code);
                    setShowCountryPicker(false);
                  }}
                >
                  <Text style={styles.pickerFlag}>{c.flag}</Text>
                  <Text style={styles.pickerItemText}>{c.label}</Text>
                  <Text style={styles.pickerItemCode}>{c.code}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <Text style={styles.sectionLabel}>Location</Text>

          <TouchableOpacity
            style={styles.pickerButton}
            onPress={() => setShowEmiratePicker(!showEmiratePicker)}
          >
            <Ionicons name="location-outline" size={18} color={COLORS.textSecondary} />
            <Text style={[styles.pickerButtonText, !emirate && styles.pickerPlaceholder]}>
              {emirate || 'Select Emirate'}
            </Text>
            <Ionicons name="chevron-down" size={16} color={COLORS.textSecondary} />
          </TouchableOpacity>
          {errors.emirate && <Text style={styles.errorText}>{errors.emirate}</Text>}

          {showEmiratePicker && (
            <View style={styles.pickerDropdown}>
              {UAE_EMIRATES.map((e) => (
                <TouchableOpacity
                  key={e}
                  style={[styles.pickerItem, e === emirate && styles.pickerItemActive]}
                  onPress={() => {
                    setEmirate(e);
                    setArea('');
                    setShowEmiratePicker(false);
                  }}
                >
                  <Text style={styles.pickerItemText}>{e}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {emirate === 'Dubai' && (
            <>
              <TouchableOpacity
                style={styles.pickerButton}
                onPress={() => setShowAreaPicker(!showAreaPicker)}
              >
                <Ionicons name="map-outline" size={18} color={COLORS.textSecondary} />
                <Text style={[styles.pickerButtonText, !area && styles.pickerPlaceholder]}>
                  {area || 'Select Area (optional)'}
                </Text>
                <Ionicons name="chevron-down" size={16} color={COLORS.textSecondary} />
              </TouchableOpacity>

              {showAreaPicker && (
                <View style={styles.pickerDropdown}>
                  <TouchableOpacity
                    style={[styles.pickerItem, !area && styles.pickerItemActive]}
                    onPress={() => {
                      setArea('');
                      setShowAreaPicker(false);
                    }}
                  >
                    <Text style={styles.pickerItemText}>No specific area</Text>
                  </TouchableOpacity>
                  {areasForEmirate.map((a) => (
                    <TouchableOpacity
                      key={a}
                      style={[styles.pickerItem, a === area && styles.pickerItemActive]}
                      onPress={() => {
                        setArea(a);
                        setShowAreaPicker(false);
                      }}
                    >
                      <Text style={styles.pickerItemText}>{a}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </>
          )}

          <View style={styles.passwordContainer}>
            <Input
              label="Password"
              value={password}
              onChangeText={(text) => {
                setPassword(text);
                if (errors.password) setErrors((prev) => ({ ...prev, password: null }));
              }}
              placeholder="Min. 8 characters"
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

          {password.length > 0 && (
            <View style={styles.strengthContainer}>
              <View style={styles.strengthBar}>
                <View
                  style={[
                    styles.strengthFill,
                    {
                      width:
                        passwordStrength.level === 'weak'
                          ? '25%'
                          : passwordStrength.level === 'fair'
                          ? '50%'
                          : passwordStrength.level === 'good'
                          ? '75%'
                          : '100%',
                      backgroundColor: passwordStrength.color,
                    },
                  ]}
                />
              </View>
              <Text style={[styles.strengthLabel, { color: passwordStrength.color }]}>
                {passwordStrength.label}
              </Text>
            </View>
          )}

          {password.length > 0 && (
            <View style={styles.checksContainer}>
              {passwordChecks.map((check) => (
                <View key={check.label} style={styles.checkRow}>
                  <Ionicons
                    name={check.met ? 'checkmark-circle' : 'ellipse-outline'}
                    size={16}
                    color={check.met ? '#34C759' : COLORS.textMuted}
                  />
                  <Text style={[styles.checkText, check.met && styles.checkTextMet]}>
                    {check.label}
                  </Text>
                </View>
              ))}
            </View>
          )}

          <View style={styles.passwordContainer}>
            <Input
              label="Confirm Password"
              value={confirmPassword}
              onChangeText={(text) => {
                setConfirmPassword(text);
                if (errors.confirmPassword) setErrors((prev) => ({ ...prev, confirmPassword: null }));
              }}
              placeholder="Re-enter password"
              secureTextEntry={!showPassword}
              icon="lock-closed-outline"
              error={errors.confirmPassword}
            />
          </View>

          <View style={styles.termsSection}>
            <TouchableOpacity
              style={styles.checkboxRow}
              onPress={() => {
                setTermsAccepted(!termsAccepted);
                if (errors.terms) setErrors((prev) => ({ ...prev, terms: null }));
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.checkbox, termsAccepted && styles.checkboxChecked]}>
                {termsAccepted && <Ionicons name="checkmark" size={14} color={COLORS.black} />}
              </View>
              <Text style={styles.termsText}>
                I agree to the{' '}
                <Text
                  style={styles.termsLink}
                  onPress={() => Linking.openURL('https://www.dphclassifieds.com/terms')}
                >
                  Terms of Service
                </Text>
              </Text>
            </TouchableOpacity>
            {errors.terms && <Text style={styles.errorText}>{errors.terms}</Text>}

            <TouchableOpacity
              style={styles.checkboxRow}
              onPress={() => {
                setPrivacyAccepted(!privacyAccepted);
                if (errors.privacy) setErrors((prev) => ({ ...prev, privacy: null }));
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.checkbox, privacyAccepted && styles.checkboxChecked]}>
                {privacyAccepted && <Ionicons name="checkmark" size={14} color={COLORS.black} />}
              </View>
              <Text style={styles.termsText}>
                I agree to the{' '}
                <Text
                  style={styles.termsLink}
                  onPress={() => Linking.openURL('https://www.dphclassifieds.com/privacy')}
                >
                  Privacy Policy
                </Text>
              </Text>
            </TouchableOpacity>
            {errors.privacy && <Text style={styles.errorText}>{errors.privacy}</Text>}
          </View>

          <Text style={styles.sectionLabel}>Communication Preferences</Text>

          <View style={styles.commsContainer}>
            <View style={styles.commsRow}>
              <Text style={styles.commsLabel}>Email notifications</Text>
              <Switch
                value={emailComms}
                onValueChange={setEmailComms}
                trackColor={{ false: COLORS.surfaceHigher, true: COLORS.accent }}
                thumbColor={COLORS.white}
              />
            </View>
            <View style={styles.commsRow}>
              <Text style={styles.commsLabel}>SMS notifications</Text>
              <Switch
                value={smsComms}
                onValueChange={setSmsComms}
                trackColor={{ false: COLORS.surfaceHigher, true: COLORS.accent }}
                thumbColor={COLORS.white}
              />
            </View>
            <View style={styles.commsRow}>
              <Text style={styles.commsLabel}>Marketing emails</Text>
              <Switch
                value={marketingComms}
                onValueChange={setMarketingComms}
                trackColor={{ false: COLORS.surfaceHigher, true: COLORS.accent }}
                thumbColor={COLORS.white}
              />
            </View>
          </View>

          <Button
            title="Create Account"
            onPress={handleSignUp}
            loading={loading}
            disabled={loading || !isFormValid}
            size="lg"
            style={styles.signUpButton}
          />
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Already have an account? </Text>
          <TouchableOpacity onPress={() => navigation.navigate('Login')}>
            <Text style={styles.footerLink}>Sign In</Text>
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
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.xxl,
  },
  header: {
    alignItems: 'center',
    marginBottom: SPACING.xl,
  },
  logoText: {
    fontSize: 42,
    fontWeight: '800',
    color: COLORS.accent,
    letterSpacing: 2,
  },
  logoSubtext: {
    fontSize: FONT_SIZES.lg,
    color: COLORS.white,
    fontWeight: '400',
    marginTop: -2,
    letterSpacing: 4,
  },
  subtitle: {
    fontSize: FONT_SIZES.md,
    color: COLORS.textSecondary,
    marginTop: SPACING.md,
  },
  googleSignupButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: COLORS.white,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: 14,
    marginBottom: SPACING.xs,
  },
  googleSignupButtonText: {
    color: '#1f2937',
    fontWeight: '600',
    fontSize: FONT_SIZES.md,
  },
  googleSignupNote: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.xs,
    textAlign: 'center',
    marginTop: 6,
  },
  signupDividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: SPACING.lg,
    gap: 10,
  },
  signupDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  signupDividerLabel: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: FONT_SIZES.xs,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  accountTypeContainer: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: SPACING.xl,
    justifyContent: 'center',
  },
  accountTypePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm + 2,
    borderRadius: BORDER_RADIUS.pill,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  accountTypePillActive: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  accountTypeText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  accountTypeTextActive: {
    color: COLORS.black,
    fontWeight: '600',
  },
  form: {
    marginBottom: SPACING.lg,
  },
  row: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  halfInput: {
    flex: 1,
  },
  fieldWithStatus: {
    position: 'relative',
  },
  usernameStatus: {
    position: 'absolute',
    right: 14,
    top: 38,
    zIndex: 1,
  },
  phoneContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  phonePrefix: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginRight: SPACING.sm,
  },
  flagText: {
    fontSize: 16,
  },
  phonePrefixText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
  },
  phoneInput: {
    flex: 1,
    marginBottom: 0,
  },
  sectionLabel: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textSecondary,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: SPACING.sm,
    marginTop: SPACING.md,
  },
  pickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: SPACING.sm,
  },
  pickerButtonText: {
    flex: 1,
    fontSize: FONT_SIZES.md,
    color: COLORS.white,
  },
  pickerPlaceholder: {
    color: COLORS.textMuted,
  },
  pickerDropdown: {
    backgroundColor: COLORS.surfaceHigher,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    marginBottom: SPACING.md,
    maxHeight: 200,
    overflow: 'scroll',
  },
  pickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  pickerItemActive: {
    backgroundColor: 'rgba(76, 175, 80, 0.15)',
  },
  pickerFlag: {
    fontSize: 18,
  },
  pickerItemText: {
    flex: 1,
    fontSize: FONT_SIZES.md,
    color: COLORS.white,
  },
  pickerItemCode: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
  },
  errorText: {
    fontSize: FONT_SIZES.xs,
    color: '#FF3B30',
    marginTop: -8,
    marginBottom: SPACING.sm,
    marginLeft: 4,
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
  strengthContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
    marginTop: -8,
  },
  strengthBar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.surfaceHigher,
    overflow: 'hidden',
  },
  strengthFill: {
    height: '100%',
    borderRadius: 2,
    transition: 'width 0.3s ease',
  },
  strengthLabel: {
    fontSize: FONT_SIZES.xs,
    fontWeight: '600',
    minWidth: 40,
  },
  checksContainer: {
    gap: 6,
    marginBottom: SPACING.md,
    paddingLeft: 4,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  checkText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
  },
  checkTextMet: {
    color: '#34C759',
  },
  termsSection: {
    marginTop: SPACING.md,
    marginBottom: SPACING.sm,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxChecked: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  termsText: {
    flex: 1,
    fontSize: FONT_SIZES.sm,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
  termsLink: {
    color: COLORS.accent,
    fontWeight: '500',
  },
  commsContainer: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    padding: SPACING.md,
    marginBottom: SPACING.lg,
    gap: SPACING.md,
  },
  commsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  commsLabel: {
    fontSize: FONT_SIZES.md,
    color: COLORS.white,
  },
  signUpButton: {
    width: '100%',
    marginTop: SPACING.sm,
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
