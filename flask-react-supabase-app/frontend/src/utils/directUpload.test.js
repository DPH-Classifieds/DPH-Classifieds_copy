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
    // A real JPEG SOI header so the byte-sniff does not misfire.
    const jpg = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])], 'photo.jpg', {
      type: 'image/jpeg',
    });
    expect(await ensureUploadableImage(jpg)).toBe(jpg);
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
});
