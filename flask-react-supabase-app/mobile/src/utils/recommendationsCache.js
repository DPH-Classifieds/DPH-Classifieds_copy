import { swrGet, swrSet } from './swrCache';

const memoryCache = new Map();
const TTL_SECONDS = 5 * 60;

const cacheKey = (listingType, listingId) =>
  `recommendations:${listingType}:${listingId}:v1`;

export const getMemoryRecommendations = (listingType, listingId) =>
  memoryCache.get(cacheKey(listingType, listingId)) || null;

export const readRecommendations = async (listingType, listingId) => {
  const key = cacheKey(listingType, listingId);
  const memoryHit = memoryCache.get(key);
  if (memoryHit) return memoryHit;
  const diskHit = await swrGet(key, TTL_SECONDS);
  if (diskHit?.value) {
    memoryCache.set(key, diskHit.value);
    return diskHit.value;
  }
  return null;
};
export const writeRecommendations = (listingType, listingId, items) => {
  const key = cacheKey(listingType, listingId);
  memoryCache.set(key, items);
  swrSet(key, items, TTL_SECONDS);
};
