const DEFAULT_TTL_MS = 60 * 1000;
const inflightRequests = new Map();

const buildCacheKey = (url) => `json-cache:${url}`;

export const readJsonSessionCache = (url) => {
  if (typeof window === 'undefined' || !url) {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(buildCacheKey(url));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
      return null;
    }
    return parsed.data ?? null;
  } catch (error) {
    return null;
  }
};

export const writeJsonSessionCache = (url, data, ttlMs = DEFAULT_TTL_MS) => {
  if (typeof window === 'undefined' || !url) {
    return;
  }

  try {
    window.sessionStorage.setItem(
      buildCacheKey(url),
      JSON.stringify({
        expiresAt: Date.now() + (ttlMs || DEFAULT_TTL_MS),
        data,
      })
    );
  } catch (error) {
    // Ignore storage errors (private mode / quota).
  }
};

export const fetchJsonWithCache = async (url, { ttlMs = DEFAULT_TTL_MS, signal } = {}) => {
  if (!url) {
    throw new Error('Missing url');
  }

  if (inflightRequests.has(url)) {
    return inflightRequests.get(url);
  }

  const fetchPromise = fetch(url, {
    headers: { Accept: 'application/json' },
    signal,
  })
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
};

