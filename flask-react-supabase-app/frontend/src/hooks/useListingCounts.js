import { useEffect, useState } from 'react';

const CACHE_KEY = 'listing-counts-cache';
const CACHE_TTL_MS = 60 * 1000;

// apiClient.request() unconditionally throws "Authentication failed" when no
// user is logged in — it has no concept of a public endpoint. This is a
// public, unauthenticated read, so it uses plain fetch(), same as
// ExplorePage.jsx's own cars/bikes/parts/plates calls.
const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

let inflight = null;
let inflightUrl = null;

/**
 * Total live listing counts per category ({cars, bikes, parts, plates, all})
 * from GET /api/listings/counts. Session-cached for CACHE_TTL_MS and shared
 * across every mounted consumer via a single in-flight promise, so switching
 * between Explore and the browse pages doesn't refetch on every mount.
 *
 * Accepts an optional `filters` object whose non-empty entries are appended
 * as query params — backend applies the SAME filter spec to the count, so
 * the tab badge reflects the active search instead of always showing the
 * global total. Pass null (or omit) for the unfiltered global counts.
 */
export default function useListingCounts(filters = null) {
  const [counts, setCounts] = useState(null);

  const buildUrl = () => {
    if (!filters) return `${API_URL}/api/listings/counts`;
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== '' && value !== null && value !== undefined) {
        params.append(key, String(value));
      }
    });
    const qs = params.toString();
    return qs ? `${API_URL}/api/listings/counts?${qs}` : `${API_URL}/api/listings/counts`;
  };

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const cachedRaw = sessionStorage.getItem(CACHE_KEY);
        if (cachedRaw) {
          const cached = JSON.parse(cachedRaw);
          if (cached?.expiresAt > Date.now() && cached?.data && cached?.url === buildUrl()) {
            if (active) setCounts(cached.data);
            return;
          }
        }
      } catch (_) { /* ignore malformed cache */ }

      const url = buildUrl();
      if (!inflight || inflightUrl !== url) {
        inflightUrl = url;
        inflight = fetch(url)
          .then((res) => res.json())
          .then((data) => {
            try {
              sessionStorage.setItem(
                CACHE_KEY,
                JSON.stringify({ expiresAt: Date.now() + CACHE_TTL_MS, data, url })
              );
            } catch (_) { /* ignore quota errors */ }
            return data;
          })
          .finally(() => { inflight = null; inflightUrl = null; });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(filters)]);

  return counts;
}