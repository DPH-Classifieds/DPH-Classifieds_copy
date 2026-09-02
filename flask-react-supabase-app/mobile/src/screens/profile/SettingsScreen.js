import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, ScrollView, TouchableOpacity, Alert, StyleSheet, Image, TextInput, Switch, Modal, FlatList, RefreshControl } from 'react-native';
import Text from '../../components/ui/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../../context/AuthContext';
import apiClient from '../../utils/apiClient';
import { resolveMediaUrl } from '../../utils/media';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { isPushEnabledPref, setPushEnabledPref } from '../../utils/pushNotifications';
import { SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';
import { UAE_EMIRATES, EMIRATE_AREAS } from '../../utils/listingConstants';
import { useTheme } from '../../context/ThemeContext';

const UAE_EMIRATES_WITH_AL_AIN = [...UAE_EMIRATES, 'Al Ain'];

export default function SettingsScreen({ navigation }) {
  const { user, updateUser, syncWithSupabase } = useAuth();
  const { theme, colors: themeColors, setTheme } = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (syncWithSupabase) await syncWithSupabase({ forceBackendCheck: true });
    } finally {
      setRefreshing(false);
    }
  }, [syncWithSupabase]);
  const [firstName, setFirstName] = useState(user?.first_name || '');
  const [lastName, setLastName] = useState(user?.last_name || '');
  const [email] = useState(user?.email || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [username, setUsername] = useState(user?.username || '');
  const [displayName, setDisplayName] = useState(user?.display_name || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [whatsappNumber, setWhatsappNumber] = useState(user?.whatsapp_number || '');
  const [profilePhoto, setProfilePhoto] = useState(user?.profile_photo_url || user?.profile_photo || user?.avatar_url || null);
  const [saving, setSaving] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState(null);
  const [usernameChecking, setUsernameChecking] = useState(false);

  const [emirate, setEmirate] = useState(user?.emirate || '');
  const [area, setArea] = useState(user?.area || '');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);

  const [notifEmail, setNotifEmail] = useState(user?.notification_preferences?.email ?? true);
  const [notifSms, setNotifSms] = useState(user?.notification_preferences?.sms ?? true);
  const [notifMarketing, setNotifMarketing] = useState(user?.notification_preferences?.marketing ?? false);
  const [notifSaving, setNotifSaving] = useState(false);
  const [notifPush, setNotifPush] = useState(true);

  useEffect(() => {
    isPushEnabledPref().then(setNotifPush);
  }, []);

  const handleTogglePush = async (value) => {
    setNotifPush(value); // optimistic; applies device registration immediately
    await setPushEnabledPref(value);
  };

  const [isDealer, setIsDealer] = useState(user?.is_dealer || false);
  const [dealerCompanyName, setDealerCompanyName] = useState(user?.company_name || '');
  const [dealerRegNumber, setDealerRegNumber] = useState(user?.company_registration_number || '');
  const [dealerSaving, setDealerSaving] = useState(false);
  const [dealerStatus, setDealerStatus] = useState(user?.dealer_verification_status || null);

  const [showEmiratePicker, setShowEmiratePicker] = useState(false);
  const [showAreaPicker, setShowAreaPicker] = useState(false);

  const areasForEmirate = emirate ? EMIRATE_AREAS[emirate] || [] : [];

  const checkUsernameAvailability = async () => {
    if (!username.trim() || username === user?.username) {
      setUsernameStatus(null);
      return;
    }
    try {
      setUsernameChecking(true);
      const data = await apiClient.get(`/api/auth/check-username?username=${encodeURIComponent(username.trim())}`, { requiresAuth: false });
      setUsernameStatus(data?.available ? 'available' : 'taken');
    } catch {
      setUsernameStatus(null);
    } finally {
      setUsernameChecking(false);
    }
  };

  const getProfileCompletion = () => {
    const fields = [firstName, lastName, email, phone, username, displayName, bio, whatsappNumber, emirate, area, profilePhoto];
    const filled = fields.filter(f => f && String(f).trim().length > 0).length;
    return Math.round((filled / fields.length) * 100);
  };

  const completionPercent = getProfileCompletion();

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please grant photo library access to change your profile photo.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled && result.assets?.[0]) {
      uploadPhoto(result.assets[0].uri);
    }
  };

  const uploadPhoto = async (uri) => {
    try {
      const formData = new FormData();
      const filename = uri.split('/').pop();
      const match = /\.(\w+)$/.exec(filename);
      const type = match ? `image/${match[1]}` : 'image/jpeg';
      // Backend upload_profile_photo reads request.files["profile_photo"].
      formData.append('profile_photo', { uri, name: filename, type });

      const data = await apiClient.post('/api/user/upload-profile-photo', formData);
      const photoUrl = data?.profile_photo_url || data?.profile_photo;
      if (photoUrl) {
        setProfilePhoto(photoUrl);
        updateUser({ profile_photo_url: photoUrl });
      }
    } catch (err) {
      Alert.alert('Upload failed', err.message || 'Failed to upload photo. Please try again.');
    }
  };

  const handleSave = async () => {
    if (!firstName.trim()) {
      Alert.alert('Error', 'First name is required.');
      return;
    }
    if (!username.trim()) {
      Alert.alert('Error', 'Username is required.');
      return;
    }

    try {
      setSaving(true);
      const data = await apiClient.put('/api/user/update-profile', {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone: phone.trim(),
        username: username.trim(),
        display_name: displayName.trim(),
        bio: bio.trim(),
        whatsapp_number: whatsappNumber.trim(),
        emirate: emirate,
        area: area,
      });
      updateUser(data);
      Alert.alert('Success', 'Profile updated successfully.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (err) {
      Alert.alert('Error', err.message || 'Failed to update profile. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const getPasswordStrength = (pw) => {
    if (!pw) return { score: 0, label: '', color: 'transparent' };
    let score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (/[A-Z]/.test(pw)) score++;
    if (/[a-z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;

    if (score <= 2) return { score: 1, label: 'Weak', color: themeColors.error };
    if (score <= 3) return { score: 2, label: 'Fair', color: themeColors.warning };
    if (score <= 4) return { score: 3, label: 'Good', color: themeColors.info };
    return { score: 4, label: 'Strong', color: themeColors.success };
  };

  const passwordStrength = getPasswordStrength(newPassword);

  const handleUpdatePassword = async () => {
    if (!currentPassword.trim()) {
      Alert.alert('Error', 'Current password is required.');
      return;
    }
    if (!newPassword.trim()) {
      Alert.alert('Error', 'New password is required.');
      return;
    }
    if (newPassword.length < 8) {
      Alert.alert('Error', 'New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Error', 'New passwords do not match.');
      return;
    }
    if (newPassword === currentPassword) {
      Alert.alert('Error', 'New password must be different from current password.');
      return;
    }

    try {
      setPasswordSaving(true);
      await apiClient.post('/api/auth/update-password', {
        current_password: currentPassword,
        new_password: newPassword,
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      Alert.alert('Success', 'Password updated successfully.');
    } catch (err) {
      Alert.alert('Error', err.message || 'Failed to update password. Please check your current password.');
    } finally {
      setPasswordSaving(false);
    }
  };

  const handleSaveNotificationPreferences = async () => {
    try {
      setNotifSaving(true);
      const data = await apiClient.put('/api/user/update-profile', {
        notification_preferences: {
          email: notifEmail,
          sms: notifSms,
          marketing: notifMarketing,
        },
      });
      if (data) updateUser(data);
      Alert.alert('Success', 'Notification preferences saved.');
    } catch (err) {
      Alert.alert('Error', err.message || 'Failed to save notification preferences.');
    } finally {
      setNotifSaving(false);
    }
  };

  const handleSaveDealer = async () => {
    if (!dealerCompanyName.trim()) {
      Alert.alert('Error', 'Company name is required.');
      return;
    }
    if (!dealerRegNumber.trim()) {
      Alert.alert('Error', 'Company registration number is required.');
      return;
    }

    try {
      setDealerSaving(true);
      const data = await apiClient.put('/api/user/update-profile', {
        is_dealer: true,
        company_name: dealerCompanyName.trim(),
        company_registration_number: dealerRegNumber.trim(),
      });
      if (data) {
        updateUser(data);
        setDealerStatus('pending');
      }
      Alert.alert('Success', 'Your dealer application has been submitted for verification.');
    } catch (err) {
      Alert.alert('Error', err.message || 'Failed to submit dealer application.');
    } finally {
      setDealerSaving(false);
    }
  };

  const styles = useMemo(
    () => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: themeColors.black,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  photoSection: {
    alignItems: 'center',
    paddingVertical: SPACING.lg,
  },
  photoContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    position: 'relative',
  },
  photo: {
    width: 100,
    height: 100,
    borderRadius: 50,
  },
  photoPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: themeColors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: themeColors.border,
    borderStyle: 'dashed',
  },
  photoBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: themeColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: themeColors.black,
  },
  photoHint: {
    fontSize: FONT_SIZES.sm,
    color: themeColors.textMuted,
    marginTop: SPACING.sm,
  },
  form: {
    paddingHorizontal: SPACING.lg,
  },
  saveButton: {
    marginTop: SPACING.sm,
  },
  completionBar: {
    marginBottom: SPACING.lg,
    padding: SPACING.md,
    backgroundColor: themeColors.surface,
    borderRadius: BORDER_RADIUS.md,
  },
  completionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  completionLabel: {
    color: themeColors.white,
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
  },
  completionPercent: {
    color: themeColors.accent,
    fontSize: FONT_SIZES.sm,
    fontWeight: '700',
  },
  completionTrack: {
    height: 6,
    backgroundColor: themeColors.surfaceHigher,
    borderRadius: 3,
    overflow: 'hidden',
  },
  completionFill: {
    height: '100%',
    backgroundColor: themeColors.accent,
    borderRadius: 3,
  },
  usernameHint: {
    color: themeColors.textMuted,
    fontSize: FONT_SIZES.xs,
    marginTop: -8,
    marginBottom: 12,
    marginLeft: 4,
  },
  bioInput: {
    backgroundColor: themeColors.surfaceHigher,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: themeColors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: themeColors.white,
    fontSize: FONT_SIZES.md,
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: 16,
  },
  sectionDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: SPACING.lg,
    gap: 12,
  },
  sectionDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: themeColors.border,
  },
  sectionDividerText: {
    color: themeColors.white,
    fontSize: FONT_SIZES.md,
    fontWeight: '700',
  },
  pickerField: {
    marginBottom: 16,
  },
  pickerLabel: {
    color: themeColors.textSecondary,
    fontSize: FONT_SIZES.sm,
    marginBottom: 6,
    fontWeight: '500',
  },
  pickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: themeColors.surfaceHigher,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: themeColors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  pickerButtonText: {
    flex: 1,
    color: themeColors.white,
    fontSize: FONT_SIZES.md,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: themeColors.surface,
    borderTopLeftRadius: BORDER_RADIUS.xl,
    borderTopRightRadius: BORDER_RADIUS.xl,
    maxHeight: '60%',
    paddingBottom: 30,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: themeColors.border,
  },
  modalTitle: {
    color: themeColors.white,
    fontSize: FONT_SIZES.lg,
    fontWeight: '700',
  },
  modalItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: themeColors.borderLight,
  },
  modalItemActive: {
    backgroundColor: themeColors.surfaceHigher,
  },
  modalItemText: {
    color: themeColors.textSecondary,
    fontSize: FONT_SIZES.md,
  },
  modalItemTextActive: {
    color: themeColors.accent,
    fontWeight: '600',
  },
  passwordStrengthContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: -8,
    marginBottom: 12,
    marginLeft: 4,
    gap: 8,
  },
  strengthBars: {
    flexDirection: 'row',
    gap: 4,
  },
  strengthBar: {
    width: 24,
    height: 4,
    borderRadius: 2,
  },
  strengthLabel: {
    fontSize: FONT_SIZES.xs,
    fontWeight: '600',
  },
  toggleCard: {
    backgroundColor: themeColors.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  toggleInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  toggleTextWrap: {
    marginLeft: 12,
    flex: 1,
  },
  toggleLabel: {
    color: themeColors.white,
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
  },
  toggleDesc: {
    color: themeColors.textMuted,
    fontSize: FONT_SIZES.xs,
    marginTop: 2,
  },
  dealerStatusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: themeColors.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  dealerStatusLabel: {
    color: themeColors.textMuted,
    fontSize: FONT_SIZES.xs,
  },
  dealerStatusValue: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
  },
  dealerFields: {
    marginBottom: SPACING.sm,
  },
    }),
    [themeColors]
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={themeColors.accent} colors={[themeColors.accent]} />
        }
      >
        <View style={styles.photoSection}>
          <TouchableOpacity onPress={pickImage} style={styles.photoContainer} activeOpacity={0.7}>
            {profilePhoto ? (
              <Image source={{ uri: resolveMediaUrl(profilePhoto) }} style={styles.photo} />
            ) : (
              <View style={styles.photoPlaceholder}>
                <Ionicons name="camera-outline" size={32} color={themeColors.textMuted} />
              </View>
            )}
            <View style={styles.photoBadge}>
              <Ionicons name="pencil" size={12} color={themeColors.background} />
            </View>
          </TouchableOpacity>
          <Text style={styles.photoHint}>Tap to change photo</Text>
        </View>

        <View style={[appearanceStyles.card, { backgroundColor: themeColors.surface, borderColor: themeColors.border }]}>
          <View style={appearanceStyles.row}>
            <Ionicons name="contrast-outline" size={20} color={themeColors.textPrimary} />
            <View style={appearanceStyles.textWrap}>
              <Text style={[appearanceStyles.label, { color: themeColors.textPrimary }]}>Appearance</Text>
              <Text style={[appearanceStyles.desc, { color: themeColors.textMuted }]}>Choose how DPHClassifieds looks on this device</Text>
            </View>
          </View>
          <View style={appearanceStyles.segmented}>
            {[
              { value: 'light', label: 'Light', icon: 'sunny-outline' },
              { value: 'dark', label: 'Dark', icon: 'moon-outline' },
            ].map((option) => {
              const active = theme === option.value;
              return (
                <TouchableOpacity
                  key={option.value}
                  onPress={() => setTheme(option.value)}
                  activeOpacity={0.8}
                  style={[
                    appearanceStyles.segment,
                    {
                      backgroundColor: active ? themeColors.accent : 'transparent',
                      borderColor: themeColors.border,
                    },
                  ]}
                >
                  <Ionicons name={option.icon} size={16} color={active ? '#FFFFFF' : themeColors.textMuted} />
                  <Text style={[appearanceStyles.segmentLabel, { color: active ? '#FFFFFF' : themeColors.textMuted }]}>
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.form}>
          <View style={styles.completionBar}>
            <View style={styles.completionHeader}>
              <Text style={styles.completionLabel}>Profile Completion</Text>
              <Text style={styles.completionPercent}>{completionPercent}%</Text>
            </View>
            <View style={styles.completionTrack}>
              <View style={[styles.completionFill, { width: `${completionPercent}%` }]} />
            </View>
          </View>

          <Input
            label="Display Name"
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="How others see you"
            icon="person-outline"
          />

          <Input
            label="First Name"
            value={firstName}
            onChangeText={setFirstName}
            placeholder="Enter first name"
            icon="person-outline"
          />

          <Input
            label="Last Name"
            value={lastName}
            onChangeText={setLastName}
            placeholder="Enter last name"
            icon="person-outline"
          />

          <Input
            label="Email"
            value={email}
            onChangeText={() => {}}
            placeholder="Email address"
            icon="mail-outline"
          />

          <Input
            label="Phone Number"
            value={phone}
            onChangeText={setPhone}
            placeholder="Enter phone number"
            keyboardType="phone-pad"
            icon="call-outline"
          />

          <View>
            <Input
              label="Username"
              value={username}
              onChangeText={(v) => { setUsername(v); setUsernameStatus(null); }}
              onBlur={checkUsernameAvailability}
              placeholder="Enter username"
              icon="at-outline"
            />
            {usernameChecking && <Text style={styles.usernameHint}>Checking availability...</Text>}
            {usernameStatus === 'available' && <Text style={[styles.usernameHint, { color: themeColors.success }]}>Username available</Text>}
            {usernameStatus === 'taken' && <Text style={[styles.usernameHint, { color: themeColors.error }]}>Username already taken</Text>}
          </View>

          <Input
            label="WhatsApp Number"
            value={whatsappNumber}
            onChangeText={setWhatsappNumber}
            placeholder="Enter WhatsApp number"
            keyboardType="phone-pad"
            icon="logo-whatsapp"
          />

          <View>
            <Text style={{ color: themeColors.textSecondary, fontSize: FONT_SIZES.sm, marginBottom: 6, fontWeight: '500' }}>Bio</Text>
            <TextInput
              value={bio}
              onChangeText={setBio}
              placeholder="Tell others about yourself..."
              placeholderTextColor={themeColors.textMuted}
              multiline
              numberOfLines={3}
              style={styles.bioInput}
            />
          </View>

          <View style={styles.sectionDivider}>
            <View style={styles.sectionDividerLine} />
            <Text style={styles.sectionDividerText}>Location</Text>
            <View style={styles.sectionDividerLine} />
          </View>

          <View style={styles.pickerField}>
            <Text style={styles.pickerLabel}>Emirate</Text>
            <TouchableOpacity
              style={styles.pickerButton}
              onPress={() => setShowEmiratePicker(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="location-outline" size={18} color={themeColors.textMuted} style={{ marginRight: 10 }} />
              <Text style={[styles.pickerButtonText, !emirate && { color: themeColors.textMuted }]}>
                {emirate || 'Select Emirate'}
              </Text>
              <Ionicons name="chevron-down" size={18} color={themeColors.textMuted} />
            </TouchableOpacity>
          </View>

          {emirate ? (
            <View style={styles.pickerField}>
              <Text style={styles.pickerLabel}>Area</Text>
              <TouchableOpacity
                style={styles.pickerButton}
                onPress={() => setShowAreaPicker(true)}
                activeOpacity={0.7}
              >
                <Ionicons name="map-outline" size={18} color={themeColors.textMuted} style={{ marginRight: 10 }} />
                <Text style={[styles.pickerButtonText, !area && { color: themeColors.textMuted }]}>
                  {area || 'Select Area'}
                </Text>
                <Ionicons name="chevron-down" size={18} color={themeColors.textMuted} />
              </TouchableOpacity>
            </View>
          ) : null}

          <View style={styles.sectionDivider}>
            <View style={styles.sectionDividerLine} />
            <Text style={styles.sectionDividerText}>Change Password</Text>
            <View style={styles.sectionDividerLine} />
          </View>

          <Input
            label="Current Password"
            value={currentPassword}
            onChangeText={setCurrentPassword}
            placeholder="Enter current password"
            secureTextEntry
            icon="lock-closed-outline"
          />

          <Input
            label="New Password"
            value={newPassword}
            onChangeText={setNewPassword}
            placeholder="Enter new password"
            secureTextEntry
            icon="lock-closed-outline"
          />
          {newPassword.length > 0 && (
            <View style={styles.passwordStrengthContainer}>
              <View style={styles.strengthBars}>
                {[1, 2, 3, 4].map((i) => (
                  <View
                    key={i}
                    style={[
                      styles.strengthBar,
                      {
                        backgroundColor: i <= passwordStrength.score ? passwordStrength.color : themeColors.surfaceHigher,
                      },
                    ]}
                  />
                ))}
              </View>
              <Text style={[styles.strengthLabel, { color: passwordStrength.color }]}>
                {passwordStrength.label}
              </Text>
            </View>
          )}

          <Input
            label="Confirm New Password"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="Confirm new password"
            secureTextEntry
            icon="lock-closed-outline"
          />
          {confirmPassword.length > 0 && newPassword !== confirmPassword && (
            <Text style={{ color: themeColors.error, fontSize: FONT_SIZES.xs, marginTop: -8, marginBottom: 12, marginLeft: 4 }}>
              Passwords do not match
            </Text>
          )}

          <Button
            title="Update Password"
            onPress={handleUpdatePassword}
            loading={passwordSaving}
            disabled={passwordSaving || !currentPassword || !newPassword || !confirmPassword}
            size="lg"
            style={styles.saveButton}
          />

          <View style={styles.sectionDivider}>
            <View style={styles.sectionDividerLine} />
            <Text style={styles.sectionDividerText}>Notification Preferences</Text>
            <View style={styles.sectionDividerLine} />
          </View>

          <View style={styles.toggleCard}>
            <View style={styles.toggleRow}>
              <View style={styles.toggleInfo}>
                <Ionicons name="notifications-outline" size={20} color={themeColors.white} />
                <View style={styles.toggleTextWrap}>
                  <Text style={styles.toggleLabel}>Push Notifications</Text>
                  <Text style={styles.toggleDesc}>Instant alerts for leads, saved cars, and expiring listings</Text>
                </View>
              </View>
              <Switch
                value={notifPush}
                onValueChange={handleTogglePush}
                trackColor={{ false: themeColors.surfaceHigher, true: themeColors.accent }}
                thumbColor={themeColors.white}
              />
            </View>

            <View style={styles.toggleRow}>
              <View style={styles.toggleInfo}>
                <Ionicons name="mail-outline" size={20} color={themeColors.white} />
                <View style={styles.toggleTextWrap}>
                  <Text style={styles.toggleLabel}>Email Notifications</Text>
                  <Text style={styles.toggleDesc}>Get notified about your listings via email</Text>
                </View>
              </View>
              <Switch
                value={notifEmail}
                onValueChange={setNotifEmail}
                trackColor={{ false: themeColors.surfaceHigher, true: themeColors.accent }}
                thumbColor={themeColors.white}
              />
            </View>

            <View style={styles.toggleRow}>
              <View style={styles.toggleInfo}>
                <Ionicons name="chatbubble-outline" size={20} color={themeColors.white} />
                <View style={styles.toggleTextWrap}>
                  <Text style={styles.toggleLabel}>SMS Notifications</Text>
                  <Text style={styles.toggleDesc}>Receive text messages for important updates</Text>
                </View>
              </View>
              <Switch
                value={notifSms}
                onValueChange={setNotifSms}
                trackColor={{ false: themeColors.surfaceHigher, true: themeColors.accent }}
                thumbColor={themeColors.white}
              />
            </View>

            <View style={styles.toggleRow}>
              <View style={styles.toggleInfo}>
                <Ionicons name="megaphone-outline" size={20} color={themeColors.white} />
                <View style={styles.toggleTextWrap}>
                  <Text style={styles.toggleLabel}>Marketing Emails</Text>
                  <Text style={styles.toggleDesc}>Receive tips, promotions, and news</Text>
                </View>
              </View>
              <Switch
                value={notifMarketing}
                onValueChange={setNotifMarketing}
                trackColor={{ false: themeColors.surfaceHigher, true: themeColors.accent }}
                thumbColor={themeColors.white}
              />
            </View>
          </View>

          <Button
            title="Save Notification Preferences"
            onPress={handleSaveNotificationPreferences}
            loading={notifSaving}
            disabled={notifSaving}
            size="lg"
            style={styles.saveButton}
          />

          <View style={styles.sectionDivider}>
            <View style={styles.sectionDividerLine} />
            <Text style={styles.sectionDividerText}>Dealer Account</Text>
            <View style={styles.sectionDividerLine} />
          </View>

          {dealerStatus ? (
            <View style={styles.dealerStatusCard}>
              <Ionicons
                name={dealerStatus === 'verified' ? 'checkmark-circle' : 'time-outline'}
                size={24}
                color={dealerStatus === 'verified' ? themeColors.success : themeColors.warning}
              />
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text style={styles.dealerStatusLabel}>Dealer Status</Text>
                <Text style={[styles.dealerStatusValue, { color: dealerStatus === 'verified' ? themeColors.success : themeColors.warning }]}>
                  {dealerStatus === 'verified' ? 'Verified Dealer' : dealerStatus === 'pending' ? 'Verification Pending' : dealerStatus}
                </Text>
              </View>
            </View>
          ) : (
            <>
              <View style={styles.toggleCard}>
                <View style={styles.toggleRow}>
                  <View style={styles.toggleInfo}>
                    <Ionicons name="business-outline" size={20} color={themeColors.white} />
                    <View style={styles.toggleTextWrap}>
                      <Text style={styles.toggleLabel}>Become a Dealer / Business Account</Text>
                      <Text style={styles.toggleDesc}>List vehicles as a business and reach more buyers</Text>
                    </View>
                  </View>
                  <Switch
                    value={isDealer}
                    onValueChange={setIsDealer}
                    trackColor={{ false: themeColors.surfaceHigher, true: themeColors.accent }}
                    thumbColor={themeColors.white}
                  />
                </View>
              </View>

              {isDealer && (
                <View style={styles.dealerFields}>
                  <Input
                    label="Company Name"
                    value={dealerCompanyName}
                    onChangeText={setDealerCompanyName}
                    placeholder="Enter company name"
                    icon="business-outline"
                  />
                  <Input
                    label="Company Registration Number"
                    value={dealerRegNumber}
                    onChangeText={setDealerRegNumber}
                    placeholder="Enter registration number"
                    icon="document-text-outline"
                  />
                  <Button
                    title="Submit for Verification"
                    onPress={handleSaveDealer}
                    loading={dealerSaving}
                    disabled={dealerSaving || !dealerCompanyName.trim() || !dealerRegNumber.trim()}
                    size="lg"
                    style={styles.saveButton}
                  />
                </View>
              )}
            </>
          )}

          <Button
            title="Save Changes"
            onPress={handleSave}
            loading={saving}
            disabled={saving}
            size="lg"
            style={[styles.saveButton, { marginBottom: SPACING.xl }]}
          />
        </View>
      </ScrollView>

      <Modal visible={showEmiratePicker} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Emirate</Text>
              <TouchableOpacity onPress={() => setShowEmiratePicker(false)}>
                <Ionicons name="close" size={24} color={themeColors.white} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={UAE_EMIRATES_WITH_AL_AIN}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.modalItem, emirate === item && styles.modalItemActive]}
                  onPress={() => {
                    setEmirate(item);
                    setArea('');
                    setShowEmiratePicker(false);
                  }}
                >
                  <Text style={[styles.modalItemText, emirate === item && styles.modalItemTextActive]}>
                    {item}
                  </Text>
                  {emirate === item && <Ionicons name="checkmark" size={20} color={themeColors.accent} />}
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>

      <Modal visible={showAreaPicker} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Area ({emirate})</Text>
              <TouchableOpacity onPress={() => setShowAreaPicker(false)}>
                <Ionicons name="close" size={24} color={themeColors.white} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={areasForEmirate}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.modalItem, area === item && styles.modalItemActive]}
                  onPress={() => {
                    setArea(item);
                    setShowAreaPicker(false);
                  }}
                >
                  <Text style={[styles.modalItemText, area === item && styles.modalItemTextActive]}>
                    {item}
                  </Text>
                  {area === item && <Ionicons name="checkmark" size={20} color={themeColors.accent} />}
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}


// Colors for this block come from useTheme() inline (see JSX) — it's the one
// part of this screen that must respond live to the toggle it renders.
// Layout-only values are theme-invariant, so a plain StyleSheet is fine here.
const appearanceStyles = StyleSheet.create({
  card: {
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.lg,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  textWrap: {
    marginLeft: 12,
    flex: 1,
  },
  label: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
  },
  desc: {
    fontSize: FONT_SIZES.xs,
    marginTop: 2,
  },
  segmented: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
  },
  segmentLabel: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
  },
});
