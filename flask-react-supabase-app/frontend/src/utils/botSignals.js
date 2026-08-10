// Anonymous, non-identifying bot/scraper hints attached to public contact
// clicks. One-time passive listeners record whether a human-ish interaction
// happened this session; a headless scraper that fires the click
// programmatically has none of these. Server stores them alongside its own UA
// heuristic (is_probable_bot) for after-the-fact scraper detection — nothing
// here identifies the user.
let pointerMoved = false;
let scrolled = false;
const loadedAt = Date.now();

if (typeof window !== 'undefined' && window.addEventListener) {
  try {
    window.addEventListener('pointermove', () => { pointerMoved = true; }, { passive: true, once: true });
    window.addEventListener('scroll', () => { scrolled = true; }, { passive: true, once: true });
  } catch (_) { /* non-DOM env */ }
}

export function getBotSignals() {
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const ua = nav.userAgent || '';
  return {
    has_pointer_move: pointerMoved,
    has_scroll: scrolled,
    dwell_ms: Date.now() - loadedAt,
    webdriver: !!nav.webdriver,
    ua_headless: /(HeadlessChrome|puppeteer|playwright|selenium|phantomjs)/i.test(ua),
  };
}
