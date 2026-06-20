# Performance: Fast Initial Load for Car Listings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** First 12 listing cards visible in under 1 second; admin panel listings load in under 1 second at any catalog size.

**Architecture:** Seven targeted changes — DB indexes, frontend initial page size reduction, stale-while-revalidate cache, backend seller-join elimination, admin auth caching, admin backend limit reduction, and admin frontend pagination. Each change is independent and can be committed separately.

**Tech Stack:** Flask + Python 3.14, React 18, Supabase (PostgREST), Redis, `unittest`/`unittest.mock`

---

## File Map

| File | Change |
|---|---|
| `supabase/migrations/20260620_performance_indexes.sql` | New — btree indexes |
| `backend/app.py` | `get_cars()` seller join; `_require_admin_api_user()` Redis cache; `admin_listings_search()` limit reduction |
| `backend/test_performance.py` | New — unit tests for Tasks 4, 5, 6 |
| `frontend/src/utils/fetchCache.js` | Raise TTL, add SWR `onUpdate` |
| `frontend/src/components/CarList.jsx` | Page size 24→12, pass `onUpdate` |
| `frontend/src/components/AdminListings.js` | Client-side pagination (25/page) |

---

## Task 1: DB Indexes Migration

**Files:**
- Create: `supabase/migrations/20260620_performance_indexes.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/20260620_performance_indexes.sql
-- Plain btree indexes on filter and sort columns. IF NOT EXISTS makes this
-- safe to run multiple times and causes no downtime on small tables.

-- cars
CREATE INDEX IF NOT EXISTS idx_cars_status ON cars (status);
CREATE INDEX IF NOT EXISTS idx_cars_manufacturer ON cars (car_manufacturer);
CREATE INDEX IF NOT EXISTS idx_cars_model ON cars (car_model);
CREATE INDEX IF NOT EXISTS idx_cars_created_at ON cars (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cars_price ON cars (expected_selling_price);

-- bikes
CREATE INDEX IF NOT EXISTS idx_bikes_status ON bikes (status);
CREATE INDEX IF NOT EXISTS idx_bikes_created_at ON bikes (created_at DESC);

-- license_plates
CREATE INDEX IF NOT EXISTS idx_plates_status ON license_plates (status);
CREATE INDEX IF NOT EXISTS idx_plates_created_at ON license_plates (created_at DESC);

-- car_parts
CREATE INDEX IF NOT EXISTS idx_parts_status ON car_parts (status);
CREATE INDEX IF NOT EXISTS idx_parts_created_at ON car_parts (created_at DESC);
```

- [ ] **Step 2: Apply the migration via Supabase MCP**

Use `mcp__claude_ai_Supabase__apply_migration` with the SQL above, or run it via the Supabase dashboard SQL editor → New Query → paste and run.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260620_performance_indexes.sql
git commit -m "perf: add btree indexes on listing filter and sort columns"
```

---

## Task 2: Reduce Initial Page Size 24 → 12

**Files:**
- Modify: `frontend/src/components/CarList.jsx:16`

- [ ] **Step 1: Change the constant**

In `frontend/src/components/CarList.jsx`, find line 16:
```js
const LIST_PAGE_SIZE = 24;
```
Change to:
```js
const LIST_PAGE_SIZE = 12;
```

- [ ] **Step 2: Verify the "Load More" also uses the constant**

Run this grep to confirm no other hard-coded `24` is used as a page size:
```bash
grep -n "24\|PAGE_SIZE" flask-react-supabase-app/frontend/src/components/CarList.jsx
```
Expected: only `LIST_PAGE_SIZE = 12` and usages of `LIST_PAGE_SIZE`.

- [ ] **Step 3: Commit**

```bash
git add flask-react-supabase-app/frontend/src/components/CarList.jsx
git commit -m "perf: reduce initial car listing page size from 24 to 12"
```

---

## Task 3: Stale-While-Revalidate + 5-Minute Cache

**Files:**
- Modify: `frontend/src/utils/fetchCache.js`
- Modify: `frontend/src/components/CarList.jsx`

The goal: when cached data exists, return it immediately AND kick off a background fetch. If the fresh data differs, call `onUpdate(fresh)` so the component re-renders. Raise TTL from 60s to 5 minutes.

- [ ] **Step 1: Rewrite `fetchCache.js`**

Replace the entire contents of `frontend/src/utils/fetchCache.js` with:

```js
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const inflightRequests = new Map();

const buildCacheKey = (url) => `json-cache:${url}`;

export const readJsonSessionCache = (url) => {
  if (typeof window === 'undefined' || !url) return null;
  try {
    const raw = window.sessionStorage.getItem(buildCacheKey(url));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.expiresAt && Date.now() > parsed.expiresAt) return null;
    return parsed.data ?? null;
  } catch {
    return null;
  }
};

export const writeJsonSessionCache = (url, data, ttlMs = DEFAULT_TTL_MS) => {
  if (typeof window === 'undefined' || !url) return;
  try {
    window.sessionStorage.setItem(
      buildCacheKey(url),
      JSON.stringify({ expiresAt: Date.now() + (ttlMs || DEFAULT_TTL_MS), data })
    );
  } catch {
    // Ignore storage errors (private mode / quota exceeded).
  }
};

async function _fetchFromNetwork(url, { ttlMs = DEFAULT_TTL_MS, signal } = {}) {
  const fetchPromise = fetch(url, { headers: { Accept: 'application/json' }, signal })
    .then(async (response) => {
      const data = await response.json();
      writeJsonSessionCache(url, data, ttlMs);
      return { ok: response.ok, status: response.status, data };
    })
    .finally(() => {
      inflightRequests.delete(url);
    });
  inflightRequests.set(url, fetchPromise);
  return fetchPromise;
}

/**
 * Fetch JSON with session-storage cache.
 *
 * When `onUpdate` is provided and stale data exists in the cache:
 *   - Returns the cached data immediately (no network wait)
 *   - Fetches fresh data in the background
 *   - Calls onUpdate(freshResponse) if the data changed
 */
export const fetchJsonWithCache = async (url, { ttlMs = DEFAULT_TTL_MS, signal, onUpdate } = {}) => {
  if (!url) throw new Error('Missing url');

  const cached = readJsonSessionCache(url);

  if (cached !== null && onUpdate) {
    // Return stale immediately; fire background refresh
    if (!inflightRequests.has(url)) {
      _fetchFromNetwork(url, { ttlMs, signal })
        .then((fresh) => {
          if (fresh.ok && JSON.stringify(fresh.data) !== JSON.stringify(cached)) {
            onUpdate(fresh);
          }
        })
        .catch(() => {});
    }
    return { ok: true, status: 200, data: cached };
  }

  if (inflightRequests.has(url)) return inflightRequests.get(url);
  return _fetchFromNetwork(url, { ttlMs, signal });
};
```

- [ ] **Step 2: Wire `onUpdate` into `CarList.jsx`**

In `frontend/src/components/CarList.jsx`, find the `fetchCars` function (around line 180). The current call is:
```js
const response = await fetchJsonWithCache(url);
```

Change it to pass `onUpdate` when this is an initial/reset load:
```js
const response = await fetchJsonWithCache(url, {
  onUpdate: reset
    ? (fresh) => {
        const freshCars = Array.isArray(fresh.data) ? fresh.data : [];
        if (freshCars.length > 0) {
          setCars(freshCars);
          setHasMore(freshCars.length >= LIST_PAGE_SIZE);
        }
      }
    : undefined,
});
```

- [ ] **Step 3: Start the dev server and verify instant re-render on back-navigation**

```bash
cd flask-react-supabase-app/frontend && npm start
```

1. Open `/cars` — cars load normally (cache miss)
2. Click into a car detail page
3. Hit browser Back — the car list should appear instantly without a loading spinner
4. After ~1 second the list may silently refresh if the data changed

- [ ] **Step 4: Commit**

```bash
git add flask-react-supabase-app/frontend/src/utils/fetchCache.js \
        flask-react-supabase-app/frontend/src/components/CarList.jsx
git commit -m "perf: stale-while-revalidate cache with 5-minute TTL for listing pages"
```

---

## Task 4: Inline Seller Join in `get_cars()`

**Files:**
- Modify: `backend/app.py` (lines ~5388–5435)
- Create: `backend/test_performance.py`

Currently `get_cars()` fetches cars then calls `_batch_fetch_seller_map` — a second round-trip to Supabase. We replace that with a Supabase foreign table embed in the select string, so one query returns both cars and seller data.

- [ ] **Step 1: Write the failing test**

Create `backend/test_performance.py`:

```python
import json
import unittest
from unittest.mock import patch, MagicMock

import app as backend


class TestGetCarsSellerJoin(unittest.TestCase):
    """get_cars() must resolve seller info without a second Supabase call."""

    def _make_car_row(self):
        return {
            "id": "car-1",
            "user_id": "user-1",
            "car_manufacturer": "Toyota",
            "car_model": "Camry",
            "trim": "SE",
            "make_year": 2022,
            "car_city": "Dubai",
            "expected_selling_price": 80000,
            "kilometer_driven": 20000,
            "car_description": "Good car",
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z",
            "status": "approved",
            "is_approved": True,
            "view_count": 5,
            "lady_driven": False,
            "whatsapp_number": "+971501234567",
            "whatsapp_prefill_text": "",
            "vin_number": None,
            "users": {
                "id": "user-1",
                "username": "seller123",
                "first_name": "Ahmed",
                "last_name": "Al Mansoori",
                "profile_photo_url": None,
                "is_dealer": False,
            },
            "car_images": [],
        }

    def test_get_cars_uses_single_supabase_call(self):
        """After the fix, get_cars must not call _batch_fetch_seller_map."""
        car_row = self._make_car_row()

        with backend.app.test_request_context("/api/cars"):
            with patch.object(backend, "supabase_request", return_value=([car_row], 200)) as mock_supabase, \
                 patch.object(backend, "_api_cache_get", return_value=None), \
                 patch.object(backend, "_api_cache_set"), \
                 patch.object(backend, "_batch_fetch_seller_map") as mock_seller_map:

                response, status = backend.get_cars()

        self.assertEqual(status, 200)
        mock_seller_map.assert_not_called()
        data = json.loads(response.data)
        self.assertEqual(data[0]["seller_name"], "seller123")

    def test_get_cars_seller_fields_populated_from_joined_users(self):
        """Seller fields must be populated from the embedded users row."""
        car_row = self._make_car_row()

        with backend.app.test_request_context("/api/cars"):
            with patch.object(backend, "supabase_request", return_value=([car_row], 200)), \
                 patch.object(backend, "_api_cache_get", return_value=None), \
                 patch.object(backend, "_api_cache_set"):

                response, status = backend.get_cars()

        data = json.loads(response.data)
        car = data[0]
        self.assertEqual(car["seller_name"], "seller123")
        self.assertIn("seller_id", car)
        self.assertIn("seller_verified", car)
        self.assertNotIn("users", car)  # must be popped, not left in response
```

- [ ] **Step 2: Run the test — expect FAIL**

```bash
cd flask-react-supabase-app/backend
python -m pytest test_performance.py::TestGetCarsSellerJoin -v
```

Expected output: `FAILED` — `_batch_fetch_seller_map` is still called.

- [ ] **Step 3: Update the select string in `get_cars()`**

In `backend/app.py`, find lines ~5388–5395:
```python
        filtered_params["select"] = (
            "id,user_id,car_manufacturer,car_model,trim,make_year,car_city,"
            "expected_selling_price,kilometer_driven,car_description,created_at,updated_at,"
            "status,is_approved,view_count,lady_driven,"
            "whatsapp_number,whatsapp_prefill_text,vin_number,car_images("
            + LISTING_IMAGE_SELECTS["cars"]
            + ")"
        )
```

Replace with:
```python
        filtered_params["select"] = (
            "id,user_id,car_manufacturer,car_model,trim,make_year,car_city,"
            "expected_selling_price,kilometer_driven,car_description,created_at,updated_at,"
            "status,is_approved,view_count,lady_driven,"
            "whatsapp_number,whatsapp_prefill_text,vin_number,"
            "users(id,username,first_name,last_name,profile_photo_url,is_dealer),"
            "car_images(" + LISTING_IMAGE_SELECTS["cars"] + ")"
        )
```

- [ ] **Step 4: Replace the post-fetch seller block**

Find lines ~5427–5435 (the `_batch_fetch_seller_map` try/except block):
```python
        # Fetch seller info for each car
        try:
            seller_map = _batch_fetch_seller_map(
                [car.get("user_id") for car in response]
            )
            for car in response:
                _apply_seller_to_listing(car, seller_map.get(car.get("user_id")))
        except Exception as e:
            logger.warning(f"Error fetching seller info: {e}")
```

Replace with:
```python
        # Apply seller info from the embedded users join
        for car in response:
            user_info = car.pop("users", None) or {}
            _apply_seller_to_listing(car, user_info)
```

- [ ] **Step 5: Run the tests — expect PASS**

```bash
cd flask-react-supabase-app/backend
python -m pytest test_performance.py::TestGetCarsSellerJoin -v
```

Expected: `PASSED`

- [ ] **Step 6: Commit**

```bash
git add flask-react-supabase-app/backend/app.py \
        flask-react-supabase-app/backend/test_performance.py
git commit -m "perf: inline seller join in get_cars() — eliminates second Supabase round trip"
```

---

## Task 5: Admin Auth Caching in Redis

**Files:**
- Modify: `backend/app.py` (line ~14168, `_require_admin_api_user`)
- Modify: `backend/test_performance.py`

Every admin action currently runs `_get_user_details_with_admin_status` which makes 2 HTTP calls to Supabase. We cache the result in Redis by `user_id` for 5 minutes.

- [ ] **Step 1: Write the failing test**

Add to `backend/test_performance.py`:

```python
class TestAdminAuthCaching(unittest.TestCase):
    """_require_admin_api_user must use Redis cache on repeat calls."""

    def _make_admin_user(self, user_id="admin-1"):
        return {
            "id": user_id,
            "email": "admin@example.com",
            "is_admin": True,
            "is_super_admin": False,
            "is_dealer": False,
            "dealer_verified": False,
            "email_verified": True,
            "phone_verified": False,
        }

    def test_second_call_uses_cache_and_skips_http(self):
        """On cache hit, _get_user_details_with_admin_status must not be called."""
        user_details = self._make_admin_user()
        redis_mock = MagicMock()
        redis_mock.get.return_value = json.dumps(user_details).encode()

        with patch.object(backend, "_get_redis_cache_client", return_value=redis_mock), \
             patch.object(backend, "_get_user_details_with_admin_status") as mock_details:

            result = backend._require_admin_api_user("admin-1")

        self.assertIsNotNone(result)
        self.assertTrue(result["is_admin"])
        mock_details.assert_not_called()

    def test_cache_miss_calls_supabase_then_stores_in_redis(self):
        """On cache miss, must call _get_user_details_with_admin_status and then cache."""
        user_details = self._make_admin_user()
        redis_mock = MagicMock()
        redis_mock.get.return_value = None  # cache miss

        with patch.object(backend, "_get_redis_cache_client", return_value=redis_mock), \
             patch.object(backend, "_get_user_details_with_admin_status", return_value=user_details):

            result = backend._require_admin_api_user("admin-1")

        self.assertIsNotNone(result)
        redis_mock.setex.assert_called_once()
        call_args = redis_mock.setex.call_args
        self.assertEqual(call_args[0][0], "admin-auth-status:admin-1")
        self.assertEqual(call_args[0][1], 300)

    def test_non_admin_user_not_cached(self):
        """Non-admin users must return None and must NOT be cached."""
        redis_mock = MagicMock()
        redis_mock.get.return_value = None

        with patch.object(backend, "_get_redis_cache_client", return_value=redis_mock), \
             patch.object(backend, "_get_user_details_with_admin_status", return_value={"id": "u1", "is_admin": False}):

            result = backend._require_admin_api_user("u1")

        self.assertIsNone(result)
        redis_mock.setex.assert_not_called()
```

- [ ] **Step 2: Run the tests — expect FAIL**

```bash
cd flask-react-supabase-app/backend
python -m pytest test_performance.py::TestAdminAuthCaching -v
```

Expected: `FAILED`

- [ ] **Step 3: Update `_require_admin_api_user` in `backend/app.py`**

Find line ~14168:
```python
def _require_admin_api_user(current_user):
    user_details = _get_user_details_with_admin_status(current_user)
    return user_details if user_details and user_details.get("is_admin") else None
```

Replace with:
```python
def _require_admin_api_user(current_user):
    redis_client = _get_redis_cache_client()
    cache_key = f"admin-auth-status:{current_user}"

    if redis_client:
        try:
            cached = redis_client.get(cache_key)
            if cached is not None:
                data = json.loads(cached)
                return data if data and data.get("is_admin") else None
        except Exception:
            pass

    user_details = _get_user_details_with_admin_status(current_user)

    if redis_client and user_details and user_details.get("is_admin"):
        try:
            redis_client.setex(cache_key, 300, json.dumps(user_details, default=str))
        except Exception:
            pass

    return user_details if user_details and user_details.get("is_admin") else None
```

- [ ] **Step 4: Run the tests — expect PASS**

```bash
cd flask-react-supabase-app/backend
python -m pytest test_performance.py::TestAdminAuthCaching -v
```

Expected: `PASSED`

- [ ] **Step 5: Commit**

```bash
git add flask-react-supabase-app/backend/app.py \
        flask-react-supabase-app/backend/test_performance.py
git commit -m "perf: cache admin auth status in Redis (5-minute TTL) to skip Supabase HTTP calls"
```

---

## Task 6: Reduce Admin Listings Backend Limit

**Files:**
- Modify: `backend/app.py` (line ~18086, `admin_listings_search`)
- Modify: `backend/test_performance.py`

`admin_listings_search` currently fetches up to 500 rows per listing type with `select=*`. We reduce this to 100 and expose it as a `limit` query param (max 200). The total response is capped at 100 per type × 5 types = 500 rows max (down from 2,500).

- [ ] **Step 1: Write the failing test**

Add to `backend/test_performance.py`:

```python
class TestAdminListingsLimit(unittest.TestCase):
    """admin_listings_search must respect the limit param and default to 100."""

    def _admin_user(self):
        return {"id": "admin-1", "email": "a@b.com", "is_admin": True}

    def test_default_limit_is_100(self):
        """When no limit param given, Supabase query uses limit=100."""
        with backend.app.test_request_context("/api/admin/listings-search?types=cars"):
            with patch.object(backend, "_require_admin_api_user", return_value=self._admin_user()), \
                 patch.object(backend, "supabase_request", return_value=([], 200)) as mock_supabase, \
                 patch.object(backend, "_admin_fetch_latest_verification_scans", return_value={}):

                # Use .__wrapped__ to bypass the @token_required decorator
                backend.admin_listings_search.__wrapped__("admin-1")

        call_params = mock_supabase.call_args_list[0][1]["params"]
        self.assertEqual(call_params["limit"], "100")

    def test_custom_limit_is_respected(self):
        """limit=25 in query string must be passed to Supabase."""
        with backend.app.test_request_context("/api/admin/listings-search?types=cars&limit=25"):
            with patch.object(backend, "_require_admin_api_user", return_value=self._admin_user()), \
                 patch.object(backend, "supabase_request", return_value=([], 200)) as mock_supabase, \
                 patch.object(backend, "_admin_fetch_latest_verification_scans", return_value={}):

                backend.admin_listings_search.__wrapped__("admin-1")

        call_params = mock_supabase.call_args_list[0][1]["params"]
        self.assertEqual(call_params["limit"], "25")

    def test_limit_capped_at_200(self):
        """limit=9999 must be capped at 200."""
        with backend.app.test_request_context("/api/admin/listings-search?types=cars&limit=9999"):
            with patch.object(backend, "_require_admin_api_user", return_value=self._admin_user()), \
                 patch.object(backend, "supabase_request", return_value=([], 200)) as mock_supabase, \
                 patch.object(backend, "_admin_fetch_latest_verification_scans", return_value={}):

                backend.admin_listings_search.__wrapped__("admin-1")

        call_params = mock_supabase.call_args_list[0][1]["params"]
        self.assertEqual(call_params["limit"], "200")
```

- [ ] **Step 2: Run the tests — expect FAIL**

```bash
cd flask-react-supabase-app/backend
python -m pytest test_performance.py::TestAdminListingsLimit -v
```

Expected: `FAILED` — `limit` is `"500"` not `"100"`.

- [ ] **Step 3: Add limit param parsing to `admin_listings_search`**

In `backend/app.py`, find line ~18034 (right after the `if not requested_statuses...` block and before `listings = []`):

```python
        if not requested_statuses or "all" in requested_statuses:
            requested_statuses = []

        listings = []
```

Add the limit parsing between these two sections:

```python
        if not requested_statuses or "all" in requested_statuses:
            requested_statuses = []

        try:
            _req_limit = int(request.args.get("limit", "100"))
        except (ValueError, TypeError):
            _req_limit = 100
        per_type_limit = min(max(_req_limit, 1), 200)

        listings = []
```

- [ ] **Step 4: Use `per_type_limit` in the per-type Supabase query**

Find line ~18086:
```python
                params={"select": "*", "order": "created_at.desc", "limit": "500"},
```

Change to:
```python
                params={"select": "*", "order": "created_at.desc", "limit": str(per_type_limit)},
```

Also find the drafts query at line ~18045:
```python
                        "limit": "500",
```

Change to:
```python
                        "limit": str(per_type_limit),
```

- [ ] **Step 5: Run the tests — expect PASS**

```bash
cd flask-react-supabase-app/backend
python -m pytest test_performance.py::TestAdminListingsLimit -v
```

Expected: `PASSED`

- [ ] **Step 6: Run the full test suite to check no regressions**

```bash
cd flask-react-supabase-app/backend
python -m pytest test_performance.py -v
```

Expected: all tests `PASSED`

- [ ] **Step 7: Commit**

```bash
git add flask-react-supabase-app/backend/app.py \
        flask-react-supabase-app/backend/test_performance.py
git commit -m "perf: reduce admin listings-search limit from 500 to 100 per type, expose as query param"
```

---

## Task 7: Admin Listings Client-Side Pagination

**Files:**
- Modify: `frontend/src/components/AdminListings.js`

The backend now returns up to 100 rows per type (500 total). The frontend currently renders all rows at once. We add client-side pagination showing 25 rows per page with Prev/Next controls. No backend changes needed — all data is already in memory.

- [ ] **Step 1: Add `page` state and `ADMIN_PAGE_SIZE` constant**

In `frontend/src/components/AdminListings.js`, find the existing state declarations near the top of the component (around line 55–100). Add:

```js
const ADMIN_PAGE_SIZE = 25;
```

And in the component body alongside the other `useState` calls:
```js
const [page, setPage] = useState(0);
```

Reset page to 0 when filters change. Find the `useEffect` that calls `fetchListings` (around line 218):
```js
  useEffect(() => {
    fetchListings();
```

Change to:
```js
  useEffect(() => {
    setPage(0);
    fetchListings();
```

- [ ] **Step 2: Compute paginated slice**

`AdminListings.js` already computes `filtered` (a `useMemo` from `listings`, line 479) and renders with `filtered.map(...)` at line 623. We paginate `filtered`, not `listings`.

Find `fetchListings` around line 170. Change the `setListings` call at line 208 to also reset the page:
```js
      setPage(0);
      setListings(allListings);
```

Then, after the existing `const filtered = useMemo(...)` block (line 479), add:
```js
const totalPages = Math.ceil(filtered.length / ADMIN_PAGE_SIZE);
const pagedListings = filtered.slice(page * ADMIN_PAGE_SIZE, (page + 1) * ADMIN_PAGE_SIZE);
```

Then at line 623, replace:
```js
                  : filtered.map((listing, i) => {
```
with:
```js
                  : pagedListings.map((listing, i) => {
```

- [ ] **Step 3: Add Prev/Next pagination controls**

Find the closing section of the admin listings table/list (after the `pagedListings.map(...)` block). Add the pagination bar directly after it:

```jsx
{totalPages > 1 && (
  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '16px 0', justifyContent: 'center' }}>
    <button
      onClick={() => setPage((p) => Math.max(0, p - 1))}
      disabled={page === 0}
      style={{ padding: '6px 16px', borderRadius: '6px', border: '1px solid #ccc', cursor: page === 0 ? 'not-allowed' : 'pointer', opacity: page === 0 ? 0.5 : 1 }}
    >
      ← Prev
    </button>
    <span style={{ fontSize: '14px', color: '#666' }}>
      Showing {page * ADMIN_PAGE_SIZE + 1}–{Math.min((page + 1) * ADMIN_PAGE_SIZE, filtered.length)} of {filtered.length}
    </span>
    <button
      onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
      disabled={page >= totalPages - 1}
      style={{ padding: '6px 16px', borderRadius: '6px', border: '1px solid #ccc', cursor: page >= totalPages - 1 ? 'not-allowed' : 'pointer', opacity: page >= totalPages - 1 ? 0.5 : 1 }}
    >
      Next →
    </button>
  </div>
)}
```

- [ ] **Step 4: Start dev server and verify admin listings pagination**

```bash
cd flask-react-supabase-app/frontend && npm start
```

1. Navigate to `/admin/listings`
2. Verify listings load (should be faster — fewer rows fetched)
3. If there are more than 25 listings, Prev/Next controls appear
4. Clicking Next shows the next 25 rows
5. Changing the type or status filter resets to page 1

- [ ] **Step 5: Commit**

```bash
git add flask-react-supabase-app/frontend/src/components/AdminListings.js
git commit -m "perf: client-side pagination for admin listings (25/page)"
```

---

## Final Verification

- [ ] **Run full backend test suite**

```bash
cd flask-react-supabase-app/backend
python -m pytest test_performance.py -v
```

Expected: all 8 tests `PASSED`

- [ ] **Smoke-test the public listings page**

1. Open `/cars` in a browser
2. Open Network tab in DevTools
3. Hard refresh — confirm only 1 request to `/api/cars` (no separate `/users` call)
4. Navigate away and back — confirm car list renders without a loading spinner

- [ ] **Smoke-test admin panel**

1. Open `/admin/listings`
2. Confirm page loads faster than before (1 request instead of 5× 500-row queries)
3. Confirm Prev/Next appear when there are more than 25 listings
