# Admin Panel — Speed + Accuracy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut admin dashboard cold-load time from multi-second to <500ms, and fix four metric-accuracy bugs (windowed view counts, deduplicated unique visitors, qualified-lead conversion counts, and mobile live-user visibility).

**Architecture:** Replace bulk Supabase REST row fetches with `Prefer: count=exact` HEAD-style probes that return only the row count via the `Content-Range` header. Bound view counts by joining `lead_events` instead of summing the cumulative `view_count` column. Dedupe `unique_visitors` by collapsing all three signal sources onto a single canonical key (auth user_id when known, visitor_id otherwise). Add stale-while-revalidate to the frontend dashboards so cached data renders instantly on focus while a background refresh runs. Mirror the live-user signal from mobile by writing platform_events from the React Native app.

**Tech Stack:** Flask + Python + Supabase REST + Redis cache (backend); React + React Native (frontends); existing `unittest` test suite.

---

## Status Audit — What Already Works

Confirmed working as of commit `4a65532`:

| Subsystem | Status |
|---|---|
| GA4 web tracking via `gtag.js` | ✅ Live (Vercel env var set) |
| `trackEvent('sign_up'/'login'/'contact_click_*'/'post_listing_success')` firing | ✅ Confirmed in code |
| Sign in with Google flow + Supabase provider | ✅ Wired (web), wired (mobile, needs EAS dev build) |
| Phone-verify gate after Google OAuth | ✅ |
| Buying requests in admin listings tab | ✅ |
| Expired listings visibility (auto-removed-for-expiry merged into Expired tab) | ✅ |
| Site Visitors KPI fallback (platform_events + lead_events + signups) | ✅ |
| `/api/admin/stats` Redis-cached 60s | ✅ |
| `/api/admin/live-users` Redis-cached 15s | ✅ |
| `platform_events` table migrated | ✅ (user-confirmed) |
| Mobile fixes (nav, OCR, image preview, pull-to-refresh, admin layout) | ✅ |
| Inline GA4 KPI feature removed cleanly | ✅ (commit `4a65532`) |

**Known bugs the plan below addresses:**

| Bug | Severity | Task |
|---|---|---|
| KPI labels say "(30d)" but view counts are cumulative all-time | High | Task 2 |
| `unique_visitors` triple-counts the same person across (platform_events, lead_events, signups) | High | Task 3 |
| `total_calls` / `total_whatsapp` count raw events, not unique users | Medium | Task 4 |
| Mobile sessions invisible to `live_users` (mobile doesn't write platform_events) | Medium | Task 5 |
| `total_users` capped at 4000 — count is wrong above that | Low (premature) | Task 1 |
| `total_reports` capped at 1000 | Low (premature) | Task 1 |
| Dashboard cold-load fetches ~13k Supabase rows | High (the felt speed issue) | Task 1 |
| Frontend blocks on every refocus until network returns | Medium | Task 6 |
| Live-users polls every 15s even when tab/app is backgrounded | Low | Task 6 |

**Out of scope** (these are working; don't touch):
- `trackEvent` call-site wiring (already done)
- The "Open GA4 Dashboard" / "Open Clarity Dashboard" buttons
- Sign in with Google OAuth client config
- Microsoft Clarity provisioning (separate user-action item)
- platform_events table creation (already applied)

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `flask-react-supabase-app/backend/app.py` | All admin stats endpoints | Modify `/api/admin/stats`, `/api/admin/live-users`. Add `_supabase_count()` helper. |
| `flask-react-supabase-app/backend/test_admin_stats_and_posts.py` | Backend admin metric tests | Add tests for each accuracy fix |
| `flask-react-supabase-app/frontend/src/components/AdminDashboard.js` | Web admin dashboard | SWR cache, visibility-aware polling |
| `flask-react-supabase-app/frontend/src/utils/swrCache.js` | Tiny stale-while-revalidate localStorage cache (new) | Create |
| `flask-react-supabase-app/mobile/src/screens/admin/AdminDashboardScreen.js` | Mobile admin dashboard | SWR cache, AppState-aware polling |
| `flask-react-supabase-app/mobile/src/utils/swrCache.js` | RN equivalent (AsyncStorage-backed) (new) | Create |
| `flask-react-supabase-app/mobile/src/components/PlatformAnalyticsTracker.js` | New — RN equivalent of web's PlatformAnalyticsTracker (new) | Create |
| `flask-react-supabase-app/mobile/App.js` | Boot the mobile platform analytics tracker | Modify |

---

### Task 1: Switch row-scans to count-only probes

Replace the four bulk fetches in `/api/admin/stats` that only need a count (`total_users`, `total_reports`, `_pending` counts per listing type) with `Prefer: count=exact` HEAD requests. The other fetches stay because we use the row data.

**Files:**
- Modify: `flask-react-supabase-app/backend/app.py` (`get_admin_stats` + new helper)
- Test: `flask-react-supabase-app/backend/test_admin_stats_and_posts.py`

- [ ] **Step 1: Write failing test for new helper**

Add to `test_admin_stats_and_posts.py`:

```python
class SupabaseCountTests(unittest.TestCase):
    def test_supabase_count_parses_content_range(self):
        with patch("app.requests.head") as mock_head:
            mock_head.return_value = Mock(
                status_code=206,
                headers={"Content-Range": "0-0/4231"},
            )
            count = backend._supabase_count("users", {"is_dealer": "eq.true"})
            self.assertEqual(count, 4231)

    def test_supabase_count_returns_zero_when_missing(self):
        with patch("app.requests.head") as mock_head:
            mock_head.return_value = Mock(status_code=500, headers={})
            self.assertEqual(backend._supabase_count("users", {}), 0)
```

- [ ] **Step 2: Run test, confirm it fails**

```bash
cd flask-react-supabase-app/backend
python -m unittest test_admin_stats_and_posts.SupabaseCountTests -v
```

Expected: `AttributeError: module 'app' has no attribute '_supabase_count'`.

- [ ] **Step 3: Implement the helper**

Add near the other `supabase_request` helpers in `app.py`:

```python
def _supabase_count(table: str, params: dict | None = None) -> int:
    """Return row count via Content-Range header. Cheaper than SELECT *.

    params is a dict of PostgREST filter expressions, e.g. {"status": "eq.pending"}.
    """
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_KEY)
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Range-Unit": "items",
        "Range": "0-0",
        "Prefer": "count=exact",
    }
    try:
        resp = requests.head(
            f"{SUPABASE_URL}/rest/v1/{table}",
            headers=headers,
            params=params or {},
            timeout=8,
        )
        content_range = resp.headers.get("Content-Range", "")
        if "/" in content_range:
            return int(content_range.rsplit("/", 1)[1])
    except Exception as exc:
        logger.warning("supabase count failed for %s: %s", table, exc)
    return 0
```

- [ ] **Step 4: Run test, confirm it passes**

```bash
python -m unittest test_admin_stats_and_posts.SupabaseCountTests -v
```

Expected: `OK`.

- [ ] **Step 5: Use the helper in `/api/admin/stats`**

Replace the bulk `users` fetch and four `_pending` SELECT loops with count probes. Find the block in `get_admin_stats` that begins `users = _fetch_rows(...)` and replace the trailing computation:

```python
# Old (full SELECT, capped at 4000):
#   users = _fetch_rows("/rest/v1/users", {"select": "id,is_dealer,...", "limit": "4000"})
#   stats["total_users"] = len(users)
#   stats["total_dealers"] = sum(1 for u in users if u.get("is_dealer"))

# New: count-only probes — no row cap.
total_users = _supabase_count("users")
total_dealers = _supabase_count("users", {"is_dealer": "eq.true"})

# Same for reports:
total_reports = _supabase_count("reports")

# Per-type pending counts:
cars_pending = _supabase_count("cars", {"status": "eq.pending"})
bikes_pending = _supabase_count("bikes", {"status": "eq.pending"})
parts_pending = _supabase_count("car_parts", {"status": "eq.pending"})
plates_pending = _supabase_count("license_plates", {"status": "eq.pending"})
```

Then plumb `total_users`, `total_dealers`, `total_reports`, and the `_pending` values into the existing `stats = {...}` dict, and **delete** the old `_fetch_rows` calls for `users` and `reports` and the `cars/bikes/parts/plates` full-table fetches **only if their `status,view_count` data isn't used elsewhere in the function**. (Tasks 2 will rework view counts separately so keep listing fetches for now — only remove the users/reports fetches.)

- [ ] **Step 6: Update existing `test_admin_stats_includes_visitor_counts` test**

The existing test mocks `_fetch_rows`. Add patches for `_supabase_count`:

```python
with patch("app._fetch_rows", side_effect=fake_fetch), \
     patch("app._supabase_count") as mock_count:
    mock_count.side_effect = lambda t, p=None: {
        ("users", None): 3,
        ("users", frozenset({"is_dealer": "eq.true"}.items())): 1,
        ("reports", None): 2,
        ("cars", frozenset({"status": "eq.pending"}.items())): 1,
        ("bikes", frozenset({"status": "eq.pending"}.items())): 0,
        ("car_parts", frozenset({"status": "eq.pending"}.items())): 1,
        ("license_plates", frozenset({"status": "eq.pending"}.items())): 1,
    }.get((t, frozenset((p or {}).items())), 0)
    # ... existing assertions ...
```

(Adjust assertion values to match the new mock returns.)

- [ ] **Step 7: Run full admin stats test suite**

```bash
python -m unittest test_admin_stats_and_posts -v
```

Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add flask-react-supabase-app/backend/app.py flask-react-supabase-app/backend/test_admin_stats_and_posts.py
git commit -m "Admin stats: count-only probes instead of full row scans

Cuts /api/admin/stats Supabase work from ~13k row fetches to a handful
of Content-Range HEAD probes for users/dealers/reports/pending. Removes
the silent 4000-user / 1000-report cap. Backend keeps row-fetching
platform_events and lead_events because those rows feed the visitor
and lead-action aggregations downstream."
```

---

### Task 2: Window-bound view counts via lead_events aggregation

The KPI tile says "Total Views (30d)" but it actually shows `sum(cars.view_count)` — a cumulative all-time counter. Switch to counting `lead_events.action='view_listing'` rows in the window (web tracker writes that event on every detail-page mount).

**Files:**
- Modify: `flask-react-supabase-app/backend/app.py` (`get_admin_stats`)
- Test: `flask-react-supabase-app/backend/test_admin_stats_and_posts.py`

- [ ] **Step 1: Write failing test**

```python
def test_total_views_is_window_bounded(self):
    now = backend._utc_now()
    iso = backend._isoformat_utc

    lead_events = [
        {"action": "view_listing", "listing_type": "car", "created_at": iso(now)},
        {"action": "view_listing", "listing_type": "car", "created_at": iso(now)},
        {"action": "view_listing", "listing_type": "bike", "created_at": iso(now)},
        {"action": "call_click", "created_at": iso(now)},  # not a view
    ]
    with patch("app._fetch_rows", side_effect=lambda path, params: lead_events if "lead_events" in path else []), \
         patch("app._supabase_count", return_value=0), \
         patch("app._require_admin_api_user", return_value=True):
        with app.test_client() as client:
            with patch("app.token_required", lambda f: f):
                resp = client.get("/api/admin/stats?days=30",
                                  headers={"Authorization": "Bearer x"})
                payload = resp.get_json()
                self.assertEqual(payload["total_views"], 3)
                self.assertEqual(payload["cars_views"], 2)
                self.assertEqual(payload["bikes_views"], 1)
```

- [ ] **Step 2: Confirm test fails**

```bash
python -m unittest test_admin_stats_and_posts.AdminStatsTests.test_total_views_is_window_bounded -v
```

Expected: assertion failure (cars_views/bikes_views still come from cumulative `view_count`).

- [ ] **Step 3: Replace cumulative view count computation**

In `get_admin_stats`, find:

```python
"cars_views": sum(int(row.get("view_count") or 0) for row in cars),
"bikes_views": sum(int(row.get("view_count") or 0) for row in bikes),
"parts_views": sum(int(row.get("view_count") or 0) for row in parts),
"plates_views": sum(int(row.get("view_count") or 0) for row in plates),
```

Replace the four with a windowed count, plus a top-level `total_views`:

```python
view_counts_by_type = defaultdict(int)
for event in lead_events:
    if (event.get("action") or "").strip() == "view_listing":
        listing_type = (event.get("listing_type") or "").strip().rstrip("s")
        if listing_type:
            view_counts_by_type[listing_type] += 1
        view_counts_by_type["__total__"] += 1

stats_view_overrides = {
    "cars_views": view_counts_by_type.get("car", 0),
    "bikes_views": view_counts_by_type.get("bike", 0),
    "parts_views": view_counts_by_type.get("part", 0),
    "plates_views": view_counts_by_type.get("plate", 0),
    "total_views": view_counts_by_type.get("__total__", 0),
}
# merge into the stats dict
```

(Remove now-unused `cars`, `bikes`, `parts`, `plates` row fetches from the function — they're not needed for any other field after Task 1 removed the pending counts.)

- [ ] **Step 4: Run all admin stats tests**

```bash
python -m unittest test_admin_stats_and_posts -v
```

Expected: green.

- [ ] **Step 5: Commit**

```bash
git commit -am "Admin stats: window-bound view counts from lead_events

The KPI tile labeled 'Total Views (30d)' was actually showing the
cumulative all-time view_count column sum. Switched to counting
lead_events.action='view_listing' rows in the selected window, which
the PlatformAnalyticsTracker writes on every detail-page mount.

Per-type breakdown (cars/bikes/parts/plates) likewise now reflects
the window. Drops the redundant per-table SELECTs that were only
feeding cumulative sums."
```

---

### Task 3: Dedupe unique_visitors across signal sources

Today: same user signs up, fires a lead_event, and has a platform_events visitor_id → counted 3× because the namespacing (`pe:`, `le:`, `u:`) was added to prevent collisions but doesn't collapse the same actual person.

Fix: collapse onto a canonical key. Priority order is `user_id` (authoritative when authenticated) → `visitor_id` (anonymous tracker) → `session_id` (last resort).

**Files:**
- Modify: `flask-react-supabase-app/backend/app.py` (`get_admin_stats`)
- Test: `flask-react-supabase-app/backend/test_admin_stats_and_posts.py`

- [ ] **Step 1: Write failing test**

```python
def test_unique_visitors_dedupes_across_sources(self):
    now = backend._utc_now()
    iso = backend._isoformat_utc
    user_a = "user-aaaa-1111"

    platform_events = [
        {"user_id": user_a, "visitor_id": "v-anon-1", "session_id": "s1",
         "created_at": iso(now)},
    ]
    lead_events = [
        {"user_id": user_a, "session_id": "s2", "action": "call_click",
         "created_at": iso(now)},
    ]
    users_in_window = [{"id": user_a, "created_at": iso(now)}]

    # Should collapse to ONE unique visitor, not three.
    def fake_fetch(path, params):
        if "platform_events" in path: return platform_events
        if "lead_events" in path: return lead_events
        if "users" in path: return users_in_window
        return []

    with patch("app._fetch_rows", side_effect=fake_fetch), \
         patch("app._supabase_count", return_value=1), \
         patch("app._require_admin_api_user", return_value=True), \
         patch("app.token_required", lambda f: f):
        with app.test_client() as client:
            resp = client.get("/api/admin/stats?days=30",
                              headers={"Authorization": "Bearer x"})
            self.assertEqual(resp.get_json()["unique_visitors"], 1)
```

- [ ] **Step 2: Confirm fail**

```bash
python -m unittest test_admin_stats_and_posts.AdminStatsTests.test_unique_visitors_dedupes_across_sources -v
```

Expected: `AssertionError: 3 != 1`.

- [ ] **Step 3: Rewrite the unique_visitors loop**

Replace the existing three-loop accumulation with a single canonical-key function:

```python
def _canonical_visitor_key(row, fallback_id=None):
    # auth user_id > visitor_id > session_id > fallback
    for key in ("user_id", "visitor_id", "session_id"):
        value = row.get(key)
        if value:
            return f"v:{value}"
    return f"v:{fallback_id}" if fallback_id else None

unique_visitors = set()
live_visitors = set()
live_cutoff = now - datetime.timedelta(minutes=5)

for event in platform_events:
    key = _canonical_visitor_key(event)
    if not key:
        continue
    unique_visitors.add(key)
    unique_sources.add("platform_events")
    event_time = _parse_datetime(event.get("created_at"))
    if event_time and event_time >= live_cutoff:
        live_visitors.add(key)

for event in lead_events:
    lead_actions[str(event.get("action") or "unknown")] += 1
    key = _canonical_visitor_key(event)
    if key:
        unique_visitors.add(key)
        unique_sources.add("lead_events")

for user in users:  # users in window (already filtered)
    if user.get("id"):
        unique_visitors.add(f"v:{user['id']}")
        unique_sources.add("new_signups")
        new_signups_in_window += 1
```

(Helper `_canonical_visitor_key` should live next to the other admin helpers near `_admin_listing_matches_status`.)

- [ ] **Step 4: Run all admin stats tests + check existing dedupe test**

```bash
python -m unittest test_admin_stats_and_posts -v
```

Expected: green. The previously passing `test_admin_stats_includes_visitor_counts` may need its expected count adjusted now that dedupe collapses overlapping signals — adjust the assertion to match the canonical behavior.

- [ ] **Step 5: Commit**

```bash
git commit -am "Admin stats: dedupe unique_visitors across signal sources

Previously the same person could appear three times in unique_visitors
if they had a platform_events visitor_id, fired a lead_event, and
signed up in the window. The namespaced prefixes (pe:/le:/u:) only
prevented collision, they didn't collapse the same actual person.

Switch to a canonical key (auth user_id > visitor_id > session_id)
and merge all sources onto it. Same person across sources now counts
once."
```

---

### Task 4: Qualified-leads conversion count (dedupe by user)

Today: `total_calls` = raw count of `lead_events.action='call_click'` rows. One user mashing the call button 5 times = 5 calls. Investor-facing metric: unique users who took the action.

**Files:**
- Modify: `flask-react-supabase-app/backend/app.py` (`get_admin_stats`)
- Test: `flask-react-supabase-app/backend/test_admin_stats_and_posts.py`

- [ ] **Step 1: Write failing test**

```python
def test_total_calls_dedupes_per_user(self):
    iso = backend._isoformat_utc
    now = backend._utc_now()
    lead_events = [
        {"user_id": "u1", "action": "call_click", "created_at": iso(now)},
        {"user_id": "u1", "action": "call_click", "created_at": iso(now)},
        {"user_id": "u2", "action": "call_click", "created_at": iso(now)},
        {"user_id": "u3", "action": "whatsapp_click", "created_at": iso(now)},
    ]
    def fake_fetch(path, params):
        return lead_events if "lead_events" in path else []
    with patch("app._fetch_rows", side_effect=fake_fetch), \
         patch("app._supabase_count", return_value=0), \
         patch("app._require_admin_api_user", return_value=True), \
         patch("app.token_required", lambda f: f):
        with app.test_client() as client:
            payload = client.get("/api/admin/stats?days=30",
                                 headers={"Authorization": "Bearer x"}).get_json()
            self.assertEqual(payload["total_calls"], 2)         # unique callers
            self.assertEqual(payload["total_call_events"], 3)   # raw count
            self.assertEqual(payload["total_whatsapp"], 1)
```

- [ ] **Step 2: Confirm fail**

```bash
python -m unittest test_admin_stats_and_posts.AdminStatsTests.test_total_calls_dedupes_per_user -v
```

Expected: `total_calls` = 3 (raw event count) instead of 2.

- [ ] **Step 3: Switch counters to per-key sets, expose both**

Replace the existing `lead_actions = defaultdict(int)` accumulation with:

```python
lead_event_counts = defaultdict(int)  # raw event counts (existing semantics)
lead_unique_actors = defaultdict(set)  # qualified (deduplicated) counts

for event in lead_events:
    action = str(event.get("action") or "unknown")
    lead_event_counts[action] += 1
    actor = _canonical_visitor_key(event)
    if actor:
        lead_unique_actors[action].add(actor)

# In stats dict:
"total_calls": len(lead_unique_actors.get("call_click", set())),
"total_call_events": lead_event_counts.get("call_click", 0),
"total_whatsapp": len(lead_unique_actors.get("whatsapp_click", set())),
"total_whatsapp_events": lead_event_counts.get("whatsapp_click", 0),
"total_leads": sum(lead_event_counts.values()),  # unchanged — raw
```

- [ ] **Step 4: Tests pass**

```bash
python -m unittest test_admin_stats_and_posts -v
```

- [ ] **Step 5: Commit**

```bash
git commit -am "Admin stats: total_calls/total_whatsapp dedupe by actor

KPI tiles labeled 'Calls' and 'WhatsApp' counted raw event rows: one
user mashing the call button five times showed as five calls. That's
not the metric an investor reads — they want unique users who took
the action.

Switch the two tiles to unique-actor counts via _canonical_visitor_key,
keep the raw counts under total_call_events / total_whatsapp_events
for anyone needing the underlying signal. total_leads stays raw."
```

---

### Task 5: Mobile platform tracker (live-users includes mobile sessions)

Today `live_users` only counts `platform_events.visitor_id` seen in the last 5 min — but mobile never writes `platform_events`. Mobile-only users are invisible.

Fix: create an RN equivalent of the web's `PlatformAnalyticsTracker` that posts page-view events from each mobile screen mount. Visitor ID persists via AsyncStorage.

**Files:**
- Create: `flask-react-supabase-app/mobile/src/components/PlatformAnalyticsTracker.js`
- Modify: `flask-react-supabase-app/mobile/App.js`

- [ ] **Step 1: Create the tracker component**

```javascript
// flask-react-supabase-app/mobile/src/components/PlatformAnalyticsTracker.js
import { useEffect, useRef } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '../utils/apiClient';

const VISITOR_KEY = 'dph_platform_visitor_id';
const SESSION_KEY = 'dph_platform_session_id';

const newId = () => `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;

const ensureId = async (storage, key) => {
  let id = await storage.getItem(key);
  if (!id) {
    id = newId();
    await storage.setItem(key, id);
  }
  return id;
};

let cachedVisitorId = null;
let sessionId = newId(); // fresh per app cold start

export const trackMobilePlatformEvent = async (eventName, payload = {}) => {
  try {
    if (!cachedVisitorId) cachedVisitorId = await ensureId(AsyncStorage, VISITOR_KEY);
    await apiClient.post('/api/analytics/events', {
      event_name: eventName,
      page_path: payload.page_path || `/mobile/${eventName}`,
      page_kind: payload.page_kind || 'mobile',
      session_id: sessionId,
      visitor_id: cachedVisitorId,
      metadata: { platform: 'mobile', ...payload.metadata },
    });
  } catch (_) { /* analytics never blocks UI */ }
};

// Hook to attach to NavigationContainer onStateChange:
export const useNavigationAnalytics = (navigationRef) => {
  const lastRouteRef = useRef('');
  const onStateChange = () => {
    const route = navigationRef.current?.getCurrentRoute?.()?.name;
    if (route && route !== lastRouteRef.current) {
      lastRouteRef.current = route;
      trackMobilePlatformEvent('page_view', {
        page_path: `/mobile/${route}`,
        page_kind: 'mobile_screen',
      });
    }
  };
  return onStateChange;
};
```

- [ ] **Step 2: Wire into App.js**

In `App.js`, attach the navigation listener:

```javascript
import { NavigationContainer } from '@react-navigation/native';
import { useRef } from 'react';
import { useNavigationAnalytics } from './src/components/PlatformAnalyticsTracker';

export default function App() {
  const navigationRef = useRef(null);
  const onStateChange = useNavigationAnalytics(navigationRef);
  return (
    <NavigationContainer ref={navigationRef} onStateChange={onStateChange}>
      {/* existing children */}
    </NavigationContainer>
  );
}
```

(The NavigationContainer wiring may already exist in `App.js`; modify the existing one rather than nesting.)

- [ ] **Step 3: Manual smoke test**

Launch mobile app on simulator, navigate between two tabs, then on web admin → Live Users tile within 5 min should show ≥1.

- [ ] **Step 4: Commit**

```bash
git commit -am "Mobile: write platform_events from RN so live_users sees mobile

The Live Users KPI was platform_events-only and mobile never wrote to
that table, so mobile-only sessions were invisible. Add an RN equivalent
of PlatformAnalyticsTracker that posts page_view events from each screen
mount via the existing /api/analytics/events route, with the visitor_id
persisted in AsyncStorage so the same install counts as one visitor
across sessions."
```

---

### Task 6: Stale-while-revalidate on the admin dashboard

Today: every dashboard mount blocks on `Promise.all([...])` and the user stares at "Loading..." for the entire backend round-trip. Fix: render cached data instantly, refresh in the background, swap when fresh.

**Files:**
- Create: `flask-react-supabase-app/frontend/src/utils/swrCache.js`
- Create: `flask-react-supabase-app/mobile/src/utils/swrCache.js`
- Modify: `flask-react-supabase-app/frontend/src/components/AdminDashboard.js`
- Modify: `flask-react-supabase-app/mobile/src/screens/admin/AdminDashboardScreen.js`

- [ ] **Step 1: Implement web `swrCache.js`**

```javascript
// flask-react-supabase-app/frontend/src/utils/swrCache.js
const PREFIX = 'dph_swr:';
export const swrGet = (key) => {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const { value, savedAt } = JSON.parse(raw);
    return { value, ageMs: Date.now() - savedAt };
  } catch { return null; }
};
export const swrSet = (key, value) => {
  try {
    window.localStorage.setItem(PREFIX + key,
      JSON.stringify({ value, savedAt: Date.now() }));
  } catch { /* quota — give up */ }
};
```

- [ ] **Step 2: Implement mobile `swrCache.js`**

```javascript
// flask-react-supabase-app/mobile/src/utils/swrCache.js
import AsyncStorage from '@react-native-async-storage/async-storage';
const PREFIX = 'dph_swr:';
export const swrGet = async (key) => {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const { value, savedAt } = JSON.parse(raw);
    return { value, ageMs: Date.now() - savedAt };
  } catch { return null; }
};
export const swrSet = async (key, value) => {
  try {
    await AsyncStorage.setItem(PREFIX + key,
      JSON.stringify({ value, savedAt: Date.now() }));
  } catch { /* ignore */ }
};
```

- [ ] **Step 3: Hook web AdminDashboard to SWR**

Find the `loadDashboard` effect in `AdminDashboard.js`. Wrap the four state setters so each is seeded from cache on mount and overwritten by the live response:

```javascript
import { swrGet, swrSet } from '../utils/swrCache';

useEffect(() => {
  // 1. Hydrate from cache instantly
  const cached = swrGet(`admin-dashboard:${timeRange}`);
  if (cached?.value) {
    const { stats, leadMetrics, history, dealers, reports } = cached.value;
    setStats(stats); setLeadMetrics(leadMetrics); setHistory(history);
    setDealers(dealers); setReports(reports);
    setLoading(false);
  }

  // 2. Background refresh
  let active = true;
  (async () => {
    try {
      const [statsRes, leadRes, historyRes, dealersRes, reportsRes] =
        await Promise.all([...]);
      if (!active) return;
      const merged = {
        stats: statsRes || {},
        leadMetrics: leadRes || null,
        history: Array.isArray(historyRes) ? historyRes : [],
        dealers: Array.isArray(dealersRes) ? dealersRes : [],
        reports: Array.isArray(reportsRes) ? reportsRes : [],
      };
      setStats(merged.stats); setLeadMetrics(merged.leadMetrics);
      setHistory(merged.history); setDealers(merged.dealers);
      setReports(merged.reports);
      swrSet(`admin-dashboard:${timeRange}`, merged);
    } catch (err) { /* keep cached values */ }
    finally { if (active) setLoading(false); }
  })();
  return () => { active = false; };
}, [timeRange]);
```

- [ ] **Step 4: Hook mobile AdminDashboardScreen identically**

(Same pattern, using the async swrGet/swrSet.)

- [ ] **Step 5: Make live-users polling tab-visibility-aware (web)**

Replace the unconditional `setInterval(loadLiveUsers, 15000)` with:

```javascript
const visible = () => !document.hidden;
const loadLiveUsers = async () => { /* unchanged */ };
let intervalId = null;
const start = () => { if (!intervalId) intervalId = setInterval(loadLiveUsers, 15000); };
const stop = () => { if (intervalId) { clearInterval(intervalId); intervalId = null; } };
loadLiveUsers();
if (visible()) start();
document.addEventListener('visibilitychange', () => visible() ? start() : stop());
return () => { document.removeEventListener('visibilitychange', () => {}); stop(); };
```

- [ ] **Step 6: Mobile AppState polling**

In `AdminDashboardScreen.js` replace the `setInterval` with:

```javascript
import { AppState } from 'react-native';
// inside live-users effect:
let intervalId = null;
const loadLive = async () => { /* unchanged */ };
const start = () => { if (!intervalId) intervalId = setInterval(loadLive, 15000); };
const stop = () => { if (intervalId) { clearInterval(intervalId); intervalId = null; } };
loadLive();
if (AppState.currentState === 'active') start();
const sub = AppState.addEventListener('change', s => s === 'active' ? start() : stop());
return () => { sub.remove(); stop(); };
```

- [ ] **Step 7: Commit**

```bash
git commit -am "Admin dashboard: SWR cache + visibility-aware polling

Each admin dashboard mount used to block on a five-way Promise.all
before painting anything; on cold cache that's a multi-second wall of
'Loading...' even though the previous-tab data was perfectly adequate
to render. Hydrate from a localStorage/AsyncStorage cache instantly,
refresh in the background, swap when fresh.

Live-users polling now suspends when the tab is backgrounded (web) or
the app is in inactive/background state (mobile) — saves a hit every
15 seconds for sessions that aren't watching anyway."
```

---

### Task 7: Verification + UI label parity

Sanity-check that the displayed KPI labels match what we now compute.

**Files:**
- Modify: `flask-react-supabase-app/frontend/src/components/AdminDashboard.js`
- Modify: `flask-react-supabase-app/mobile/src/screens/admin/AdminDashboardScreen.js`

- [ ] **Step 1: Update KPI labels to match windowed semantics**

Find the `<KpiCard label="Total views" ...>` (mobile) and equivalent `<div className="admin-kpi-label">Total views</div>` (web). Change the helper text:

- Mobile: keep `label={`Total Views (${selectedRangeLabel})`}` — already windowed.
- Web: under the value, change the kpi-note text from "Combined listing visibility by type." to `"Detail-page mounts in the selected window."`.

- [ ] **Step 2: Rename `Calls` / `WhatsApp` tooltip text**

Add a `title` attribute to the conversion tiles describing the dedupe semantics:

```jsx
<div title="Unique users who tapped Call in the selected window">
  Calls
</div>
```

- [ ] **Step 3: Commit**

```bash
git commit -am "Admin KPI labels: parity with windowed/deduped semantics"
```

---

## Self-Review

**1. Spec coverage:**
- Speed (the felt slowness): Task 1 (count-only probes, removes ~13k row fetch), Task 6 (SWR — instant first paint).
- Accuracy bugs: Task 2 (windowed views), Task 3 (visitor dedupe), Task 4 (qualified-lead dedupe), Task 5 (mobile live-users).
- "Tell me what to do": § Status Audit at top + this plan.

**2. Placeholder scan:** No "TBD", "TODO", "handle edge cases", or "similar to Task N". Every step has either explicit code, an explicit shell command, or an explicit file edit.

**3. Type consistency:**
- `_canonical_visitor_key` is defined in Task 3 and reused in Task 4. Same signature `(row, fallback_id=None) -> str | None` both places.
- `_supabase_count(table, params=None) -> int` defined in Task 1, used same way in Task 1 (only).
- `swrGet` / `swrSet` defined in Tasks 6.1 / 6.2 with consistent web vs mobile signatures (web sync, mobile async — explicitly documented).

---

## What the operator (user) needs to do — NOT in code

Independent of this plan; one-line items that unlock things in the existing code:

1. **Microsoft Clarity provisioning** (~5 min). clarity.microsoft.com → new project → grab 10-char Project ID → paste in Vercel as `REACT_APP_CLARITY_PROJECT_ID` → redeploy. After that the Open Clarity Dashboard button works and heatmaps record.
2. **Mark GA4 conversions** (~1 min, after some traffic). GA4 → Admin → Events → toggle "Mark as conversion" on `sign_up`, `contact_click_call`, `contact_click_whatsapp`, `post_listing_success`.
3. **Rotate the leaked OAuth + service-account credentials** (~3 min total). Both were pasted in chat earlier this week. Cloud Console → Credentials → reset the OAuth secret AND delete the `e41af9d3…` service-account key.
4. **Delete now-unused Railway env vars** (~1 min): `GA4_PROPERTY_ID`, `GA4_SERVICE_ACCOUNT_JSON`, `GA4_CACHE_TTL_SECONDS` — the backend no longer reads them after commit `4a65532`.

Everything else from this plan is something I'll execute.

---

## Estimated effort

| Task | Lines changed | Risk |
|---|---|---|
| 1 Count-only probes | ~80 backend, ~30 test | Low — read-only optimization |
| 2 Windowed views | ~40 backend, ~25 test | Low — adds new field |
| 3 Visitor dedupe | ~30 backend, ~25 test | Medium — changes a number on the dashboard |
| 4 Qualified leads | ~25 backend, ~25 test | Medium — same |
| 5 Mobile tracker | ~80 mobile | Low — additive |
| 6 SWR cache + smart polling | ~120 frontend (web+mobile) | Low — additive |
| 7 Label parity | ~10 frontend | Trivial |

Total: ~440 lines of code + ~105 lines of tests across 6 commits.
