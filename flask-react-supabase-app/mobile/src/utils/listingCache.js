// Instant-open support for listing detail screens.
//
// The list endpoints already return every column + the full images array, so
// the list item passed on navigation is enough to render a detail screen with
// no spinner and no refetch for data. The only heavy thing not yet on-device
// when a card is tapped is its *other* photos (the list only drew the first
// thumbnail). So the "preload" that actually matters is warming the image
// loader for cards in/near the viewport — that's what makes opening a listing
// and swiping its gallery feel instant. Data needs no prefetch.

import { Image } from 'expo-image';
import { resolveMediaUrl } from './media';

// ponytail: flat Map + Set, FIFO eviction. User asked for ~5 preloaded; 40 is a
// harmless ceiling that survives fast scrolling. LRU only if a profile says so.
const MAX_ENTRIES = 40;
const IMAGES_PER_LISTING = 6; // warm the first few; nobody swipes 20 before opening
const cache = new Map();      // "type:id" -> list item (fallback for the rare id-only open)
const warmed = new Set();     // image URIs already handed to Image.prefetch

const keyOf = (type, id) => `${type}:${id}`;

const store = (type, id, record) => {
  if (!id || !record) return;
  const k = keyOf(type, id);
  cache.delete(k);            // re-insert => moves to newest slot
  cache.set(k, record);
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
};

export const getCachedListing = (type, id) => cache.get(keyOf(type, id)) || null;

const warmImages = (item) => {
  const images = Array.isArray(item?.images) ? item.images : [];
  images.slice(0, IMAGES_PER_LISTING).forEach((img) => {
    const uri = resolveMediaUrl(
      typeof img === 'string' ? img : img?.url || img?.image_url || img?.display_url,
    );
    if (uri && !warmed.has(uri)) {
      warmed.add(uri);
      Image.prefetch(uri).catch(() => {});
    }
  });
};

export const prefetchListing = (type, item) => {
  const id = item?.id || item?.listing_id;
  if (!id) return;
  store(type, id, item);
  warmImages(item);
};

// Called from list onViewableItemsChanged / mount — warms the visible window.
export const prefetchListingWindow = (type, items) => {
  (items || []).forEach((item) => prefetchListing(type, item));
};
