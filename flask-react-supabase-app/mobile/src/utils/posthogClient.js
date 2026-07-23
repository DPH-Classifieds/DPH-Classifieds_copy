import PostHog from 'posthog-react-native';

// Single shared PostHog client for the whole app. Passed to <PostHogProvider
// client={posthog}> (autocapture: touches + exceptions) AND used directly in
// platformTracker.js to dual-send product/screen events. Null when no key is
// configured, so every call site must guard with posthog?.capture(...).
const apiKey = process.env.EXPO_PUBLIC_POSTHOG_API_KEY;

export const posthog = apiKey
  ? new PostHog(apiKey, { host: process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://eu.i.posthog.com' })
  : null;
