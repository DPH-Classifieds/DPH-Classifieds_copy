import { useEffect, useState } from 'react';
import apiClient from '../utils/apiClient';
import { swrGet, swrSet } from '../utils/swrCache';

const CACHE_KEY = 'featured-placement-pattern';
const CACHE_TTL_SECONDS = 60;
const DEFAULT_PATTERN = [{ featured: 1 }, { normal: 5 }];

let inflight = null;

/**
 * The admin-configured featured/normal interleave pattern (Admin > Featured
 * > Placement). Public endpoint — already whitelisted in apiClient's
 * PUBLIC_ENDPOINTS, so this is safe to call from a logged-out screen.
 */
export default function useFeaturedPattern() {
  const [pattern, setPattern] = useState(DEFAULT_PATTERN);

  useEffect(() => {
    let active = true;

    const load = async () => {
      const cached = await swrGet(CACHE_KEY, CACHE_TTL_SECONDS);
      if (cached?.value) {
        if (active) setPattern(cached.value);
        return;
      }

      if (!inflight) {
        inflight = apiClient.get('/api/featured-placement/pattern')
          .then((data) => {
            const p = Array.isArray(data?.pattern) ? data.pattern : DEFAULT_PATTERN;
            swrSet(CACHE_KEY, p, CACHE_TTL_SECONDS);
            return p;
          })
          .finally(() => { inflight = null; });
      }

      try {
        const p = await inflight;
        if (active) setPattern(p);
      } catch {
        // Non-fatal — keep the default pattern.
      }
    };

    load();
    return () => { active = false; };
  }, []);

  return pattern;
}
