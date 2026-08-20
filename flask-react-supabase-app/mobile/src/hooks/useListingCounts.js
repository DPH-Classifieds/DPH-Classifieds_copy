import { useEffect, useState } from 'react';
import apiClient from '../utils/apiClient';
import { swrGet, swrSet } from '../utils/swrCache';

const CACHE_KEY = 'listing-counts';
const CACHE_TTL_SECONDS = 60;

let inflight = null;

/**
 * Total live listing counts per category ({cars, bikes, parts, plates, all})
 * from GET /api/listings/counts. Mirrors the web useListingCounts hook —
 * same endpoint, same shape — using AsyncStorage (via swrCache) instead of
 * sessionStorage.
 */
export default function useListingCounts() {
  const [counts, setCounts] = useState(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      const cached = await swrGet(CACHE_KEY, CACHE_TTL_SECONDS);
      if (cached?.value) {
        if (active) setCounts(cached.value);
        return;
      }

      if (!inflight) {
        inflight = apiClient.get('/api/listings/counts')
          .then((data) => { swrSet(CACHE_KEY, data, CACHE_TTL_SECONDS); return data; })
          .finally(() => { inflight = null; });
      }

      try {
        const data = await inflight;
        if (active) setCounts(data);
      } catch {
        // Non-fatal — consumers treat null counts as "don't show a number yet".
      }
    };

    load();
    return () => { active = false; };
  }, []);

  return counts;
}
