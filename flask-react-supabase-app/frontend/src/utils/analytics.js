// Loads GA4 (gtag.js) and Microsoft Clarity from env vars at runtime, and
// exposes a `trackEvent` helper for custom events. No-ops silently when the
// matching env var is missing so the site keeps working before the IDs are
// provisioned. See docs/ANALYTICS_SETUP.md for setup.

const GA4_ID = process.env.REACT_APP_GA4_MEASUREMENT_ID;
const CLARITY_ID = process.env.REACT_APP_CLARITY_PROJECT_ID;

let initialized = false;

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

export function initAnalytics() {
  if (initialized) return;
  initialized = true;
  try { initGa4(); } catch (err) { /* swallow — never block app boot */ }
  try { initClarity(); } catch (err) { /* swallow */ }
}

// Fire a GA4 custom event. Mirrors the Measurement Protocol used by mobile
// so event names stay consistent across web and mobile.
export function trackEvent(name, params = {}) {
  if (!GA4_ID || typeof window === 'undefined' || typeof window.gtag !== 'function') return;
  try { window.gtag('event', name, params); } catch (err) { /* swallow */ }
}

// Surface configuration so the admin panel can show "configure X" hints
// without poking at process.env from a component.
export const analyticsConfig = {
  ga4Enabled: !!GA4_ID,
  ga4MeasurementId: GA4_ID || null,
  clarityEnabled: !!CLARITY_ID,
  clarityProjectId: CLARITY_ID || null,
};
