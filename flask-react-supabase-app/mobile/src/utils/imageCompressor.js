import * as ImageManipulator from 'expo-image-manipulator';

export const compressImage = async (uri) => {
  try {
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 1920 } }],
      { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG }
    );
    return result;
  } catch {
    return { uri };
  }
};
