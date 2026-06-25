import { swrGet, swrSet, swrInvalidate, swrInvalidatePrefix } from '../utils/swrCache';
import AsyncStorage from '@react-native-async-storage/async-storage';

afterEach(() => AsyncStorage.clear());

test('swrGet returns null for missing key', async () => {
  expect(await swrGet('missing')).toBeNull();
});

test('swrSet and swrGet round-trip within TTL', async () => {
  await swrSet('k1', { x: 1 }, 60);
  const result = await swrGet('k1', 60);
  expect(result?.value).toEqual({ x: 1 });
});

test('swrGet returns null when expired', async () => {
  await swrSet('k2', { x: 2 }, 1);
  const key = 'dph_swr:k2';
  const raw = JSON.parse(await AsyncStorage.getItem(key));
  raw.savedAt = Date.now() - 2000;
  await AsyncStorage.setItem(key, JSON.stringify(raw));
  expect(await swrGet('k2', 1)).toBeNull();
});

test('swrInvalidate removes a key', async () => {
  await swrSet('k3', 'val', 60);
  await swrInvalidate('k3');
  expect(await swrGet('k3', 60)).toBeNull();
});

test('swrInvalidatePrefix removes matching keys only', async () => {
  await swrSet('cars:1', 'a', 60);
  await swrSet('cars:2', 'b', 60);
  await swrSet('bikes:1', 'c', 60);
  await swrInvalidatePrefix('cars:');
  expect(await swrGet('cars:1', 60)).toBeNull();
  expect(await swrGet('cars:2', 60)).toBeNull();
  expect((await swrGet('bikes:1', 60))?.value).toBe('c');
});
