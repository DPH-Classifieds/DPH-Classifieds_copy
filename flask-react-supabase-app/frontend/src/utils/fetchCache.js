const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const inflightRequests = new Map();

const buildCacheKey = (url) => `json-cache:${url}`;

export const readJsonSessionCache = (url) => {
  if (typeof window === 'undefined' || !url) return null;
  try {
    const raw = window.sessionStorage.getItem(buildCacheKey(url));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.expiresAt && Date.now() > parsed.expiresAt) return null;
    return parsed.data ?? null;
  } catch {
    return null;
  }
};

export const writeJsonSessionCache = (url, data, ttlMs = DEFAULT_TTL_MS) => {
  if (typeof window === 'undefined' || !url) return;
  try {
    window.sessionStorage.setItem(
      buildCacheKey(url),
      JSON.stringify({ expiresAt: Date.now() + (ttlMs || DEFAULT_TTL_MS), data })
    );
  } catch {
    // Ignore storage errors (private mode / quota exceeded).
  }
};

async function _fetchFromNetwork(url, { ttlMs = DEFAULT_TTL_MS, signal } = {}) {
  const fetchPromise = fetch(url, { headers: { Accept: 'application/json' }, signal })
    .then(async (response) => {
      const data = await response.json();
      writeJsonSessionCache(url, data, ttlMs);
      return { ok: response.ok, status: response.status, data };
    })
    .finally(() => {
      inflightRequests.delete(url);
    });
  inflightRequests.set(url, fetchPromise);
  return fetchPromise;
}

/**
 * Fetch JSON with session-storage cache.
 *
 * When `onUpdate` is provided and stale data exists in the cache:
 *   - Returns the cached data immediately (no network wait)
 *   - Fetches fresh data in the background
 *   - Calls onUpdate(freshResponse) if the data changed
 */
export const fetchJsonWithCache = async (url, { ttlMs = DEFAULT_TTL_MS, signal, onUpdate } = {}) => {
  if (!url) throw new Error('Missing url');

  const cached = readJsonSessionCache(url);

  if (cached !== null && onUpdate) {
    // Return stale immediately; fire background refresh
    if (!inflightRequests.has(url)) {
      _fetchFromNetwork(url, { ttlMs, signal })
        .then((fresh) => {
          if (fresh.ok && JSON.stringify(fresh.data) !== JSON.stringify(cached)) {
            onUpdate({ ...fresh, _sourceUrl: url });
          }
        })
        .catch(() => {});
    }
    return { ok: true, status: 200, data: cached };
  }

  if (inflightRequests.has(url)) return inflightRequests.get(url);
  return _fetchFromNetwork(url, { ttlMs, signal });
};
