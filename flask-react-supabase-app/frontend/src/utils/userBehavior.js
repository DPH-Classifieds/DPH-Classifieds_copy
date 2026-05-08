const STORAGE_KEY = 'dph_user_behavior';
const MAX_VIEWS = 50;

export const getBehaviorProfile = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { viewed: [], clicked: [], searches: [] };
  } catch {
    return { viewed: [], clicked: [], searches: [] };
  }
};

export const trackView = (listingType, listingId, metadata = {}) => {
  const profile = getBehaviorProfile();
  const entry = {
    type: listingType,
    id: listingId,
    ts: Date.now(),
    ...metadata,
  };
  profile.viewed = profile.viewed.filter(
    (v) => !(v.type === listingType && v.id === listingId)
  );
  profile.viewed.unshift(entry);
  profile.viewed = profile.viewed.slice(0, MAX_VIEWS);
  saveProfile(profile);
};

export const trackClick = (listingType, listingId, metadata = {}) => {
  const profile = getBehaviorProfile();
  profile.clicked.unshift({
    type: listingType,
    id: listingId,
    ts: Date.now(),
    ...metadata,
  });
  profile.clicked = profile.clicked.slice(0, MAX_VIEWS);
  saveProfile(profile);
};

export const trackSearch = (query) => {
  if (!query.trim()) return;
  const profile = getBehaviorProfile();
  profile.searches.unshift({ query: query.trim(), ts: Date.now() });
  profile.searches = profile.searches.slice(0, 20);
  saveProfile(profile);
};

export const getPreferenceProfile = () => {
  const profile = getBehaviorProfile();
  const types = {};
  const priceRanges = [];
  const locations = {};

  profile.viewed.forEach((v) => {
    types[v.type] = (types[v.type] || 0) + 1;
    if (v.price) priceRanges.push(v.price);
    if (v.location) locations[v.location] = (locations[v.location] || 0) + 1;
  });

  const preferredTypes = Object.entries(types)
    .sort((a, b) => b[1] - a[1])
    .map(([type]) => type);

  const avgPrice = priceRanges.length
    ? priceRanges.reduce((a, b) => a + b, 0) / priceRanges.length
    : null;

  const preferredLocations = Object.entries(locations)
    .sort((a, b) => b[1] - a[1])
    .map(([loc]) => loc);

  return { preferredTypes, avgPrice, preferredLocations, totalViews: profile.viewed.length };
};

const saveProfile = (profile) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Storage full, silently fail
  }
};
