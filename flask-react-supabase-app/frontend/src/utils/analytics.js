// Loads GA4 (gtag.js) and Microsoft Clarity from env vars at runtime, and
// exposes a `trackEvent` helper for custom events. No-ops silently when the
// matching env var is missing so the site keeps working before the IDs are
// provisioned. See docs/ANALYTICS_SETUP.md for setup.

const GA4_ID = process.env.REACT_APP_GA4_MEASUREMENT_ID;
const CLARITY_ID = process.env.REACT_APP_CLARITY_PROJECT_ID;
const POSTHOG_KEY = process.env.REACT_APP_POSTHOG_KEY;
const POSTHOG_HOST = process.env.REACT_APP_POSTHOG_HOST || 'https://eu.i.posthog.com';

let initialized = false;
let posthogReady = false;
let posthog;

function loadScript(src, attrs = {}) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    Object.entries(attrs).forEach(([key, value]) => script.setAttribute(key, value));
    script.onload = () => resolve();
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function initGa4() {
  if (!GA4_ID) return;
  window.dataLayer = window.dataLayer || [];
  // eslint-disable-next-line prefer-rest-params
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag('js', new Date());
  // anonymize_ip stays default-on for GA4; send_page_view auto-fires once
  gtag('config', GA4_ID, { send_page_view: true });
  loadScript(`https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`).catch(() => {
    // Network/ad-blocker failure — first-party platform_events still captures
    // sessions, so silent failure is acceptable.
  });
}

function initClarity() {
  if (!CLARITY_ID) return;
  // Official Clarity loader snippet, inlined so we don't need an external file.
  (function (c, l, a, r, i, t, y) {
    c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
    t = l.createElement(r); t.async = 1; t.src = 'https://www.clarity.ms/tag/' + i;
    y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
  })(window, document, 'clarity', 'script', CLARITY_ID);
}

async function initPosthog() {
  if (!POSTHOG_KEY) return;
  const module = await import('posthog-js');
  posthog = module.default || module;
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    // We fire pageviews manually on route changes (SPA); disable the
    // built-in listener so we don't double-count.
    capture_pageview: false,
  });
  posthogReady = true;
}

function runAnalyticsInitialization() {
  try { initGa4(); } catch (err) { /* swallow — never block app boot */ }
  try { initClarity(); } catch (err) { /* swallow */ }
  initPosthog().catch(() => {});
}

export function initAnalytics() {
  if (initialized) return;
  initialized = true;
  // Keep third-party scripts off the critical boot path. Idle callbacks are
  // unavailable in some browsers/test environments, so retain a bounded
  // timeout fallback.
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(runAnalyticsInitialization, { timeout: 3000 });
  } else {
    window.setTimeout(runAnalyticsInitialization, 2000);
  }
}

// Fire a PostHog pageview. Called from the route-change tracker.
export function trackPageview() {
  if (!posthogReady) return;
  try { posthog?.capture('$pageview'); } catch (err) { /* swallow */ }
}

// Identify the logged-in user in PostHog on login. No-ops until init runs.
export function identifyUser(distinctId, props = {}) {
  if (!posthogReady || !distinctId) return;
  try { posthog?.identify(String(distinctId), props); } catch (err) { /* swallow */ }
}

// Reset PostHog identity on logout.
export function resetUser() {
  if (!posthogReady) return;
  try { posthog?.reset(); } catch (err) { /* swallow */ }
}

export { posthog };

// Fire a GA4 custom event. Mirrors the Measurement Protocol used by mobile
// so event names stay consistent across web and mobile.
export function trackEvent(name, params = {}) {
  if (!GA4_ID || typeof window === 'undefined' || typeof window.gtag !== 'function') return;
  try { window.gtag('event', name, params); } catch (err) { /* swallow */ }
}

// Forward a first-party lead_event to GA4 with our standardized event name.
// The detail-page components already POST to /api/listings/.../lead-events
// for the in-app KPIs; this just mirrors the same action into GA4 so the
// hosted dashboard shows the same conversions. Map kept in sync with mobile.
const LEAD_GA4_NAMES = {
  call_click: 'contact_click_call',
  whatsapp_click: 'contact_click_whatsapp',
  vin_open: 'vin_open',
  vin_reveal: 'vin_reveal',
};
export function forwardLeadToGa4(listingType, listingId, action, extra = {}) {
  const name = LEAD_GA4_NAMES[action];
  if (!name) return;
  trackEvent(name, {
    listing_type: listingType,
    listing_id: listingId == null ? '' : String(listingId),
    ...extra,
  });
}

// Surface configuration so the admin panel can show "configure X" hints
// without poking at process.env from a component.
export const analyticsConfig = {
  ga4Enabled: !!GA4_ID,
  ga4MeasurementId: GA4_ID || null,
  clarityEnabled: !!CLARITY_ID,
  clarityProjectId: CLARITY_ID || null,
};
