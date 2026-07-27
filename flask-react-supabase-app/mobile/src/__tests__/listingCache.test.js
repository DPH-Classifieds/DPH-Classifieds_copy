jest.mock('expo-image', () => ({ Image: { prefetch: jest.fn(() => Promise.resolve(true)) } }));
jest.mock('../utils/media', () => ({ resolveMediaUrl: (u) => u }));

import { getCachedListing, prefetchListing, prefetchListingWindow } from '../utils/listingCache';
import { Image } from 'expo-image';

test('getCachedListing returns null when nothing is cached', () => {
  expect(getCachedListing('cars', 'missing')).toBeNull();
});

test('prefetchListing stores the item for instant open', () => {
  const item = { id: 'c1', images: ['a.jpg'] };
  prefetchListing('cars', item);
  expect(getCachedListing('cars', 'c1')).toEqual(item);
});

test('prefetchListingWindow stores every visible item', () => {
  prefetchListingWindow('bikes', [{ id: 'b1' }, { id: 'b2' }]);
  expect(getCachedListing('bikes', 'b1')).toBeTruthy();
  expect(getCachedListing('bikes', 'b2')).toBeTruthy();
});

test('warms images through expo-image (shared cache), deduped', () => {
  Image.prefetch.mockClear();
  prefetchListing('parts', { id: 'p1', images: ['x.jpg', 'y.jpg'] });
  expect(Image.prefetch).toHaveBeenCalledTimes(2);
  Image.prefetch.mockClear();
  prefetchListing('parts', { id: 'p1', images: ['x.jpg', 'y.jpg'] }); // same URIs
  expect(Image.prefetch).not.toHaveBeenCalled(); // already warmed
});

test('ignores items without an id', () => {
  prefetchListing('cars', { images: ['z.jpg'] });
  expect(getCachedListing('cars', 'undefined')).toBeNull();
});
