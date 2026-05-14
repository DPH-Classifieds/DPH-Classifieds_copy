import * as ImagePicker from 'expo-image-picker';
import apiClient from './apiClient';

export const scanCarRegistration = async () => {
  try {
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissionResult.granted) {
      throw new Error('Photo library permission is required for OCR scanning.');
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });

    if (result.canceled || !result.assets?.[0]) {
      return null;
    }

    const asset = result.assets[0];

    // Upload image and send to backend for OCR processing
    const formData = new FormData();
    formData.append('image', {
      uri: asset.uri,
      type: 'image/jpeg',
      name: 'registration.jpg',
    });

    const response = await fetch(`${apiClient.baseUrl || ''}/api/ocr/scan-registration`, {
      method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data',
        ...(apiClient.getHeaders ? apiClient.getHeaders() : {}),
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error('OCR processing failed');
    }

    const data = await response.json();
    return data;
  } catch (err) {
    console.error('OCR scan error:', err);
    throw err;
  }
};
