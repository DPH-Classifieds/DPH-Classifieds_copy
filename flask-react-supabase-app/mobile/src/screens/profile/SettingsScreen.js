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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../../context/AuthContext';
import apiClient from '../../utils/apiClient';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';

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
  const [location, setLocation] = useState(user?.location || '');
  const [profilePhoto, setProfilePhoto] = useState(user?.profile_photo || user?.avatar_url || null);
  const [saving, setSaving] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState(null);
  const [usernameChecking, setUsernameChecking] = useState(false);

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
    const fields = [firstName, lastName, email, phone, username, displayName, bio, whatsappNumber, location, profilePhoto];
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
        location: location.trim(),
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

          <Input
            label="Location"
            value={location}
            onChangeText={setLocation}
            placeholder="e.g. Dubai, UAE"
            icon="location-outline"
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

          <Button
            title="Save Changes"
            onPress={handleSave}
            loading={saving}
            disabled={saving}
            size="lg"
            style={styles.saveButton}
          />
        </View>
      </ScrollView>
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
});
