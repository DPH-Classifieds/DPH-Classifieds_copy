import { useEffect, useState } from 'react';
import apiClient from '../utils/apiClient';

const CACHE_KEY = 'listing-counts-cache';
const CACHE_TTL_MS = 60 * 1000;

let inflight = null;

/**
 * Total live listing counts per category ({cars, bikes, parts, plates, all})
 * from GET /api/listings/counts. Session-cached for CACHE_TTL_MS and shared
 * across every mounted consumer via a single in-flight promise, so switching
 * between Explore and the browse pages doesn't refetch on every mount.
 */
export default function useListingCounts() {
  const [counts, setCounts] = useState(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const cachedRaw = sessionStorage.getItem(CACHE_KEY);
        if (cachedRaw) {
          const cached = JSON.parse(cachedRaw);
          if (cached?.expiresAt > Date.now() && cached?.data) {
            if (active) setCounts(cached.data);
            return;
          }
        }
      } catch (_) { /* ignore malformed cache */ }

      if (!inflight) {
        inflight = apiClient.get('/api/listings/counts')
          .then((data) => {
            try {
              sessionStorage.setItem(CACHE_KEY, JSON.stringify({ expiresAt: Date.now() + CACHE_TTL_MS, data }));
            } catch (_) { /* ignore quota errors */ }
            return data;
          })
          .finally(() => { inflight = null; });
      }

      try {
        const data = await inflight;
        if (active) setCounts(data);
      } catch (_) {
        // Non-fatal — consumers treat null counts as "don't show a number yet".
      }
    };

    load();
    return () => { active = false; };
  }, []);

  return counts;
}
