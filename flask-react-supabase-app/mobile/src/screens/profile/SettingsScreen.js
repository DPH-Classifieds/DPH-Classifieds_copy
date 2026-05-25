import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  StyleSheet,
  Image,
  TextInput,
  Switch,
  Modal,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../../context/AuthContext';
import apiClient from '../../utils/apiClient';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';
import { UAE_EMIRATES, EMIRATE_AREAS } from '../../utils/listingConstants';

const UAE_EMIRATES_WITH_AL_AIN = [...UAE_EMIRATES, 'Al Ain'];

export default function SettingsScreen({ navigation }) {
  const { user, updateUser } = useAuth();
  const [firstName, setFirstName] = useState(user?.first_name || '');
  const [lastName, setLastName] = useState(user?.last_name || '');
  const [email] = useState(user?.email || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [username, setUsername] = useState(user?.username || '');
  const [displayName, setDisplayName] = useState(user?.display_name || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [whatsappNumber, setWhatsappNumber] = useState(user?.whatsapp_number || '');
  const [profilePhoto, setProfilePhoto] = useState(user?.profile_photo || user?.avatar_url || null);
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
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
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
      formData.append('photo', { uri, name: filename, type });

      const data = await apiClient.post('/api/user/upload-profile-photo', formData);
      if (data?.profile_photo) {
        setProfilePhoto(data.profile_photo);
        updateUser({ profile_photo: data.profile_photo });
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

    if (score <= 2) return { score: 1, label: 'Weak', color: COLORS.error };
    if (score <= 3) return { score: 2, label: 'Fair', color: COLORS.warning };
    if (score <= 4) return { score: 3, label: 'Good', color: COLORS.info };
    return { score: 4, label: 'Strong', color: COLORS.success };
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

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.photoSection}>
          <TouchableOpacity onPress={pickImage} style={styles.photoContainer} activeOpacity={0.7}>
            {profilePhoto ? (
              <Image source={{ uri: profilePhoto }} style={styles.photo} />
            ) : (
              <View style={styles.photoPlaceholder}>
                <Ionicons name="camera-outline" size={32} color={COLORS.textMuted} />
              </View>
            )}
            <View style={styles.photoBadge}>
              <Ionicons name="pencil" size={12} color={COLORS.white} />
            </View>
          </TouchableOpacity>
          <Text style={styles.photoHint}>Tap to change photo</Text>
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
            {usernameStatus === 'available' && <Text style={[styles.usernameHint, { color: COLORS.success }]}>Username available</Text>}
            {usernameStatus === 'taken' && <Text style={[styles.usernameHint, { color: COLORS.error }]}>Username already taken</Text>}
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
            <Text style={{ color: COLORS.textSecondary, fontSize: FONT_SIZES.sm, marginBottom: 6, fontWeight: '500' }}>Bio</Text>
            <TextInput
              value={bio}
              onChangeText={setBio}
              placeholder="Tell others about yourself..."
              placeholderTextColor={COLORS.textMuted}
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
              <Ionicons name="location-outline" size={18} color={COLORS.textMuted} style={{ marginRight: 10 }} />
              <Text style={[styles.pickerButtonText, !emirate && { color: COLORS.textMuted }]}>
                {emirate || 'Select Emirate'}
              </Text>
              <Ionicons name="chevron-down" size={18} color={COLORS.textMuted} />
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
                <Ionicons name="map-outline" size={18} color={COLORS.textMuted} style={{ marginRight: 10 }} />
                <Text style={[styles.pickerButtonText, !area && { color: COLORS.textMuted }]}>
                  {area || 'Select Area'}
                </Text>
                <Ionicons name="chevron-down" size={18} color={COLORS.textMuted} />
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
                        backgroundColor: i <= passwordStrength.score ? passwordStrength.color : COLORS.surfaceHigher,
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
            <Text style={{ color: COLORS.error, fontSize: FONT_SIZES.xs, marginTop: -8, marginBottom: 12, marginLeft: 4 }}>
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
                <Ionicons name="mail-outline" size={20} color={COLORS.white} />
                <View style={styles.toggleTextWrap}>
                  <Text style={styles.toggleLabel}>Email Notifications</Text>
                  <Text style={styles.toggleDesc}>Get notified about your listings via email</Text>
                </View>
              </View>
              <Switch
                value={notifEmail}
                onValueChange={setNotifEmail}
                trackColor={{ false: COLORS.surfaceHigher, true: COLORS.accent }}
                thumbColor={COLORS.white}
              />
            </View>

            <View style={styles.toggleRow}>
              <View style={styles.toggleInfo}>
                <Ionicons name="chatbubble-outline" size={20} color={COLORS.white} />
                <View style={styles.toggleTextWrap}>
                  <Text style={styles.toggleLabel}>SMS Notifications</Text>
                  <Text style={styles.toggleDesc}>Receive text messages for important updates</Text>
                </View>
              </View>
              <Switch
                value={notifSms}
                onValueChange={setNotifSms}
                trackColor={{ false: COLORS.surfaceHigher, true: COLORS.accent }}
                thumbColor={COLORS.white}
              />
            </View>

            <View style={styles.toggleRow}>
              <View style={styles.toggleInfo}>
                <Ionicons name="megaphone-outline" size={20} color={COLORS.white} />
                <View style={styles.toggleTextWrap}>
                  <Text style={styles.toggleLabel}>Marketing Emails</Text>
                  <Text style={styles.toggleDesc}>Receive tips, promotions, and news</Text>
                </View>
              </View>
              <Switch
                value={notifMarketing}
                onValueChange={setNotifMarketing}
                trackColor={{ false: COLORS.surfaceHigher, true: COLORS.accent }}
                thumbColor={COLORS.white}
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
                color={dealerStatus === 'verified' ? COLORS.success : COLORS.warning}
              />
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text style={styles.dealerStatusLabel}>Dealer Status</Text>
                <Text style={[styles.dealerStatusValue, { color: dealerStatus === 'verified' ? COLORS.success : COLORS.warning }]}>
                  {dealerStatus === 'verified' ? 'Verified Dealer' : dealerStatus === 'pending' ? 'Verification Pending' : dealerStatus}
                </Text>
              </View>
            </View>
          ) : (
            <>
              <View style={styles.toggleCard}>
                <View style={styles.toggleRow}>
                  <View style={styles.toggleInfo}>
                    <Ionicons name="business-outline" size={20} color={COLORS.white} />
                    <View style={styles.toggleTextWrap}>
                      <Text style={styles.toggleLabel}>Become a Dealer / Business Account</Text>
                      <Text style={styles.toggleDesc}>List vehicles as a business and reach more buyers</Text>
                    </View>
                  </View>
                  <Switch
                    value={isDealer}
                    onValueChange={setIsDealer}
                    trackColor={{ false: COLORS.surfaceHigher, true: COLORS.accent }}
                    thumbColor={COLORS.white}
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
                <Ionicons name="close" size={24} color={COLORS.white} />
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
                  {emirate === item && <Ionicons name="checkmark" size={20} color={COLORS.accent} />}
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
                <Ionicons name="close" size={24} color={COLORS.white} />
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
                  {area === item && <Ionicons name="checkmark" size={20} color={COLORS.accent} />}
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.black,
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
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
  },
  photoBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.black,
  },
  photoHint: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
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
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
  },
  completionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  completionLabel: {
    color: COLORS.white,
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
  },
  completionPercent: {
    color: COLORS.accent,
    fontSize: FONT_SIZES.sm,
    fontWeight: '700',
  },
  completionTrack: {
    height: 6,
    backgroundColor: COLORS.surfaceHigher,
    borderRadius: 3,
    overflow: 'hidden',
  },
  completionFill: {
    height: '100%',
    backgroundColor: COLORS.accent,
    borderRadius: 3,
  },
  usernameHint: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.xs,
    marginTop: -8,
    marginBottom: 12,
    marginLeft: 4,
  },
  bioInput: {
    backgroundColor: COLORS.surfaceHigher,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: COLORS.white,
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
    backgroundColor: COLORS.border,
  },
  sectionDividerText: {
    color: COLORS.white,
    fontSize: FONT_SIZES.md,
    fontWeight: '700',
  },
  pickerField: {
    marginBottom: 16,
  },
  pickerLabel: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.sm,
    marginBottom: 6,
    fontWeight: '500',
  },
  pickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surfaceHigher,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  pickerButtonText: {
    flex: 1,
    color: COLORS.white,
    fontSize: FONT_SIZES.md,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: COLORS.surface,
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
    borderBottomColor: COLORS.border,
  },
  modalTitle: {
    color: COLORS.white,
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
    borderBottomColor: COLORS.borderLight,
  },
  modalItemActive: {
    backgroundColor: COLORS.surfaceHigher,
  },
  modalItemText: {
    color: COLORS.textSecondary,
    fontSize: FONT_SIZES.md,
  },
  modalItemTextActive: {
    color: COLORS.accent,
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
    backgroundColor: COLORS.surface,
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
    color: COLORS.white,
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
  },
  toggleDesc: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.xs,
    marginTop: 2,
  },
  dealerStatusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  dealerStatusLabel: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.xs,
  },
  dealerStatusValue: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
  },
  dealerFields: {
    marginBottom: SPACING.sm,
  },
});
