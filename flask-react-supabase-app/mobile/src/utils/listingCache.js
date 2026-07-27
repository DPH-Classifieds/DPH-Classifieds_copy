// Instant-open cache for listing detail screens.
//
// The list endpoints already return every column + the full images array, so a
// list item is enough to render a detail screen with no spinner. This cache
// lets list screens preload the freshest detail record (seller photo, view
// count) and warm the image loader for the first N visible cards, so opening a
// listing feels instant and stays instant as the user scrolls (sliding window).

import { Image } from 'react-native';
import apiClient from './apiClient';
import { resolveMediaUrl } from './media';

const ENDPOINTS = {
  cars: '/api/cars',
  bikes: '/api/bikes',
  plates: '/api/plates',
  parts: '/api/parts',
};

// ponytail: flat Map with FIFO eviction. User asked for ~5 preloaded; 40 is a
// harmless ceiling that survives fast scrolling. Swap for an LRU only if memory
// ever shows up in a profile.
const MAX_ENTRIES = 40;
const cache = new Map();       // "type:id" -> merged record
const inFlight = new Map();    // "type:id" -> Promise (dedupe concurrent fetches)

const keyOf = (type, id) => `${type}:${id}`;

const store = (type, id, record) => {
  if (!id || !record) return;
  const k = keyOf(type, id);
  const prev = cache.get(k);
  cache.delete(k); // re-insert so it moves to the newest slot
  cache.set(k, prev ? { ...prev, ...record } : record);
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
};

export const getCachedListing = (type, id) => cache.get(keyOf(type, id)) || null;

const warmImages = (item) => {
  const images = Array.isArray(item?.images) ? item.images : [];
  images.slice(0, 6).forEach((img) => {
    const uri = resolveMediaUrl(
      typeof img === 'string' ? img : img?.url || img?.image_url || img?.display_url,
    );
    if (uri) Image.prefetch(uri).catch(() => {});
  });
};

// Seed the cache from a list item and (once) fetch the full detail + warm its
// images in the background. Safe to call repeatedly for the same item.
export const prefetchListing = (type, item) => {
  const id = item?.id || item?.listing_id;
  const base = ENDPOINTS[type];
  if (!id || !base) return;

  store(type, id, item);
  warmImages(item);

  const k = keyOf(type, id);
  if (cache.get(k)?.__full || inFlight.has(k)) return;

  const p = apiClient
    .get(`${base}/${id}`)
    .then((data) => {
      if (data) {
        store(type, id, { ...data, __full: true });
        warmImages(data);
      }
      return data;
    })
    .catch(() => {})
    .finally(() => inFlight.delete(k));
  inFlight.set(k, p);
};

// Prefetch a window of items (called from list onViewableItemsChanged / mount).
export const prefetchListingWindow = (type, items) => {
  (items || []).forEach((item) => prefetchListing(type, item));
};
