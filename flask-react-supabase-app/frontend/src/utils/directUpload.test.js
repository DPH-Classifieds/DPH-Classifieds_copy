import {
  buildSupabaseStorageHost,
  buildStorageObjectPath,
  shouldUseResumableUpload,
} from './directUpload';

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
});
