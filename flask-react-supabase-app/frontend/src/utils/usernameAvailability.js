import { API_BASE_URL as API_URL } from './apiBase';
const CACHE_TTL_MS = 5 * 60 * 1000;
const inflightChecks = new Map();
const USERNAME_BLOCKLIST = [
  'fuck',
  'shit',
  'bitch',
  'asshole',
  'bastard',
  'cunt',
  'dick',
  'pussy',
  'slut',
  'whore',
  'porn',
  'pornhub',
  'rape',
  'nigger',
  'faggot',
  'cock',
  'cum',
  'nazi',
  'blowjob',
  'handjob',
  'hentai',
  'onlyfans',
  'xnxx',
  'xvideos',
  'redtube',
  '4chan',
];

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

const normalizeUsernameForReview = (value) =>
  sanitizeUsernameInput(value).toLowerCase();

const compactUsername = (value) =>
  normalizeUsernameForReview(value).replace(/[^a-z0-9]/g, '');

const translateLeet = (value) => {
  const map = {
    '0': 'o',
    '1': 'i',
    '2': 'z',
    '3': 'e',
    '4': 'a',
    '5': 's',
    '6': 'g',
    '7': 't',
    '8': 'b',
    '9': 'g',
  };

  return String(value || '').replace(/[0-9]/g, (digit) => map[digit] || digit);
};

const collapseRepeats = (value) =>
  String(value || '').replace(/(.)\1{1,}/g, '$1');

const buildBlocklistCandidates = (value) => {
  const compact = compactUsername(value);
  if (!compact) return [];
  const normalized = translateLeet(compact);
  const collapsed = collapseRepeats(normalized);
  return Array.from(new Set([compact, normalized, collapsed])).filter(Boolean);
};

export const getUsernameValidationError = (value) => {
  const normalized = normalizeUsernameForReview(value);
  if (!normalized) {
    return 'Username is required';
  }
  if (normalized.length < 3) {
    return 'Username must be at least 3 characters';
  }
  if (!isUsernameFormatValid(normalized)) {
    return 'Username can only contain letters, numbers, and underscores';
  }

  const compact = compactUsername(normalized);
  if (!compact) {
    return 'Username can only contain letters, numbers, and underscores';
  }

  const candidates = buildBlocklistCandidates(normalized);
  if (candidates.some((candidate) => USERNAME_BLOCKLIST.some((term) => candidate.includes(term)))) {
    return 'That username is not allowed. Please choose a different one.';
  }

  return null;
};

export const checkUsernameAvailability = async ({ username, excludeUserId = '' } = {}) => {
  const normalizedUsername = sanitizeUsernameInput(username);
  const validationError = getUsernameValidationError(normalizedUsername);
  if (validationError) {
    return {
      available: false,
      message: validationError,
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
