jest.mock('./apiClient', () => ({
  __esModule: true,
  default: { post: jest.fn() },
}));

jest.mock('./supabaseClient', () => ({
  supabase: {
    storage: {
      from: jest.fn(() => ({
        uploadToSignedUrl: jest.fn(async () => ({ data: {}, error: null })),
      })),
    },
  },
}));

import {
  buildSupabaseStorageHost,
  buildStorageObjectPath,
  shouldUseResumableUpload,
  ensureUploadableImage,
  isListingImageCandidate,
  optimizePhotoForUpload,
  LISTING_IMAGE_MAX_DIMENSION,
  PROFILE_PHOTO_MAX_DIMENSION,
  PHOTO_OPTIMIZATION_QUALITY,
  uploadListingImageUrlsDirect,
  uploadRegistrationDocument,
} from './directUpload';
import apiClient from './apiClient';
import { supabase } from './supabaseClient';
import heic2any from 'heic2any';

jest.mock('heic2any', () => ({
  __esModule: true,
  default: jest.fn(async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' })),
}));

describe('directUpload helpers', () => {
  beforeEach(() => {
    heic2any.mockResolvedValue(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }));
    supabase.storage.from.mockReturnValue({
      uploadToSignedUrl: jest.fn(async () => ({ data: {}, error: null })),
    });
  });

  test('builds the direct storage hostname from the project url', () => {
    expect(buildSupabaseStorageHost('https://ltjatsyhpmvewancqdjw.supabase.co')).toBe(
      'https://ltjatsyhpmvewancqdjw.storage.supabase.co'
    );
  });

  test('builds a unique object path with the user id folder', () => {
    const path = buildStorageObjectPath({
      userId: 'user-123',
      fileName: 'My Car Photo.PNG',
      suffix: 'display',
      extension: 'jpg',
      idFactory: () => 'abc123',
    });

    expect(path).toBe('user-123/abc123_display.jpg');
  });

  test('uses resumable uploads only when the file exceeds the standard threshold', () => {
    expect(shouldUseResumableUpload(6 * 1024 * 1024)).toBe(false);
    expect(shouldUseResumableUpload(6 * 1024 * 1024 + 1)).toBe(true);
  });

  test('converts a HEIC file to a JPEG File before upload', async () => {
    const heic = new File([new Uint8Array([0])], 'IMG_1234.HEIC', { type: 'image/heic' });
    const out = await ensureUploadableImage(heic);
    expect(out).not.toBe(heic);
    expect(out.type).toBe('image/jpeg');
    expect(out.name).toBe('IMG_1234.jpg');
  });

  test('passes non-HEIC images through untouched', async () => {
    // A real JPEG SOI header so the byte-sniff does not misfire.
    const jpg = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])], 'photo.jpg', {
      type: 'image/jpeg',
    });
    expect(await ensureUploadableImage(jpg)).toBe(jpg);
  });

  test('bounds listing photos and converts them to quality-controlled JPEGs', async () => {
    const originalImage = global.Image;
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const canvas = {
      getContext: jest.fn(() => ({ drawImage: jest.fn() })),
      toBlob: jest.fn((callback, type, quality) => {
        expect(type).toBe('image/jpeg');
        expect(quality).toBe(PHOTO_OPTIMIZATION_QUALITY);
        callback(new Blob(['optimized'], { type }));
      }),
    };

    global.Image = class MockImage {
      constructor() {
        this.width = 4800;
        this.height = 2400;
      }

      set src(_value) {
        this.onload();
      }
    };
    URL.createObjectURL = jest.fn(() => 'blob:photo');
    URL.revokeObjectURL = jest.fn();
    jest.spyOn(document, 'createElement').mockReturnValue(canvas);

    try {
      const photo = new File(['source'], 'large-photo.png', { type: 'image/png' });
      const optimized = await optimizePhotoForUpload(photo);

      expect(optimized).not.toBe(photo);
      expect(optimized.type).toBe('image/jpeg');
      expect(optimized.name).toBe('large-photo.jpg');
      expect(canvas.width).toBe(LISTING_IMAGE_MAX_DIMENSION);
      expect(canvas.height).toBe(LISTING_IMAGE_MAX_DIMENSION / 2);
    } finally {
      document.createElement.mockRestore();
      global.Image = originalImage;
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    }
  });

  test('uses the smaller profile-photo dimension cap', async () => {
    const originalImage = global.Image;
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const canvas = {
      getContext: jest.fn(() => ({ drawImage: jest.fn() })),
      toBlob: jest.fn((callback) => callback(new Blob(['optimized'], { type: 'image/jpeg' }))),
    };

    global.Image = class MockImage {
      constructor() {
        this.width = 3200;
        this.height = 2400;
      }

      set src(_value) {
        this.onload();
      }
    };
    URL.createObjectURL = jest.fn(() => 'blob:profile');
    URL.revokeObjectURL = jest.fn();
    jest.spyOn(document, 'createElement').mockReturnValue(canvas);

    try {
      const photo = new File(['source'], 'profile.webp', { type: 'image/webp' });
      await optimizePhotoForUpload(photo, { maxDimension: PROFILE_PHOTO_MAX_DIMENSION });

      expect(canvas.width).toBe(PROFILE_PHOTO_MAX_DIMENSION);
      expect(canvas.height).toBe(1200);
    } finally {
      document.createElement.mockRestore();
      global.Image = originalImage;
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    }
  });

  test('detects a HEIC mislabeled as .jpg (image/jpeg) by sniffing bytes', async () => {
    // ISO-BMFF header: [size][ftyp][brand] — matches IMG_1506.jpg (ftypheic).
    const header = new Uint8Array([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, // ....ftyp
      0x68, 0x65, 0x69, 0x63, 0x00, 0x00, 0x00, 0x00, // heic....
    ]);
    const mislabeled = new File([header], 'IMG_1506.jpg', { type: 'image/jpeg' });
    const out = await ensureUploadableImage(mislabeled);
    expect(out).not.toBe(mislabeled);
    expect(out.type).toBe('image/jpeg');
    expect(out.name).toBe('IMG_1506.jpg');
  });

  test('accepts a MIME-less HEIC selected through drag and drop', () => {
    const heic = new File([new Uint8Array([1])], 'IMG_2828.HEIC', { type: '' });
    expect(isListingImageCandidate(heic)).toBe(true);
  });

  test('persists the public URL returned by the signed-upload API', async () => {
    apiClient.post.mockResolvedValue({
      token: 'upload-token',
      public_url: 'https://storage.example/listing-images/user-123/photo.jpg',
    });
    const photo = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'photo.jpg', {
      type: 'image/jpeg',
    });

    await expect(uploadListingImageUrlsDirect([photo], { userId: 'user-123' })).resolves.toEqual([
      'https://storage.example/listing-images/user-123/photo.jpg',
    ]);
  });

  test('fails explicitly instead of submitting an image with an undefined URL', async () => {
    apiClient.post.mockResolvedValue({ token: 'upload-token' });
    const photo = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'photo.jpg', {
      type: 'image/jpeg',
    });

    await expect(uploadListingImageUrlsDirect([photo], { userId: 'user-123' }))
      .rejects.toThrow('did not return a usable image URL');
  });

  test('persists a private registration-document object path, never a public URL', async () => {
    apiClient.post.mockResolvedValue({ token: 'upload-token', path: 'user-123/plate-proofs/server-issued.jpg' });
    const document = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'proof.jpg', {
      type: 'image/jpeg',
    });

    await expect(uploadRegistrationDocument(document, {
      userId: 'user-123',
      pathPrefix: 'plate-proofs',
    })).resolves.toMatch(/^user-123\/plate-proofs\/[^/]+\.jpg$/);
  });

  test('does not run photo optimization for registration documents', async () => {
    const documentFile = new File(['source'], 'proof.png', { type: 'image/png' });
    const uploadToSignedUrl = jest.fn(async () => ({ data: {}, error: null }));
    supabase.storage.from.mockReturnValue({ uploadToSignedUrl });
    apiClient.post.mockResolvedValue({ token: 'upload-token', path: 'user-123/proof.png' });

    await uploadRegistrationDocument(documentFile, { userId: 'user-123' });

    expect(uploadToSignedUrl).toHaveBeenCalledWith(
      expect.any(String),
      'upload-token',
      documentFile,
      expect.objectContaining({ contentType: 'image/png' })
    );
  });
});
