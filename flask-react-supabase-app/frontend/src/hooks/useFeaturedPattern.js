import { API_BASE_URL as API_URL } from '../utils/apiBase';
import { useEffect, useState } from 'react';

const CACHE_KEY = 'featured-placement-pattern-cache';
const CACHE_TTL_MS = 60 * 1000;

const DEFAULT_PATTERN = [{ featured: 1 }, { normal: 5 }];

let inflight = null;

/**
 * The admin-configured featured/normal interleave pattern (Admin > Featured
 * > Placement). Public, unauthenticated read — plain fetch(), not
 * apiClient, since apiClient throws for anyone not logged in.
 */
export default function useFeaturedPattern() {
  const [pattern, setPattern] = useState(DEFAULT_PATTERN);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const cachedRaw = sessionStorage.getItem(CACHE_KEY);
        if (cachedRaw) {
          const cached = JSON.parse(cachedRaw);
          if (cached?.expiresAt > Date.now() && Array.isArray(cached?.data)) {
            if (active) setPattern(cached.data);
            return;
          }
        }
      } catch (_) { /* ignore malformed cache */ }

      if (!inflight) {
        inflight = fetch(`${API_URL}/api/featured-placement/pattern`)
          .then((res) => res.json())
          .then((data) => {
            const p = Array.isArray(data?.pattern) ? data.pattern : DEFAULT_PATTERN;
            try {
              sessionStorage.setItem(CACHE_KEY, JSON.stringify({ expiresAt: Date.now() + CACHE_TTL_MS, data: p }));
            } catch (_) { /* ignore quota errors */ }
            return p;
          })
          .finally(() => { inflight = null; });
      }

      try {
        const p = await inflight;
        if (active) setPattern(p);
      } catch (_) {
        // Non-fatal — keep the default pattern.
      }
    };

    load();
    return () => { active = false; };
  }, []);

  return pattern;
}
