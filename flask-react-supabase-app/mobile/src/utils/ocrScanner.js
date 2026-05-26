import * as ImagePicker from 'expo-image-picker';
import apiClient from './apiClient';
import { normalizeRegistrationScanResponse } from './registrationScan';

const pickRegistrationImage = async (source) => {
  if (source === 'camera') {
    const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
    if (!permissionResult.granted) {
      throw new Error('Camera permission is required for OCR scanning.');
    }

    return ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 1,
      allowsEditing: true,
      exif: true,
    });
  }

  const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permissionResult.granted) {
    throw new Error('Photo library permission is required for OCR scanning.');
  }

  return ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 1,
    allowsEditing: true,
    exif: true,
  });
};

export const scanCarRegistration = async ({
  source = 'camera',
  documentType = 'mulkiya',
  listingType = 'car',
  listingId = null,
} = {}) => {
  try {
    const result = await pickRegistrationImage(source);

    if (result.canceled || !result.assets?.[0]) {
      return null;
    }

    const asset = result.assets[0];

    // Upload image and send to backend for OCR processing
    const formData = new FormData();
    formData.append('image', {
      uri: asset.uri,
      type: asset.mimeType || 'image/jpeg',
      name: 'registration.jpg',
    });
    formData.append('document_type', documentType);
    formData.append('listing_type', listingType);
    if (listingId) {
      formData.append('listing_id', listingId);
    }

    const data = await apiClient.post('/api/ocr/scan-registration', formData);
    return normalizeRegistrationScanResponse(data);
  } catch (err) {
    console.error('OCR scan error:', err);
    throw err;
  }
};
