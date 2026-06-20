# Performance: Fast Initial Load for Car Listings

**Date:** 2026-06-20  
**Goal:** First cars visible in under 1 second; rest loads as user scrolls. Scales cleanly to 1,000+ listings.

---

## Problem Statement

The public car listings page and admin panel are slow due to four specific root causes:

1. **Admin `GET /api/admin/listings`** — fetches every row with `select=*` and no `limit`/`offset`. At 1,000 listings this returns a 1,000-row JSON blob.
2. **Admin auth overhead** — `admin_required` makes 2 HTTP calls to Supabase (token verify + user lookup) on every admin request with no caching. Adds ~200–400ms per action.
3. **Public `/api/cars` two-query problem** — seller info is fetched in a separate `_batch_fetch_seller_map` call after the main listing query. Two Supabase round trips per page load.
4. **Frontend session cache TTL is 60 seconds** — filter changes and return visits always hit the server even when data hasn't changed.

---

## Success Criteria

- First 12 listing cards visible in under 1 second on a normal connection
- Returning to the listing page (back button) renders instantly from cache
- Admin panel listings load in under 1 second regardless of total listing count
- All changes are backwards-compatible — no schema changes to existing columns

---

## Architecture

### Backend Changes

#### 1. Admin pagination — `backend/app.py` `admin_listings_search`

The real admin listings endpoint is `GET /api/admin/listings-search` at line 17988 in `app.py`. It currently:
- Loops over each requested listing type (cars, bikes, parts, plates, drafts) — up to 5 separate Supabase queries per load
- Has a hardcoded `"limit": "500"` on each query with `select=*`
- Returns a flat merged list with no total count

Changes:
- Add `limit` and `offset` query params (default `limit=50`, max cap `100`)
- Pass `limit` and `offset` down to each per-type Supabase query
- Add `Prefer: count=exact` header per query; sum counts across types for `total`
- Response shape changes from a bare list to:
  ```json
  { "data": [...], "total": 312, "offset": 0, "limit": 50 }
  ```
- Also add `limit`/`offset` to `get_all_listings` in `backend/routes/admin.py` which is used as a fallback by `AdminListings.js`

#### 2. Admin auth caching — `backend/routes/admin.py`

In `admin_required`:

- After a successful auth+DB check, store the result in Redis keyed by `sha256(token)` with a 5-minute TTL:
  ```
  admin-auth:{token_hash} → {"user_id": "...", "is_admin": true}
  ```
- On next request with the same token, return the cached result immediately (skip both HTTP calls)
- If Redis is unavailable, fall through to the existing two-call path (graceful degradation)
- If Supabase returns 401, delete the cached entry immediately

#### 3. Inline seller data — `backend/app.py` `get_cars()`

Replace the post-fetch `_batch_fetch_seller_map` call with an embedded Supabase foreign table join in the select string:

```python
filtered_params["select"] = (
    "id,user_id,car_manufacturer,...,"
    "users(username,whatsapp_number,is_dealer),"
    "car_images(" + LISTING_IMAGE_SELECTS["cars"] + ")"
)
```

Flatten `users` into the listing object server-side the same way the admin route already does:

```python
for car in response:
    user_info = car.pop("users", {}) or {}
    car["seller_username"] = user_info.get("username")
    car["whatsapp_number"] = user_info.get("whatsapp_number") or car.get("whatsapp_number")
    car["is_dealer"] = user_info.get("is_dealer", False)
```

Remove `_batch_fetch_seller_map` call from `get_cars()`. The function itself can remain for other callers.

#### 4. DB indexes — Supabase migration

Single migration file. All indexes are plain btree, non-unique — safe to add with no downtime.

```sql
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

---

### Frontend Changes

#### 5. Initial page size 24 → 12 — `frontend/src/components/CarList.jsx`

```js
const LIST_PAGE_SIZE = 12;  // was 24
```

"Load More" also fetches 12 at a time. Halves first-load payload and render work.

#### 6. Stale-while-revalidate + 5-minute cache — `frontend/src/utils/fetchCache.js`

Change `fetchJsonWithCache` behaviour:

- Raise `DEFAULT_TTL_MS` from `60 * 1000` to `5 * 60 * 1000` (5 minutes)
- If cached data exists (even stale), return it **immediately** then fetch fresh data in the background
- If fresh data differs from cached, call a provided `onUpdate` callback so the component can re-render
- API: `fetchJsonWithCache(url, { ttlMs, signal, onUpdate })`

Implementation sketch:

```js
export const fetchJsonWithCache = async (url, { ttlMs = DEFAULT_TTL_MS, signal, onUpdate } = {}) => {
  const cached = readJsonSessionCache(url);

  if (cached && onUpdate) {
    // Return stale immediately, refresh in background
    setTimeout(async () => {
      const fresh = await fetchFromNetwork(url, { signal });
      writeJsonSessionCache(url, fresh.data, ttlMs);
      if (JSON.stringify(fresh.data) !== JSON.stringify(cached)) {
        onUpdate(fresh);
      }
    }, 0);
    return { ok: true, status: 200, data: cached };
  }

  return fetchFromNetwork(url, { ttlMs, signal });
};
```

Update `CarList.jsx` to pass `onUpdate` and replace state if fresher data arrives.

#### 7. Admin pagination UI — `frontend/src/components/AdminListings.js`

Add to the admin listings view:
- State: `page` (0-indexed), `totalCount`
- Read `total` from response and store in `totalCount`
- Prev / Next buttons, disabled at boundaries
- Label: `Showing {offset + 1}–{Math.min(offset + limit, total)} of {total} listings`
- Filter changes reset `page` to 0

---

## Data Flow (after changes)

```
User visits /cars
  → fetchJsonWithCache("/api/cars?limit=12&offset=0")
    → cache hit? return immediately, background-refresh
    → cache miss? single Supabase query (listings + seller + images joined)
      → Redis cache set (5 min)
      → return 12 cards
  → render 12 cards < 1s
  → user scrolls → Load More → fetch offset=12
```

```
Admin visits /admin/listings
  → GET /api/admin/listings?limit=50&offset=0
    → admin_required checks Redis auth cache (5 min TTL)
    → Supabase query with LIMIT 50
    → return { data: [...50 rows], total: 312 }
  → render 50 rows + pagination controls
```

---

## Out of Scope

- Cursor-based pagination (keyset) — not needed until 10,000+ rows
- Vercel edge caching — out of scope for this change
- Service worker prefetch — out of scope
- Image CDN resizing / WebP conversion — separate concern
- Changes to bikes, plates, parts list pages (same pattern, can follow later)

---

## Files Changed

| File | Change |
|---|---|
| `backend/routes/admin.py` | Add pagination to `get_all_listings`; cache admin auth in Redis |
| `backend/app.py` | Inline seller join in `get_cars()`; remove `_batch_fetch_seller_map` call |
| `frontend/src/utils/fetchCache.js` | Raise TTL to 5 min; add stale-while-revalidate with `onUpdate` |
| `frontend/src/components/CarList.jsx` | Lower `LIST_PAGE_SIZE` to 12; pass `onUpdate` to `fetchJsonWithCache` |
| `frontend/src/components/AdminListings.js` | Read `total` from response; add Prev/Next pagination controls |
| `supabase/migrations/YYYYMMDD_performance_indexes.sql` | Add btree indexes on filter/sort columns |
