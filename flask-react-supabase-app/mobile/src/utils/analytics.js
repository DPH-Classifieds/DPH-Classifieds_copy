// GA4 client for React Native using the Measurement Protocol REST endpoint
// (avoids pulling in Firebase). Persists a per-install client_id in
// AsyncStorage so GA4 attributes events to the same anonymous user across
// sessions. No-ops silently if the env vars aren't set. See
// docs/ANALYTICS_SETUP.md for setup.

import AsyncStorage from '@react-native-async-storage/async-storage';

const MEASUREMENT_ID = process.env.EXPO_PUBLIC_GA4_MEASUREMENT_ID;
const API_SECRET = process.env.EXPO_PUBLIC_GA4_API_SECRET;
const CLIENT_ID_KEY = 'ga4_client_id';

let cachedClientId = null;

const isEnabled = () => !!MEASUREMENT_ID && !!API_SECRET;

const randomClientId = () => {
  // GA4 expects "<random>.<timestamp>" — random part needs to be reasonably
  // unique per install.
  const random = Math.floor(Math.random() * 1e10).toString();
  const ts = Math.floor(Date.now() / 1000).toString();
  return `${random}.${ts}`;
};

const getClientId = async () => {
  if (cachedClientId) return cachedClientId;
  try {
    const stored = await AsyncStorage.getItem(CLIENT_ID_KEY);
    if (stored) {
      cachedClientId = stored;
      return stored;
    }
  } catch (_) { /* ignore — fall through to fresh ID */ }
  const fresh = randomClientId();
  cachedClientId = fresh;
  try { await AsyncStorage.setItem(CLIENT_ID_KEY, fresh); } catch (_) { /* ignore */ }
  return fresh;
};

// Fire a GA4 event. Same event names as web so reports merge cleanly.
// Failures are intentionally silent — analytics never blocks UI flow.
export const trackEvent = async (name, params = {}) => {
  if (!isEnabled() || !name) return;
  try {
    const clientId = await getClientId();
    const url = `https://www.google-analytics.com/mp/collect?measurement_id=${MEASUREMENT_ID}&api_secret=${API_SECRET}`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        events: [{ name, params }],
      }),
    });
  } catch (_) {
    // Network failure / blocked — ignore.
  }
};

export const analyticsConfig = {
  ga4Enabled: isEnabled(),
  ga4MeasurementId: MEASUREMENT_ID || null,
};
