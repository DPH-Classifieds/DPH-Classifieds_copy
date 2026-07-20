const VISITOR_STORAGE_KEY = 'dph_platform_visitor_id';
const SESSION_STORAGE_KEY = 'dph_platform_session_id';

const createId = () =>
  window.crypto?.randomUUID?.() || `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;

const getOrCreateId = (storage, key) => {
  try {
    const existing = storage.getItem(key);
    if (existing) return existing;
    const next = createId();
    storage.setItem(key, next);
    return next;
  } catch (_) {
    return createId();
  }
};

// Use the same browser identity contract as PlatformAnalyticsTracker so a
// detail-page lead can be attributed to the preceding listing view.
export const getWebAnalyticsIdentity = () => ({
  event_id: createId(),
  visitor_id: getOrCreateId(window.localStorage, VISITOR_STORAGE_KEY),
  session_id: getOrCreateId(window.sessionStorage, SESSION_STORAGE_KEY),
  platform: 'web',
});
