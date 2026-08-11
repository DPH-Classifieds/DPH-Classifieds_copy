import {
  buildSupabaseStorageHost,
  buildStorageObjectPath,
  shouldUseResumableUpload,
  ensureUploadableImage,
} from './directUpload';

jest.mock('heic2any', () => ({
  __esModule: true,
  default: jest.fn(async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' })),
}));

describe('directUpload helpers', () => {
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
    const jpg = new File([new Uint8Array([0])], 'photo.jpg', { type: 'image/jpeg' });
    expect(await ensureUploadableImage(jpg)).toBe(jpg);
  });
});
