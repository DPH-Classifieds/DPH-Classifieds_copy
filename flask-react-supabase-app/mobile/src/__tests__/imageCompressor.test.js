import { compressImage } from '../utils/imageCompressor';
import * as ImageManipulator from 'expo-image-manipulator';

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg' },
}));

afterEach(() => jest.clearAllMocks());

test('compressImage calls manipulateAsync with resize and compress', async () => {
  ImageManipulator.manipulateAsync.mockResolvedValue({ uri: 'compressed://result.jpg', width: 1080, height: 720 });
  const result = await compressImage('file://original.jpg');
  expect(ImageManipulator.manipulateAsync).toHaveBeenCalledWith(
    'file://original.jpg',
    [{ resize: { width: 1920 } }],
    { compress: 0.85, format: 'jpeg' }
  );
  expect(result.uri).toBe('compressed://result.jpg');
});

test('compressImage returns original uri on error', async () => {
  ImageManipulator.manipulateAsync.mockRejectedValue(new Error('fail'));
  const result = await compressImage('file://original.jpg');
  expect(result.uri).toBe('file://original.jpg');
});
