const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
const CACHE_TTL_MS = 5 * 60 * 1000;
const inflightChecks = new Map();

const getStorage = () => {
  try {
    return window.sessionStorage;
  } catch (error) {
    return null;
  }
};

const buildCacheKey = (username, excludeUserId = '') => {
  const normalized = String(username || '').trim();
  const exclude = String(excludeUserId || '').trim();
  return `username-availability:${exclude}:${normalized}`;
};

const readCache = (cacheKey) => {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.expiresAt <= Date.now()) {
      storage.removeItem(cacheKey);
      return null;
    }
    return parsed.value;
  } catch (error) {
    return null;
  }
};

const writeCache = (cacheKey, value) => {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(
      cacheKey,
      JSON.stringify({
        expiresAt: Date.now() + CACHE_TTL_MS,
        value,
      })
    );
  } catch (error) {
    // Ignore storage quota failures.
  }
};

export const sanitizeUsernameInput = (value) => String(value || '').trim();

export const isUsernameFormatValid = (value) => /^[A-Za-z0-9_]+$/.test(sanitizeUsernameInput(value));

export const checkUsernameAvailability = async ({ username, excludeUserId = '' } = {}) => {
  const normalizedUsername = sanitizeUsernameInput(username);
  if (!normalizedUsername) {
    return {
      available: false,
      message: 'Username is required',
      username: normalizedUsername,
    };
  }

  const cacheKey = buildCacheKey(normalizedUsername, excludeUserId);
  const cached = readCache(cacheKey);
  if (cached) {
    return cached;
  }

  if (inflightChecks.has(cacheKey)) {
    return inflightChecks.get(cacheKey);
  }

  const checkPromise = (async () => {
    const url = new URL(`${API_URL}/api/auth/check-username`);
    url.searchParams.set('username', normalizedUsername);
    if (excludeUserId) {
      url.searchParams.set('exclude_user_id', excludeUserId);
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });

    let data = {};
    try {
      data = await response.json();
    } catch (error) {
      data = {};
    }

    const result = {
      available: Boolean(data.available),
      username: normalizedUsername,
      message: data.available
        ? 'Username available'
        : data.message || 'This username is taken. Please try something else.',
    };

    if (response.ok || response.status === 409) {
      writeCache(cacheKey, result);
    }

    return result;
  })();

  inflightChecks.set(cacheKey, checkPromise);

  try {
    return await checkPromise;
  } finally {
    inflightChecks.delete(cacheKey);
  }
};
