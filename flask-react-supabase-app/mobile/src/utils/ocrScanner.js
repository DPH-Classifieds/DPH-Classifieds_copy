import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import apiClient from './apiClient';
import { normalizeRegistrationScanResponse } from './registrationScan';

const pickFromCamera = async () => {
  const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
  if (!permissionResult.granted) {
    throw new Error('Camera permission is required for OCR scanning.');
  }
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    quality: 1,
    allowsEditing: true,
    exif: true,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  return {
    uri: asset.uri,
    mimeType: asset.mimeType || 'image/jpeg',
    name: 'registration.jpg',
  };
};

const pickFromLibrary = async () => {
  const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permissionResult.granted) {
    throw new Error('Photo library permission is required for OCR scanning.');
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 1,
    allowsEditing: true,
    exif: true,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  return {
    uri: asset.uri,
    mimeType: asset.mimeType || 'image/jpeg',
    name: asset.fileName || 'registration.jpg',
  };
};

const pickFromFile = async () => {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['image/*', 'application/pdf'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  return {
    uri: asset.uri,
    mimeType: asset.mimeType || (asset.name?.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg'),
    name: asset.name || 'registration',
  };
};

const pickRegistrationFile = async (source) => {
  if (source === 'camera') return pickFromCamera();
  if (source === 'library') return pickFromLibrary();
  if (source === 'file') return pickFromFile();
  return pickFromCamera();
};

export const scanCarRegistration = async ({
  source = 'camera',
  documentType = 'mulkiya',
  listingType = 'car',
  listingId = null,
} = {}) => {
  try {
    const file = await pickRegistrationFile(source);
    if (!file) return null;

    const formData = new FormData();
    formData.append('image', {
      uri: file.uri,
      type: file.mimeType,
      name: file.name,
    });
    formData.append('document_type', documentType);
    if (listingType && listingId) {
      formData.append('listing_type', listingType);
      formData.append('listing_id', listingId);
    }

    const data = await apiClient.post('/api/ocr/scan-registration', formData);
    return normalizeRegistrationScanResponse(data);
  } catch (err) {
    if (__DEV__) console.error('OCR scan error:', err);
    throw err;
  }
};

// Picks a registration/mulkiya photo/file and runs it through the structured,
// validated /scan-registration endpoint (VIN charset + checksum-aware repair +
// NHTSA decode, and label-proximity plate-number extraction). Also uploads the
// original to the registration-documents bucket so bike/plate listings keep a
// registration_doc_url for admin verification. Returns the normalized scan plus
// documentUrl. Replaces the old hf-extract + blind-regex approach, which could
// auto-fill a fabricated VIN or grab the wrong short number for plates.
export const scanRegistrationStructured = async ({ source = 'camera', documentType = 'mulkiya' } = {}) => {
  const file = await pickRegistrationFile(source);
  if (!file) return null;

  const scanForm = new FormData();
  scanForm.append('image', { uri: file.uri, type: file.mimeType, name: file.name });
  scanForm.append('document_type', documentType);

  const uploadForm = new FormData();
  uploadForm.append('images', { uri: file.uri, type: file.mimeType, name: file.name });

  const [scanData, uploadResponse] = await Promise.all([
    apiClient.post('/api/ocr/scan-registration', scanForm),
    apiClient.post('/api/upload-images', uploadForm).catch(() => null),
  ]);

  const documentUrl =
    uploadResponse?.absolute_urls?.[0] ||
    uploadResponse?.urls?.[0] ||
    uploadResponse?.images?.[0]?.url ||
    uploadResponse?.images?.[0]?.image_url ||
    null;

  return { ...normalizeRegistrationScanResponse(scanData), documentUrl };
};
