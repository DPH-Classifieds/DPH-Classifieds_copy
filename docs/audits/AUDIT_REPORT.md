# DPH Classifieds — End-to-End Audit

**Repo:** `Flask-React-superbase-classified`
**Date:** 2026-08-26 (initial), 2026-08-27 (consolidated with `dphdocthing.pdf`)
**Method:** 5 parallel subagents (backend, frontend, mobile, security, supabase/schema) for v1, plus 3 parallel subagents cross-validating the third-party Performance Audit + Threat Model + Vulnerability Ledger PDF against the codebase. All file:line verified. No code modified.

---

## TL;DR — Ship these first

In order of impact-per-effort, here are the fixes that materially improve a user's day-to-day experience without months of refactor. Each is later in the report with full context.

| # | One-liner | Where | Why it matters to a user |
|---|-----------|-------|--------------------------|
| 1 | **Rate-limit deque has no lock** — intermittent 500s on contact form | `app.py:140,150,153` | A real buyer hits the form and gets a server error. |
| 2 | **Contact-lead rate limiter keys on client-supplied `X-Forwarded-For` + `visitor_id`** — trivially bypassable | `app.py:9364, 21095-21100` | Scrapers harvest every dealer's phone number. Real buyers lose exclusivity. |
| 3 | **Dealer auto-approval worker PATCH is not conditional** — two replicas double-approve dealers | `workers/dealer_auto_approval_worker.py:111-112` | A dealer gets two approval emails; admin sees phantom duplicates. |
| 4 | **Webhook delivery worker PATCH is not conditional** — duplicate webhook deliveries | `workers/webhook_delivery_worker.py:117` | Customers' dealers re-receive the same webhook. |
| 5 | **Two `admin_required` decorators** — admin route auth bypasses `app.py:19101` super-admin guard | `routes/admin.py:23-93` vs `app.py:19101` | A non-super-admin can demote the super admin. |
| 6 | **No mobile JWT SecureStore** — tokens in plaintext AsyncStorage | `mobile/src/utils/authService.js:1-36` | A stolen phone = full account takeover for as long as the session is valid. |
| 7 | **Multiple `RLS USING (true) WITH CHECK (true)` on dealer tables without `TO service_role`** — every authenticated user can read every dealer's credentials | `backend/migrations/2026_06_03_dealer_rls.sql:19`, `2026_06_05_dealer_leads.sql:91-93`, `2026_06_05_dealer_webhooks.sql:54-56` | Dealer DMS credentials are exposed to any logged-in user. |
| 8 | **Conflicting `is_admin()` definitions across migrations** — admin-only endpoints fail depending on apply order | `backend/migrations/create_users_table.sql:36`, `fix_security_issues.sql:279`, `fix_security_issues_FINAL.sql:104` | Admin pages 403 in production depending on which migration ran last. |
| 9 | **`PostCar.js` is 3,197 lines, has no submit-button disable during OCR/draft-save, has no race-free draft/submit coordination** — users double-upload, lose drafts | `frontend/src/components/PostCar.js` | A seller submits, sees "saved", but the listing has two copies or none. |
| 10 | **`AuthContext.updateUser` writes user to `localStorage` that the next mount overwrites** — "saved!" then disappears | `frontend/src/context/AuthContext.js:428-444` | Edits appear to vanish on reload. |
| 11 | **Admin stats endpoint paginates the entire listing table to count statuses in Python** — cold call is O(N) network | `app.py:1151-1185` | Admin dashboards load in seconds instead of ms; admin alt-tabbing triggers 5× refetches. |
| 12 | **Public browse indexes are wrong shape** — `(status, created_at)` but filter also requires `is_approved=true` | `supabase/migrations/20260703000004_composite_indexes.sql:6-8` | `ExplorePage` slow as soon as `cars` > ~10k approved rows. |
| ~~13~~ | ~~HEIC files accepted but never decoded~~ **[FALSE POSITIVE — corrected, see §2.4]** | `frontend/src/utils/directUpload.js:99-120` | HEIC decode already works via `heic2any`; no action needed. |
| 14 | **N+1 query for user's listings + images** — 20 listings = 21 round-trips | `app.py:2689-2697` | `/api/user/listings` is N×50ms on a slow connection. |
| 15 | **`_VIN_CACHE` and `_REDIS_CACHE_CLIENT` are module-globals with no lock under gthread workers** | `services/vin_decoder.py:27`, `app.py:575-576` | Random KeyError on VIN decoder; silent Redis outage fallback. |
| 16 | **`order=` query param not allow-listed on list endpoints** — free DB DoS lever | `app.py:6419, 14582, 16412, 16718` | Attacker sorts by `description` (textarea) to amplify DB load. |
| 17 | **Three manual CORS OPTIONS handlers** — new origin must be added in 4 places | `app.py:6893, 7282, 8798` | Staging environment silently 403s on PATCH. |
| 18 | **`unauthenticated /api/debug/json` echoes request metadata** | `app.py:6338-6352` | Loud in monitoring; leaks server fingerprinting. |
| 19 | **EXIF GPS preserved on listings photos** | `mobile/src/utils/imageCompressor.js` + backend upload path | Sellers' home GPS coordinates leak in their listing photos. |
| 20 | **Heavy frontend dependencies require importer verification** — `tensorflow`, `three`, `react-three-*`, `axios` | `frontend/package.json` | The initial “unused” claim was only partly accurate: Three.js and TensorFlow/NSFW are used by lazy/dynamic modules; only `axios` was removed for the interceptor issue. |

---

## Full report by area

### 1. Backend (Flask)

**File:** `flask-react-supabase-app/backend/`

#### 1.1 Confirmed CRITICAL

**C-B1. Rate-limit deque has no lock.** `app.py:140,150,153` declares `defaultdict(deque)`. `gunicorn.conf.py` runs `gthread` workers (4 threads/worker). Read-modify-write on the deque can raise `IndexError` or `RuntimeError` under concurrent requests, surfacing as 500s on `/api/contact`, `/api/contact/lead`, and auth endpoints.
```python
# app.py:4354-4361 (example site)
while entries and entries[0] < window_start:
    entries.popleft()  # ← IndexError if another thread empties it
```
**Fix:** Add `threading.Lock()` around every read/write of these three globals. Trivial diff, removes an intermittent 500 class.

**C-B2. Contact-lead rate limiter is bypassable.** `app.py:21095` keys on `X-Forwarded-For` (read straight from the client-supplied header with no parsing) and `app.py:21096` keys on `vid:<visitor_id>` (from the request body). Cycling either defeats the anti-scraper chokepoint on phone/WhatsApp taps.
**Fix:** Drop the per-visitor key. Validate the IP via `ipaddress.ip_address()` before using as a key. Add `ProxyFix`-style trust-of-upstream-proxy gating so `request.remote_addr` reflects the true client.

**C-B3. Two `admin_required` implementations, only one checks super-admin guard.** `routes/admin.py:23-93` re-validates the JWT against Supabase Auth on every request, checks `user_role == "superadmin"` (line 63 — Supabase never emits this; the canonical role is `authenticated`), and never calls `_protect_super_admin`. `app.py:19101` is the canonical decorator that DOES guard super-admin demotion. A non-super admin calling `POST /api/admin/users/<super_admin_id>/remove-admin` through `routes/admin.py` can strip the flag.
**Fix:** Delete `routes/admin.py:23-93`. Have the admin blueprint use `app.py:19101` consistently.

**C-B4. `dealer_auto_approval_worker` transition is not conditional.** `workers/dealer_auto_approval_worker.py:111-112`:
```python
def _mark(row_id, **fields):
    supabase_request("patch", f"/rest/v1/dealer_pending_approvals?id=eq.{row_id}", data=fields)
```
No `state=eq.pending` filter. Docstring claims DB-level concurrency safety from a unique partial index. Two worker replicas both pull the same pending row, both evaluate `_fire_pending_approval → "approve"`, both call `_approve_user` — duplicate email + duplicate dealer status flip.
**Fix:**
```python
def _claim(row_id):
    body, status = supabase_request(
        "patch", f"/rest/v1/dealer_pending_approvals?id=eq.{row_id}&state=eq.pending",
        data={"state": "firing"}, return_representation=True,
    )
    return bool(body)  # only the worker that won the claim proceeds
```
`workers/inventory_import_worker.py:48-60` already does this correctly — copy that pattern.

**C-B5. Webhook delivery worker has the same race.** `workers/webhook_delivery_worker.py:77-166` increments `attempt_count` and PATCHes without a `status=eq.pending` conditional. Two workers fetch the same `delivery_id`; both POST to the customer URL; both move the row to `succeeded`, the second overwriting the first's `delivered_at`. The customer receives the webhook twice.
**Fix:** Same as C-B4 — atomic claim to `status=in_progress` before the HTTP call.

**C-B6. `_VIN_CACHE` is a module-global dict without a lock.** `services/vin_decoder.py:27`. Under `gthread` workers, dict resize during a concurrent read raises `KeyError` or returns a torn entry. Rare in production but real.
**Fix:** Wrap with `threading.Lock()` or migrate to `cachetools.LRUCache` (already a transitive dep via `requests-cache` if present; otherwise `functools.lru_cache` is enough for a single-process cache).

**C-B7. `_REDIS_CACHE_CLIENT` permanently disables caching after first ping failure.** `app.py:575-576` logs a warning and caches `_REDIS_CACHE_CLIENT = None` for the rest of the process's life. A transient blip takes cache offline for hours.
**Fix:** Periodic health check; reset `_REDIS_CACHE_CLIENT = None` after a failed `ping()` so the next call retries.

#### 1.2 HIGH (backend)

**H-B1. `app.py` is 25,298 lines.** One file holds routes, helpers, workers, rate-limiters, cache, auth, response helpers, and admin blueprint registration. PR review is impossible. **Fix:** No quick fix — extract `/api/cars` into `routes/cars.py`, `/api/bikes` into `routes/bikes.py`, etc. Existing `routes/buying_requests.py` and `routes/ocr.py` are the template.

**H-B2. Admin stats: full-table paginate + Python aggregation.** `_fetch_listing_lifecycle_rows` (`app.py:1151-1185`) calls `_fetch_all_rows` (max 250k rows) for `cars`/`bikes`/`car_parts`/`license_plates` (4 tables), each paginating 1000 rows over HTTP, then bucketing in Python. With 100k+ listings on a single table, this is 100 sequential network calls per admin page load.
**Fix:** Postgres view per table:
```sql
CREATE OR REPLACE VIEW public.cars_lifecycle_status AS
SELECT id,
       CASE WHEN deleted_at IS NOT NULL THEN 'deleted'
            WHEN status = 'sold' OR sold_status IS NOT NULL THEN 'sold'
            WHEN expires_at < now() THEN 'expired'
            WHEN is_archived THEN 'archived'
            WHEN status IN ('approved','active') AND (expires_at IS NULL OR expires_at > now()) THEN 'active'
            WHEN status IN ('pending','pending_auto_review') THEN 'pending'
            ELSE 'draft' END AS state
FROM public.cars;
```
Then `SELECT state, COUNT(*) FROM cars_lifecycle_status GROUP BY state`. 9 rows back, regardless of table size.

**H-B3. N+1 for user listings + images.** `app.py:2689-2697` issues one HTTP call per listing to fetch its images. 20 listings = 21 round-trips.
**Fix:** PostgREST embed: `"select": "*,car_images(*)"` in the original query. One round-trip per listing type.

**H-B4. `order=` not allow-listed.** `app.py:6419, 14582, 16412, 16718` accept `?order=...` and pass to PostgREST. Not SQLi (PostgREST restricts to `select` columns) but lets an attacker sort by `description` (textarea) to force slow sorts.
**Fix:** Allow-list per endpoint: `{"created_at.desc", "expected_selling_price.asc", "expected_selling_price.desc"}`. Reject with 400 otherwise.

**H-B5. [NARROWED] EXIF preserved on uploaded images — JPEG path only, PNG/GIF and dealer docs still exposed.** Confirmed at `app.py:8404-8409`: the JPEG branch (`img.save(output, format="JPEG", quality=85, optimize=True)`) already re-encodes and strips EXIF by default — this matches `SECURITY_AUDIT.md` FP-9, which debunked the original "EXIF preserved" framing for the common iPhone-JPEG case. The original wording of this finding was stale; the real remaining gap is narrower:
- The `else` branch at `app.py:8409` (`img.save(output, format=img.format or "JPEG", quality=85)`) re-saves PNG/GIF/WebP sources in their original format, which does not strip EXIF the way a JPEG re-encode does.
- Dealer document uploads (trade license, TRN, passport scans — `app.py:23996-24004`, `app.py:10014-10140`) are stored byte-for-byte with no re-encode at all (tracked separately as `SECURITY_AUDIT.md` MEDIUM-3).
**Fix:** For the PNG/GIF branch, strip EXIF explicitly (Pillow doesn't drop it automatically outside the JPEG re-encode path) — e.g. `img.info.pop('exif', None)` before save, or copy pixel data into a fresh `Image` object with no `.info`. For dealer docs, run `piexif.remove` on JPG/PNG and `qpdf --remove-metadata` on PDF before storing. Do not re-touch the JPEG branch — it already works.

**H-B6. `_send_listing_status_email` blocks request path.** `app.py:19799`, `routes/admin.py:651-689`. SMTP is synchronous. Admin "approve" POSTs block for the duration of the email.
**Fix:** `threading.Thread(target=_send_email, daemon=True).start()` or move to the existing workers/ queue.

**H-B7. Three manual CORS OPTIONS handlers.** `app.py:6893-6906, 7282-7287, 8798-8803` duplicate `_get_cors_origins()` so they can add credentials. New origin in `CORS_ORIGINS` must be kept in sync across 4 places.
**Fix:** Delete the three manual handlers; let `flask-cors` handle preflight with `supports_credentials=True`.

**H-B8. Unauthenticated `/api/debug/json` echoes request.** `app.py:6338-6352` returns 200 with content-type, content-length, first 200 bytes of body, and `request.json.keys()`. Not catastrophic but fingerprintable.
**Fix:** Gate on `FLASK_ENV != "production"` or delete.

**H-B9. Featured-listings mutations don't invalidate public cache.** `app.py:10811-10945`. Creating or removing a featured listing doesn't invalidate `/api/cars` or `/api/cars/<id>` cache entries.
**Fix:** Add `_invalidate_api_cache_prefixes(["/api/cars", f"/api/cars/{listing_id}"])` on featured mutation.

**H-B10. Buying-requests list cache uses wrong key namespace.** `routes/buying_requests.py:387, 450, 475`. `_invalidate_public_inventory_cache("buying_requests")` is a no-op because `buying_requests` isn't in `_LISTING_COUNT_TABLES`. List cache only invalidates via TTL (60s).
**Fix:** Either drop TTL-only invalidation or flush all `/api/buying-requests` keys on mutation.

**H-B11. `auto_review_worker` mutates `row` in-place.** `workers/auto_review_worker.py:297-299` sets `row["_ar_offending_image_urls"]` on the dict from `fetch_pending_for_type`. On retry, the marker key persists across `process_once` invocations; `_delete_listing_image` may target URLs no longer associated with the listing.
**Fix:** Return `(image_analysis, offending_urls)` as separate values from `build_signals_for`.

#### 1.3 MEDIUM (backend)

- **`buying_requests` create self-approves.** `routes/buying_requests.py:343` writes `status="approved"`. Rely on RLS but the service role bypasses — anyone can flood the public feed. **Fix:** `status="pending"` on create with admin approval, or rate-limit by user ID.
- **OCR endpoint dual-checks file size.** `routes/ocr.py:81-93, 100-106` uses both `request.content_length` (header, spoofable) and `actual_size` (real). Keep only the real check.
- **`_get_cors_origins` not consistent.** Already covered above.
- **JWT secret multi-form decode.** `app.py:3299-3334` tries raw / base64-padded / base64-lenient. Defense-in-depth is fine but pick one canonical form at startup.
- **`/api/cars/<id>/update` accepts OPTIONS but PATCH/PUT advertised inconsistently.** Cosmetic; covered by CORS fix.
- **`featured_listings` admin endpoint** doesn't return warnings when email fails. Return 200 with `{"warning": "approved but email failed"}` instead of 500.
- **`redis = None` fallback silently degrades.** Distinguish "Redis didn't respond" from "Redis said no" — currently both fall through.

---

### 2. Frontend (React)

**File:** `flask-react-supabase-app/frontend/`

#### 2.1 Confirmed CRITICAL

**C-F1. `PostCar.js` is 3,197 lines and has no submit-button disable during OCR/draft-save.** The submit button at `PostCar.js:1831` doesn't check `registrationOcrStatus === 'Scanning…'` or `isDraftSaving`. While OCR runs (5-15s based on staged timers at line 341), the user can hit Submit and double-upload. `handleSaveDraft` (line 1539) and `handleSubmit` (line 1601) both upload `croppedImages` independently — double-upload, double-submit, lost drafts.
**Fix:**
```jsx
const [isSaving, setIsSaving] = useState(null); // 'submit' | 'draft' | null
<button disabled={Boolean(isSaving) || registrationOcrStatus === 'Scanning…'}
        onClick={() => setIsSaving('submit') /* ... */}>
```
And in `handleSaveDraft`, mark uploaded images as `existingImages` immediately so `handleSubmit` cannot re-upload.

**C-F2. `AuthContext.updateUser` writes user to `localStorage` that's overwritten on next mount.** `frontend/src/context/AuthContext.js:428-444`:
```jsx
const updateUser = (updates) => {
  setUser(prev => { const next = { ...prev, ...updates }; localStorage.setItem('user', JSON.stringify(next)); return next; });
};
```
The `useEffect` at line 199 calls `authService.getCurrentUser({forceBackendCheck: true})` on every mount, which overwrites with server state. Result: edit "Saved!" → reload → previous value. The localStorage write is dead code that also misleads future contributors.
**Fix:** Remove the `localStorage.setItem('user', …)` block. Source of truth = JWT-backed `/api/auth/me`. If you want a fast hydrating cache, use `CURRENT_USER_CACHE_KEY` (already exists in `authService.js:81`).

**C-F3. `apiClient.js` 401 retry mutates caller's `options`.** `src/utils/apiClient.js:182-204` sets `options.__retriedAfterRefresh = true`. Callers reuse the same `options` object across renders. Next call from the same caller: `__retriedAfterRefresh === true`, real 401 surfaces as confusing auth error.
**Fix:**
```js
let didRetryAfterRefresh = false;
// or use a WeakSet of already-retried endpoints
```

**C-F4. `axios` interceptors log every auth call + mutate `axios.defaults.headers.common`.** `src/utils/authService.js:113-141`. In dev mode, every Supabase auth URL, method, headers (including `Authorization`), and payload dumps to the browser console. Also: any third-party code doing `axios.post('https://attacker.example/', {})` accidentally sends the user's bearer token cross-origin.
**Fix:** Drop global axios interceptors. Use `apiClient.fetch` for everything. Don't mutate `axios.defaults.headers.common`.

**C-F5. [CORRECTED — false positive, see §2.4] ~~HEIC accept attribute but no HEIC decode.~~** Originally claimed `heic2any` (`package.json:30`) was never imported and HEIC uploads silently fail. **This is wrong.** `heic2any` is dynamically imported in `src/utils/directUpload.js:108` inside `ensureUploadableImage()`, which is wired into `PostCar.js`, `PostBike.js`, `PostCarParts.js`, `PostPlate.js`, `PostBuyingRequest.jsx`, and `AccountSettings.js` — six call sites, not zero. Git history shows this was a deliberate fix (`71a9405e "Harden HEIC listing uploads"`), predating this audit. No action needed; do not remove `.heic` from the accept list. See §2.4 for full evidence.

**C-F6. `apiClient.js` fires unconditional CORS preflight on module load.** `src/utils/apiClient.js:28-54`. `checkAndUpdateBaseUrl()` runs at import time on every page load, even stable network. Worse: on a flaky CORS handshake, the user is stuck with the wrong base URL for the session.
**Fix:** Remove eager invocation; rely on the lazy `try 127.0.0.1 on failure` path.

#### 2.2 HIGH (frontend)

**H-F1. No `React.memo` anywhere across 36k LOC.** Heavy list pages (`CarList`, `ExplorePage`, `MyListings`) re-render every card on every state change.
**Fix:** Wrap `MarketplaceListingCard`, `KpiTile`, `EmptyState`, `TypeBadge`, `StatusBadge` in `React.memo`.

**H-F2. No virtualization on long lists.** `AdminListings`, `ExplorePage`, `CarList`, `MyListings` ship infinite-scroll + hundreds of cards per page.
**Fix:** Use `react-window` or `@tanstack/react-virtual`.

**H-F3. `useEffect` lint disabled in 4 files.** `AuthContext.js:272`, `SavedListingsContext.js:91,210`, `PostCar.js:416`. Future regressions silent.
**Fix:** Convert functions to refs (`syncWithSupabaseRef.current = syncWithSupabase`) or use `useCallback` with correct deps.

**H-F4. `useFeaturedPattern.js` and `useListingCounts.js` use module-level `inflight` singleton with no `try/finally`.** `src/hooks/useFeaturedPattern.js:9,34-45`, `src/hooks/useListingCounts.js:12,38-48`. If the server returns 500, consumers silently fall back to defaults for up to 60s with no operator visibility.
**Fix:** Log on API failure. Add an `error` field to the hook return.

**H-F5. `MarketplaceListingCard` not memoized.** Renders inside long infinite-scroll lists; every visible card re-renders on every parent state change.
**Fix:** `export default React.memo(MarketplaceListingCard)`. Memoize `galleryImages`.

**H-F6. `ExplorePage.jsx` 12+ filter `useState` calls, no memoization.** `src/components/ExplorePage.jsx:528-560`. Each `setState` (e.g. typing in price-min) re-renders the entire page including the infinite-scroll sentinel observer. Sort comparison at line 820 allocates 2 Date objects per pair — 400 Date allocations per sort per render for 200 items.
**Fix:** Combine filter state into one `useReducer`. Memoize sort. Use `Date.parse()` instead of `new Date(...)`.

**H-F7. `AdminListings.js` window-focus listener triggers full refetch.** `src/components/AdminListings.js:266-274`. Admin alt-tabbing → 5 concurrent listing-type fetches every focus, no debounce.
**Fix:** Debounce 1s. Skip if `document.visibilityState !== 'visible'` or last fetch <30s ago.

**H-F8. `ProfileMenu.js` and friends fire `/api/auth/admin-check` + `/api/dealer/me` on every auth change.** `src/components/ProfileMenu.js:51-86`. `useAuth` returns a new `value` object every render; `[user]` dep satisfied on every render.
**Fix:** Use `[user?.id]` instead.

**H-F9. `SavedListingsContext.toggleSavedListing` race.** `src/context/SavedListingsContext.js:134-211`. User double-clicks heart → optimistic update + POST in flight; second click sends DELETE. Both fire for the same key.
**Fix:** Gate function entry on `if (savingKeys[key]) return;`.

**H-F10. `useSwipe.js:33-50` accepts any pointer-down but only finishes on `pointerup`.** `pointerleave` not handled; `active` is a single bool, not per-pointerId set.
**Fix:** Track `active` per pointerId. Listen for `pointerleave`.

**H-F11. `PostCar.js:1700-1775` setTimeout(navigate, 2000) not cancellable.** User clicks the success link or navigates manually before 2s; timer still fires and re-navigates.
**Fix:** Store timer in ref. Clear in cleanup and on unmount.

**H-F12. `Header.js` re-renders on every `location.pathname` change.** Mounted globally, computes 4 "is active" arrays of 22 path checks per render.
**Fix:** Memoize the active-state checks. Split `DesktopHeader`/`MobileHeader` so only one renders at a time.

**H-F13. Admin live-users interval never pauses on hidden tab.** `src/components/AdminDashboard.js:307`.
**Fix:** Use `setInterval` only when `document.visibilityState === 'visible'`.

**H-F14. `MapSection` re-renders on every parent re-render.** `src/components/PostCar.js:998`. Leaflet re-creates layers on marker drag.
**Fix:** `React.memo(MapSectionImpl)` + dynamic import.

#### 2.3 MEDIUM (frontend)

- **Dependency audit correction:** `@react-three/drei`, `@react-three/fiber`, and `three` are imported by the lazy-loaded `HeroBackground.js`; `@tensorflow/tfjs`, `@tensorflow-models/blazeface`, and `nsfwjs` are dynamically imported by `imageModeration.js`. They are not dead and must stay. See `frontend/DEPENDENCIES.md` and §6.5.
- **Duplicate hardcoded root URLs** across `apiClient.js:6`, `authService.js:4`, `useFeaturedPattern.js:3`, etc. Single `src/utils/endpoints.js`.
- **Hardcoded storage keys** (`dph_post_car_draft_v2`, `dph_chunk_reload_attempted`, etc.) scattered across files. Centralize.
- **`AuthContext` value object not memoized.** `src/context/AuthContext.js:418-445`. Every consumer re-renders even when no state changed.
- **No `<React.StrictMode>`** in `index.js`. Would have surfaced several HIGH findings immediately.
- **`PlatformAnalyticsTracker.js` multi-tab race.** sessionStorage `SESSION_STARTED_AT_KEY` shared; two tabs emit `session_start` for the same session.
- **Timezone handling:** 185 sites use `new Date(iso).toLocaleDateString()` with browser locale. Centralize in `src/utils/dateFormat.js`.
- **Accessibility:** `alt=""` everywhere in `BuyingRequestDetail`, `AdminReports`, `AdminDashboard`, `VinRevealAnalyticsModal`, `UnifiedCropper`, `ListingPicker`. Either meaningful alt or `role="presentation"`.
- **`ImageLightbox` traps `onClick={onClose}` on backdrop but no initial focus management.**
- **Several `key={index}` on list items** in `PostCar.js:3086`, `PostCarParts.js:659`, `PostBike.js:763`, `CarDetail.jsx:925`, `BikeDetailRedesigned.jsx:537`. Use stable IDs.
- **`window.innerWidth` in `useState` initializer** in `AdminLayout.js:8-15`. Has SSR guard but `useEffect` at line 19 doesn't. Inconsistent.
- **Unmanaged `setTimeout` / `setInterval`** in `AdminUsers.js:139`, `AdminTools.js:212,232,271`, `AdminDashboard.js:307-330`, `ResetPassword.js:96`. Store in ref + cleanup.
- **`useSwipe.js` doesn't handle keyboard nav** for accessibility.
- **`useListingCounts.js:12` and `useFeaturedPattern.js:9` module-level `inflight`** — consumer unmount mid-fetch can't cancel.

#### 2.4 Confirmed FALSE POSITIVES (debunked with citations)

- **C-F5 "no HEIC decode" is wrong.** `src/utils/directUpload.js:99-120` (`ensureUploadableImage`) dynamically imports `heic2any` at line 108 and converts HEIC→JPEG before upload, with a native-decode fallback and a user-facing error message on failure. Called from `PostCar.js:1316,2027`, `PostBike.js:378,451`, `PostCarParts.js:331`, `PostPlate.js:364,429`, `PostBuyingRequest.jsx:104`, `AccountSettings.js:328` — six live call sites. Confirmed via `git log`: `71a9405e "Harden HEIC listing uploads"`. The `.heic`/`.heif` entries in the `PostCar.js:1857` accept attribute are correct as-is.

---

### 3. Mobile (React Native / Expo)

**File:** `flask-react-supabase-app/mobile/`

#### 3.1 Confirmed CRITICAL

**C-M1. Mobile JWT in plaintext AsyncStorage.** `mobile/src/utils/authService.js:1-36` (`saveAuthData` writes `access_token` + `refresh_token` to `auth_data` AsyncStorage key). `mobile/src/utils/apiClient.js:38` reads it on every request. No `expo-secure-store` anywhere in the repo (`grep SecureStore` → 0 matches in `src/`).
**Fix:**
```bash
npx expo install expo-secure-store
```
Replace AsyncStorage reads/writes of `AUTH_DATA_KEY` with `SecureStore.setItemAsync` / `SecureStore.getItemAsync`. iOS Keychain / Android Keystore are OS-blessed storage for tokens.

**C-M2. `.env` file ships live `EXPO_TOKEN`.** `mobile/.env:6` (Supabase anon JWT, PostHog project key, `EXPO_TOKEN`). `.gitignore` correctly excludes `.env` — verified — but the live `EXPO_TOKEN` lets anyone with the file run `eas-cli` builds on this project.
**Fix:** Move `EXPO_TOKEN` to `~/.zshrc` or 1Password CLI. Add `mobile/.env.example` with public keys + comment placeholders.

**C-M3. Legacy mobile entry files are dead code that survives.** `package.json:4` sets `"main": "expo-router/entry"`; `App.js`, `index.js`, and `src/navigation/AppNavigator.js` are not part of the active entry and duplicate the provider/navigation tree. The six `src/screens/auth/*Screen.js` files are *not* dead: live Expo Router route wrappers in `app/(auth)/*.tsx` (and the profile VerifyPhone route) import them.
**Fix:** Delete only `App.js`, `index.js`, and `src/navigation/AppNavigator.js` after confirming the router-only build. Keep the shared auth screen implementations until their live route wrappers are migrated.

**C-M4. `expo-updates` not installed.** `package.json:15-75`, `app.json`, `eas.json`. Every JS-only hotfix requires a full store rebuild and review. `RELEASE.md` calls this out as deliberately deferred; it's still a CRITICAL operational gap.
**Fix:** `npx expo install expo-updates`. Add `app.json` updates block + `runtimeVersion` policy. Run `eas update:configure`.

#### 3.2 HIGH (mobile)

**H-M1. Profile photo upload no compression + no progress.** `src/screens/profile/SettingsScreen.js:100-137` (`pickImage` → `uploadPhoto`). The picker does crop + quality, but only on the resulting JPEG that the camera/library already produced at full sensor resolution. The file can be 2-6 MB. FormData upload streams in one shot with no progress.
**Fix:** Reuse `compressImage` (or add one for 512×512 profile photos). Show determinate progress via `XMLHttpRequest.upload.onprogress`.

**H-M2. EXIF GPS preserved on listing photos.** `src/utils/imageCompressor.js:1-14` uses `expo-image-manipulator.manipulateAsync(uri, [{ resize: { width: 1920 } }], ...)` which strips EXIF orientation but not GPS coordinates. Seller's home lat/long leaks into every listing.
**Fix:** Add a `stripExif(uri)` step in `compressImage` (Skia pass: re-render through a new `Skia.Surface` and `encodeToBase64` drops metadata).

**H-M3. Listing cache not persisted.** `src/utils/listingCache.js:14-56`. `prefetchListing` writes to in-memory Map (40-entry FIFO), never persisted. Cold-start push-open skips straight to skeleton → fetch → render.
**Fix:** Persist the cache to AsyncStorage (or `swrCache`) for the most recent N items. `getCachedListing` already exists; add a hydrate-on-boot pass in `app/_layout.tsx`.

**H-M4. `bike`/`car`/`plate`/`part` deep links route to `/Login` and `/(auth)/VerifyPhone` from `CarDetailScreen.js`.** Legacy screen uses `navigation.navigate('Login')` (line 133) and `navigation.navigate('VerifyPhone')` (line 192) — but under Expo Router (active entry) those routes are file-based. Mixing the two navigators causes layout inconsistency and broken back-stacks.
**Fix:** Single source of truth = Expo Router. Delete the legacy navigator tree.

**H-M5. `useEffect` deps don't match body usage in `PostListingScreen.js`.** Several `useEffect` blocks use exhaustive-deps-unfriendly shapes. Stale closures can clear `car_model` if manufacturer changes after model pick.
**Fix:** Run `npx expo lint` and fix warnings.

**H-M6. `CarDetailScreen.js:101-168` initial paint flickers between cached and fetched detail.** `initialCar` merge with fetched data shifts `activeImageIndex`/`previewImage`/`previewImageIndex` implicitly.
**Fix:** Track `lastListingId`; reset gallery state when it changes.

#### 3.3 MEDIUM (mobile)

- **Both React Navigation 7 and Expo Router in `package.json`** — drop RN Nav deps once `App.js` is deleted.
- **`useStaggeredEntrance` re-runs on every pull-to-refresh.** Re-mount replays the entrance animation.
- **Notification cold-start deep-link race.** `src/utils/pushNotifications.js:152-156` — `setTimeout(handle, 400)` is a magic number; on slow devices the deep link fires before the router mounts.
- **`MyListingsScreen.js:104-106` refetches on `[activeTab]` but NOT on focus.** Stale data after editing a listing.
- **`formData` body construction hand-rolled in 3 places** with different field names.
- **`imageModeration` fails open** — on-device NSFW check is not a security gate; the server is the source of truth. Document this clearly.
- **`src/utils/carData.js` is 77 KB in bundle**, parsed at import time.
- **HEIC files uploaded as `image/jpeg`** despite actual HEIC contents.

---

### 4. Security & Secrets

#### 4.1 Confirmed HIGH

**S1. Mobile JWT in plaintext AsyncStorage** — covered as C-M1 above.

**S2. Rate limiter fails open when Redis is down.** `app.py:248-261` returns `None` from `_redis_fixed_window_rate_limited` on Redis errors; the caller falls through to memory, but the memory path is itself not thread-safe (C-B1). OTP brute force is the realistic exploit.

**S3. Dealer webhook SSRF.** `routes/dealer/webhooks.py:79-91` accepts customer-supplied URLs unconstrained. Attacker can register a webhook with `url=https://<railway-internal>` or `http://169.254.169.254/` (cloud metadata). Server fires the request.
**Fix:** Parse URL, reject private IP ranges (`ipaddress.ip_address(host).is_private or is_loopback or is_link_local`) and known metadata IPs before persisting.

#### 4.2 Confirmed MEDIUM

- **Untracked credential files at repo root.** `client_secret_870408604657-agunlejm83kiajp6pr4qn847osuqdn0c.apps.googleusercontent.com.json` and `fit-asset-465619-h0-e41af9d3dabd.json`. `git status` reports nothing (clean) because `.gitignore` masks them, but the files contain real OAuth + GCP service-account credentials. Confirm they're not in any history and add to `.gitignore` explicitly + rotate.
- **Raw `X-Forwarded-For` without `ProxyFix`.** Covered as part of C-B2.
- **Dealer doc uploads preserve EXIF.** Covered as H-M2.
- **`_service_all` RLS policies not JWT-role-bound.** See RLS section 5 below.
- **30-day refresh-token cookie** (`app.py:140` area). Long lifetime on a stolen device.

#### 4.3 LOW

- **Username enumeration** on signup. The 400 response differs based on whether the username is taken vs. invalid.
- **PostHog autocapture** sends every click to PostHog. UX analytics is fine; consider disabling autocapture for sensitive screens.
- **CSP `'unsafe-inline'`** for scripts.
- **`FLASK_SECRET_KEY` falls back to a per-process ephemeral default** if env var missing.

#### 4.4 Confirmed FALSE POSITIVES (debunked with citations)

- **No `dangerouslySetInnerHTML`/`eval`/`subprocess`/`verify=False`** in app code.
- **`_resolve_listing_table` is enum-safe.** No SQL injection via dynamic table names.
- **JWT verify options are sound.** `_decode_supabase_jwt_secret` accepts the multi-form Supabase secret correctly.
- **No SQL injection** via supabase-py `.eq()` / `.or_()` chains in user input paths.
- **HTML email bodies are `xml_escape`'d.**

---

### 5. Supabase schema / RLS / migrations

**Files:** `flask-react-supabase-app/backend/migrations/`, `supabase/migrations/`, top-level `*.sql` files.

#### 5.1 Confirmed CRITICAL

**S-DB1. RLS `USING (true) WITH CHECK (true)` with no `TO service_role` qualifier on dealer tables.** Confirmed at:
- `backend/migrations/2026_06_03_dealer_rls.sql:19, 26, 33, 40, 47` (`dealerships_service_all`, `members_service_all`, `invites_service_all`, `kpi_daily_service_all`, `market_service_all`)
- `backend/migrations/2026_06_05_dealer_leads.sql:75-77, 89-91` (`dealer_leads_service_all`, `dealer_lead_events_service_all`)
- `backend/migrations/2026_06_05_dealer_webhooks.sql:54-56, 62-64` (`dealer_webhooks_service_all`, `dealer_webhook_deliveries_service_all`)
- `backend/migrations/2026_06_05_dealer_inventory.sql:91-92, 103-104, 114-115` (`dealer_inv_jobs_service_all`, `dealer_inv_row_errors_service_all`, `dealer_api_sources_service_all`)
- `backend/migrations/2026_06_08_dealer_info_requests.sql:57-63` (`svc_dealer_info_requests`, `svc_dealer_info_request_uploads`)
- `backend/migrations/COMPLETE_SCHEMA_FIX.sql:387, 391, 398, 400, 406, 408, 414, 416, 419, 420` — 10 policies on `cars`, `car_images`, `bikes`, `bike_images`, `car_parts`, `part_images`, `license_plates`, `plate_images`, `lead_events`, `listing_deletion_events`

Any authenticated (or anonymous) user can read every dealer's webhook URL + `secret_enc`, every API source's `credentials_enc`, every dealer's leads (with `contact_phone`/`fingerprint`), and every `dealer_info_requests.token`.

**Fix:**
```sql
DO $$
DECLARE p pg_policies%ROWTYPE;
BEGIN
  FOR p IN
    SELECT * FROM pg_policies
    WHERE schemaname='public'
      AND cmd = 'ALL'
      AND qual::text = '(true)'
      AND check_clause::text = '(true)'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      p.policyname, p.tablename
    );
  END LOOP;
END $$;
```

**S-DB2. Conflicting `is_admin()` / `is_admin(uuid)` definitions.**
- `backend/migrations/create_users_table.sql:36` — `is_admin(user_id UUID)`
- `backend/migrations/fix_security_issues.sql:279` — `is_admin()` no-arg, uses `auth.uid()`
- `backend/migrations/fix_security_issues_FINAL.sql:104` — `is_admin(user_id UUID)` again

Policies in `fix_performance_issues.sql:25,31,81,102,124,141` call `public.is_admin()` (no-arg). Policies in `tighten_rls_after_jwt_forwarding.sql:67,87,93` call `public.is_admin((SELECT auth.uid()))` (one-arg). Whichever ran last wins; the other set raises `function does not exist` on every authenticated admin query.
**Fix:** `CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean ...` (no-arg, canonical). Update every policy to call `is_admin()`. Drop `_FINAL`/`_v2` re-definitions.

#### 5.2 HIGH (database)

**S-DB3. `dealership_application_status` CHECK constraint mutates between migrations.**
- `add_dealer_kyc_columns.sql:17-29` — 4-value allowlist (`'draft','submitted','approved','rejected'`)
- `backend/migrations/2026_08_13_dealer_verification_lifecycle.sql:10-15` — 7-value allowlist (adds `'ready_to_submit','under_review','action_required'`)

If only the first migration ran (or only the first re-applied), any dealer setting `dealer_application_status='under_review'` (the actual lifecycle the backend uses) is rejected with `23514`.

**S-DB4. Listing lifecycle stats full-table paginate.** `_fetch_listing_lifecycle_rows` (`app.py:1151-1185`) paginates 1000 rows × 4 tables per admin page load. 250k row cap. Aborts silently at 250k.
**Fix:** Postgres view per listing table; `GROUP BY state` returns 5-9 rows.

**S-DB5. Public browse indexes don't match filter shape.** `supabase/migrations/20260703000004_composite_indexes.sql:6-8`:
```sql
CREATE INDEX idx_cars_status_created (status, created_at DESC) WHERE deleted_at IS NULL;
```
Query at `app.py:2397-2399, 6427-6428` filters `status='approved' AND is_approved=true`. Planner uses the index, narrows on `status`, then filters `is_approved=true` post-index. With legacy rows where `status='approved' AND is_approved=false` (pending auto-review), the filter is non-selective.
**Fix:**
```sql
CREATE INDEX idx_cars_active_created ON public.cars (status, created_at DESC)
  WHERE deleted_at IS NULL AND is_approved = true;
-- (and same for bikes/car_parts/license_plates)
```

**S-DB6. `cars.car_model` `ilike` with no anchor → sequential scan.** `services/dealer_market.py:69`: `"car_model": f"ilike.{model}"`. `%foo%` cannot use a btree.
**Fix:** Either anchor left (`f"ilike.{model}%"`) and add `text_pattern_ops` index, OR add a GIN trigram: `CREATE EXTENSION pg_trgm; CREATE INDEX idx_cars_model_trgm ON public.cars USING GIN (car_model gin_trgm_ops);`.

#### 5.3 MEDIUM (database)

- **`auto_review_decisions` + `listing_verification_scans` + `moderation_*` use `FORCE ROW LEVEL SECURITY` with zero policies.** `backend/migrations/add_auto_review_decisions.sql:20`, `add_listing_verification_scans.sql:25`, `20260812000001_moderation_learning_foundation.sql:60-64`. Works only because `service_role` retains `BYPASSRLS`. Fragile; document or add `TO service_role` policies.
- **`user_ratings` SELECT policy is `USING (true)`.** `backend/migrations/add_ecosystem_tables.sql:149-152`. Anyone reads all reviews.
- **`lead_events` and `listing_deletion_events` `GRANT SELECT` widened to authenticated** — relies on RLS alone to restrict; if the policy is dropped, any authenticated user reads every lead IP and user-agent.
- **`car_images` has no `public.` qualifier** in `cars_schema.sql:48` for the FK to `cars`. Search-path dependency.
- **`license_plates.price NUMERIC(10,2)` limit** — 8 digits before decimal. AED luxury plate prices overflow.
- **`cars.user_id` is nullable and no FK.** Legacy from Reddit import; constrain `WHERE user_id IS NOT NULL OR source_platform IS NOT NULL`.
- **Duplicate migration files:** `fix_performance_issues.sql` + `_FINAL` + `_v2`, `fix_security_issues.sql` + `_FINAL` + `_v2`, `_COMPLETE_SCHEMA.sql` + `_COMPLETE_SCHEMA_FIX.sql` + `_COMPLETE_DATABASE_FIX.sql` + `manual_migration.sql` — all redefine the same objects with different shapes. Move superseded files to `archive/`.

---

## Sequencing recommendation

**Sprint 1 (this week):**
1. **NEW-6 — rotate live secrets in `backend/.env`** (urgent: this is live production credential exposure). C-B1 (rate-limit lock), C-B2 (rate-limit bypass), C-B3 (admin decorator), C-B4 / C-B5 (worker races), C-F1 (PostCar double-submit), C-F2 (AuthContext dead localStorage), C-M1 (mobile SecureStore).

**Sprint 2:**
2. **NEW-5** (OCR/Vision auth fail-closed), **NEW-4** (Dockerfile `USER`), **NEW-1** (drop JWT fragments from logs), **NEW-10** (`buying_requests.py` rate limit), **NEW-2** (IDOR in `diagnostic.py` + `market.py`), **NEW-3** (`users` UPDATE `WITH CHECK`), S-DB1 (RLS `TO service_role`), S-DB2 (`is_admin()` canonical), S-DB3 (CHECK constraint), H-B2 (lifecycle stats view), S-DB5/S-DB6 (indexing), H-B3 (N+1 fix), H-M2 (EXIF strip), C-M3 (delete dead `App.js`/navigator).

**Sprint 3:**
3. **NEW-7** (`auto_review_worker` SSRF), **NEW-8** (`defusedxml` for `dealer_inventory.py`), **NEW-9** (supabaseClient.js JWT), **NEW-11** (`apply_migration.py` path guard), **Scenario 2.SSRF-2** (api-sources SSRF), **Scenario 3.b** (audit GETs), **Scenario 4.detail** (trust tier reputation), C-M4 (expo-updates), ~~C-F5 (HEIC decode)~~ **[dropped — false positive, see §2.4]**, H-F1/F2 (memo + virtualization), H-B7 (CORS dedup), S3 (webhook SSRF), C-F4 (drop axios interceptors).

**Quarter:**
4. H-B1 (split `app.py`), C-F1 (split `PostCar.js`), H-F4 + H-F5 (memoization pass). Also: optimisations from PDF Part 1 — virtualize Explore, remove 16.5 MB `bottom-landing.jpg`, dedupe hero/toplanding, add `prefers-reduced-motion`, lift homepage to use `/api/homepage/preview`, fix fetchCache.js ExplorePage TTL bug, fix `Header.js` passive scroll listener.

---

## Part 6 — Consolidated Findings from `dphdocthing.pdf`

The third-party PDF (`dphdocthing.pdf`, 24 pages) is divided into three parts. Three subagents cross-validated every numbered item against the codebase. **Items new to this audit are flagged as [NEW].** Items already in the original audit are cross-referenced. Items proven false by file:line evidence are flagged as [FALSE POSITIVE] with citation.

### 6.1 Part 1 — Performance Audit (items 1-44)

**Reconciled item-20/indexing contradiction.** The PDF's green “DB indexing is
already fairly good” ranking is a broad baseline assessment, not a finding that
every access pattern is indexed correctly. The code-level audit is more specific:
the public browse indexes omit the `is_approved` predicate and the dealer model
search uses an unanchored `ILIKE`. Therefore S-DB5 and S-DB6 remain valid targeted
indexing actions even though the PDF's general ranking is favorable.

**Verified items confirmed in code:**

| Item | Verified | Evidence |
|------|----------|----------|
| 1: Explore not virtualized | YES | `ExplorePage.jsx:1382` `displayedItems.map(...)` unbounded; no `react-virtuoso`/`@tanstack/react-virtual` in deps |
| 2: Full-data recalc on state change | YES | `ExplorePage.jsx:760-774` (normalize), `:779-784` (combine), `:829-841` (sort) |
| 3: Reddit batches too large | **YES [NEW detail]** | `ExplorePage.jsx:619` `limit=250`; up to 1000 records per page load |
| 5: 16.5 MB homepage image | YES (path correction) | `frontend/public/images/bottom-landing.jpg` (not `public/`); 16,496,521 B; 4000×6000 portrait |
| 6: Duplicate hero/toplanding | YES | Both = SHA-256 `3def416c...`; 2,101,674 B each |
| 7-8: Other 5 large images | YES | IMG_3391.JPG 6.4 MB, About-page.JPG 5.8 MB, Our Mission.jpg 4.3 MB, hero.webp 2.1 MB, toplanding.webp 2.1 MB |
| 9: Three.js HeroBackground | YES (caveat) | `HeroBackground.js:2-3` imports `@react-three/fiber` + `@react-three/drei`, 3 `useFrame` loops; already lazy-loaded via `HomePage.js:20` (PDF missed this) |
| 11: Header scroll handler | YES | `Header.js:82-88`; **not `{passive:true}`** [NEW detail] |
| 12-13: backdrop-filter expensive | YES | 35 `backdrop-filter` declarations across `App.css`, `index.css`, etc. |
| 14: MarketplaceListingCard not memoized | YES | `MarketplaceListingCard.jsx:190` plain export |
| 17: Synchronous sessionStorage | YES | `fetchCache.js:9, 23, 64`; `JSON.stringify` comparison on full payloads |
| 18: `Cache-Control: no-store` on cached responses | **YES [NEW]** | `app.py:717-721`; 28+ call sites |
| 21: 24k-line monolith | YES | `app.py` = 25,298 lines, 1,006,455 B |
| 22-23: API responses too large / full gallery on every card | YES | No DTO layer; full `car_images` array returned |
| 24: `/api/homepage/preview` dead code | **YES [NEW]** | `app.py:2477` exists; homepage calls `/api/cars?limit=8` (`HomePage.js:195`) |
| 25: Busy global App.js tree | YES | `App.js:259-267, 270, 394` — all 10 named providers mounted globally |
| 27: PlatformAnalyticsTracker heavy | YES | `PlatformAnalyticsTracker.js:252` `addEventListener('click', ..., true)` capture; `:183` `closest()`; `:190` `innerText \|\| textContent` |
| 28-29: Mobile explore data processing + animations | YES | `mobile/src/screens/explore/ExploreScreen.js` — FlashList good, but `useStaggeredEntrance()` re-runs on every card mount |
| 31: FlashList estimatedItemSize inconsistency | **YES [NEW]** | ExploreScreen:294/260, CarList:210/280, BikeList:210/260, PartList:210/260 — inconsistent across screens |
| 34: No `content-visibility` | YES | 0 occurrences in `frontend/src` CSS |
| 36: No `prefers-reduced-motion` | **YES [NEW detail]** | 0 hits across all `frontend/src` CSS despite Three.js + marquee + card transitions |

**Items that are correct claims but the remediation is already partially done:**
- 19 (logging noisy): only 4 cache-log sites in 25k lines — overstated.
- 26 (defer analytics): Vercel Analytics + Speed Insights already lazy/deferred (`App.js:237-256`). Only GA + Clarity init eagerly.
- 32 (lazy loading): `MarketplaceListingCard.jsx:114-115, 128-129` already has `loading="lazy" decoding="async"`. Missing only hero `fetchPriority="high"`.
- 42 (compression): Flask-Compress + Brotli already configured (`app.py:4262-4275`).
- 43 (upload compression): already at `app.py:8405` (q85) and `:8441` (q88).
- 44 (heavy deps dynamic): TF/NSFW already dynamically imported (`imageModeration.js:25-29`).

**PDF false positives / corrections:**

| Item | PDF claim | Reality |
|------|-----------|---------|
| 5 | `frontend/public/bottom-landing.jpg` | Actually `frontend/public/images/bottom-landing.jpg` |
| 5, 7, 8 | Dimensions rotated | All 6 assets are portrait, not landscape. Sizes and identities correct. |
| 9 | Three.js scene is heavy | Already lazy-loaded; the only real issue is no viewport/visibility pause |
| 31 | estimatedItemSize missing | Already set and column-aware on every FlashList; issue is cross-screen inconsistency, not absence |
| 39 | `swrCache.js` and `BlinkBlur.{jsx,css}` are orphaned | **swrCache.js is LIVE** — imported at `AdminDashboard.js:30`. BlinkBlur is self-importing. Verify before deleting. |

**The original AUDIT_REPORT item H-F2 ("no virtualization") is correct and consistent with PDF item 1.**

**[NEW] Items from PDF that were not in the original audit:**
- Item 3 specifically: Reddit `limit=250` × 4 = ~1000 records per page load.
- Item 18 specifically: `Cache-Control: no-store` on all cached API responses.
- Item 24 specifically: `/api/homepage/preview` exists but homepage ignores it.
- Item 31 specifically: cross-screen `estimatedItemSize` inconsistency.
- Item 36 specifically: zero `prefers-reduced-motion` in any CSS file.
- [BUG, NEW] `fetchCache.js:54` destructures `{ttlMs, signal, onUpdate}` but ExplorePage passes `ttl` instead; `ttlMs` always defaults to 5 min, intended 30 s TTL never applies, `onUpdate`/stale-while-revalidate branch is dead.

### 6.2 Part 2 — Threat Model (5 scenarios + architectural fragility)

**Scenario 1 — Cross-dealership data access via context manipulation.**

PDF correctly identifies that `dealer_required` resolves dealership from membership lookup and admin `?as=` is gated. PDF missed that the actual cross-tenant read surface is:

**[NEW] Scenario 1.IDOR — Listing-fetch in `diagnostic.py` and `market.py` is unscoped.**

- `backend/routes/dealer/diagnostic.py:37-42` fetches the listing with `id=eq.{listing_id}` only — NO `dealership_id` filter.
- `backend/routes/dealer/market.py:30-40` same shape.
- `compute_snapshot(..., g.dealer_ctx["dealership_id"])` at `:60` only filters the comp-set selection, NOT the listing access.
- Combined with `?as=` for admins, any dealer (or any admin-acting-as) can read the comp snapshot of any listing on the platform.
- Leaks `comp_count`, `median_price`, `p25_price`, `p75_price`, `percentile_rank` (`diagnostic.py:86-90`) — competitive intelligence.

**Fix:**
```python
params={
    "select": "*",
    "id": f"eq.{listing_id}",
    "dealership_id": f"eq.{g.dealer_ctx['dealership_id']}",
    "limit": 1,
}
```
Return 404 if no row matches.

**Scenario 2 — Outbound SSRF via dealer-registered webhook URLs.** Already covered as S3 in original audit. PDF missed a parallel SSRF surface:

**[NEW] Scenario 2.SSRF-2 — `dealer_api_sources` endpoint URL SSRF.**

- `backend/routes/dealer/api_sources.py:131-198` accepts dealer-supplied `endpoint_url`.
- Tested at `api_sources.py:341` (`test_source` route): `requests.get(endpoint_url, headers=headers, timeout=15)`.
- Polled continuously by `workers/dealer_api_source_poller.py:99-126` every `_MIN_POLL_INTERVAL` minutes.
- An attacker dealer can register `endpoint_url=http://169.254.169.254/latest/meta-data/iam/security-credentials/...` and the worker fetches it every 5 minutes, exfiltrating IAM credentials.

**Fix:** Lift the existing webhook SSRF mitigation into `services/url_safety.py::assert_safe_outbound(url)` and apply to ALL four outbound surfaces: webhook create, webhook test-send, webhook delivery, api-sources create, api-sources test, api-sources poller.

**Scenario 3 — JWT not invalidated on membership or credential change.** Accurate. Already partially covered by C-B3 (admin decorator gap). **NEW finding:**

**[NEW] Scenario 3.b — `dealer_admin_audit` skips GET requests.**

- `backend/routes/dealer/_decorators.py:150-163` `_audit_write` only fires for `POST/PUT/PATCH/DELETE`.
- Admin-acting-as (`?as=`) reading competitor data through `diagnostic.py` leaves ZERO audit trail.

**Fix:** Audit all 2xx responses for `actor_kind='admin'` (or every GET request on `dealer_*` paths).

**Scenario 4 — Auto-review trust manipulation.** Accurate AND underestimated by the PDF:

**[NEW] Scenario 4.detail — Trust tier is reachable with no positive history.**

- `backend/services/auto_review/trust.py:23-30` defines `verified_user` tier requiring only `email_verified AND phone_verified`.
- Every OTP-confirmed user qualifies. Zero minimum history, zero rejection-rate limit.
- `backend/workers/auto_review_worker.py:262-264` hardcodes `rejections_last_90d = 0`, `reports_last_90d = 0`, `approved_listings_count = 0` despite the `TrustContext` dataclass defining them.
- The reputation counters are unused dead fields wired through the data model.

**Fix:** Either wire the counters up (requires data already in `auto_review_decisions` and `lead_events`), OR add `approved_listings_count >= 3` AND `rejections_last_90d < N` to qualify.

**Scenario 5 — GitHub bridge content injection.** Accurate. PDF misses two existing soft-mitigations (URL allowlist to `api.github.com/repos/`, `cycle_id` Redis idempotency) AND understates one:

**[NEW] Scenario 5.detail — `content_hash` is dead code.**

- `workers/reddit_roundup_bridge_worker.py:82-84` writes SHA256 of stable fields into `payload.content_hash`.
- `devvit/dph-bot/src/server/server.ts:73-80` checks `content_hash exists` but never re-computes and verifies it.
- An attacker who replaces the file can also recompute and replace the hash.

**Fix:** Replace `content_hash` with HMAC-SHA256 signature; Devvit verifies `crypto.timingSafeEqual(compute, expected)`.

**Architectural Fragility — service-role bypasses RLS.** Already covered as S-DB1 in original audit. PDF mitigation (`TO service_role` rewrite) is correct.

### 6.3 Part 3 — Vulnerability Ledger (~40 items)

**Addendum from the remediation pass (2026-08-29).** The following items were
identified after the original consolidation and are tracked in
`audit_fixes.md`: Starlette is an explicit transitive FastAPI dependency and
must be pinned and checked separately; `opencv-contrib-python` requires its
own advisory check; dealer-member revocation must invalidate Supabase sessions;
and the nine proposed dead frontend files require reference verification before
deletion. Additional reviewed paths include Reddit import ownership, OCR upload
and rasterization limits, API-source polling, webhook response buffering and
claim recovery, dealer analytics volume, admin error disclosure, frontend
third-party listing handling, and VIN reveal authorization.

**REAL findings [NOT in original audit]:**

| ID | Finding | File:line | Fix |
|----|---------|-----------|-----|
| **NEW-1** | **JWT fragments logged in `flask.log`** | `app.py:3366, 3400, 3404, 3437, 3457, 3461` — `token_preview = token[:20] + "..."` | Drop from logs; replace with correlation UUID |
| **NEW-2** | **IDOR in `routes/dealer/diagnostic.py` and `market.py`** | `diagnostic.py:37-42`, `market.py:30-40` — no `dealership_id` filter | Add filter or 404 |
| **NEW-3** | **Field-level auth gap: `users` UPDATE policy no `WITH CHECK`** | `apply_rls_policies.sql:26-27` | Add `WITH CHECK` excluding `is_admin`, `is_super_admin`; revoke UPDATE on those columns for `authenticated` |
| **NEW-4** | **Docker containers run as root** | `backend/Dockerfile`, `flask-react-supabase-app/ocr-service/Dockerfile`, `flask-react-supabase-app/vision-service/Dockerfile` — no `USER` directive (**path correction:** `ocr-service/` and `vision-service/` are siblings of `backend/` under `flask-react-supabase-app/`, not nested inside it) | Add `RUN useradd -m appuser && USER appuser` |
| **NEW-5** | **OCR/Vision service auth bypass when key unset** | `flask-react-supabase-app/ocr-service/app.py:30, 123`; `flask-react-supabase-app/vision-service/app.py:21, 134` — `if OCR_SERVICE_KEY and x != KEY` is fail-open (**path correction:** same sibling-directory note as NEW-4) | Fail-closed: `if not OCR_SERVICE_KEY: raise RuntimeError(...)` at startup |
| **NEW-6** | **Live secrets in `backend/.env` and previously in git history** | `backend/.env:1-103` — 15+ live creds (JWT secret, service role, RESEND, INFOBIP, Turnstile, Cloudflare, Reddit refresh, Expo PAT, GA4 service-account private key `53-65`, admin password) | **Rotate all immediately.** Purge from history via `git filter-repo`. Verify pre-`12661f2d` commits are not in deployed Docker layers. |
| **NEW-7** | **SSRF in `auto_review_worker` image fetcher** | `workers/auto_review_worker.py:184-194` — `requests.get(url, timeout=8)` with no `Content-Length` cap, no SSRF guard | Wrap in shared `assert_safe_outbound(url)`; cap to 25 MB; reject non-`https://` |
| **NEW-8** | **XML parser XXE risk in `dealer_inventory.py`** | `services/dealer_inventory.py:8, 38` — `xml.etree.ElementTree.fromstring` | Replace with `defusedxml.ElementTree.fromstring` |
| **NEW-9** | **`supabaseClient.js` JWT in `localStorage`** | `frontend/src/utils/supabaseClient.js:23-32, 122-127, 143-155` — front-end mirror of C-M1 mobile finding | Same fix: `httpOnly` cookie via backend, or `sessionStorage` + clear on tab close |
| **NEW-10** | **`routes/buying_requests.py` POST has no rate-limit** | `routes/buying_requests.py:281-395` — public POST endpoint, no `@limiter.limit()` | Add `@limiter.limit("10/minute")`; tighten than the global if spam observed |
| **NEW-11** | **`apply_migration.py` opens arbitrary file paths** | `backend/apply_migration.py:5-28` — `open(migration_file, 'r')` no validation | Constrain to `backend/migrations/` and `supabase/migrations/`; reject `..` |

**REAL findings [ALREADY in original audit]:** S-DB1 (RLS USING(true)), S-DB2 (is_admin conflict), H-B11 (auto_review row mutation), S3 (webhook SSRF), C-M1 (mobile JWT), C-B4 / C-B5 (worker races), C-F4 (axios interceptors), C-B3 (admin decorator).

**[FALSE POSITIVES] — PDF overstated or wrong:**

| PDF claim | Reality |
|-----------|---------|
| **CSP header not set** | `app.py:5227` `response.headers.setdefault("Content-Security-Policy", _build_content_security_policy())` — every response gets CSP. |
| **matplotlib code-injection claim** | `requirements.txt:11` `matplotlib==3.10.0`; used at `app.py:18064`. The PDF's claim was about attacker-controlled code injection, not that matplotlib was absent. The repository evidence does not reproduce that exploit path for the pinned version and usage, so the finding remains unconfirmed rather than being relabeled as an absence claim. |
| **eas.json has exposed secret** | `mobile/eas.json:29` `ascApiKeyPath` references a filesystem path; no inline secret. |
| **verify_complete_fix.py overwrites real listing** | `verify_complete_fix.py:113-119` targets `id=eq.00000000-0000-0000-0000-000000000000` (all-zeros UUID). Cannot match any row. |
| **Path traversal in `directUpload.js` / `PostPlate.js`** | Both sanitize filename via `[a-zA-Z0-9_-]` regex; backend constructs object paths. No user-input in `path.join`. |
| **Destructive user deletion without durable audit** | `routes/admin.py:1484-1494` calls `_log_admin_action(action="user_delete", ...)` — audit IS persisted. |
| **Slow-drip webhook starves cross-tenant delivery** | `webhook_delivery_worker.py:20-21`: bounded `BACKOFF_SECONDS = [60, 300, 1500, 7200, 43200]` + `MAX_ATTEMPTS = 5` → `dead_letter`. PDF wrong. |
| **Dangerous `assert` in `expo_push.py`** | All asserts inside `if __name__ == "__main__":` smoke-test block, stripped by `python -O`. |
| **`test_dealer_secrets_service.py` exposed secret** | `test_dealer_secrets_service.py:5` `FAKE_KEY` is random test data; real `DEALER_INTEGRATIONS_KEY` is in `backend/.env:68`. |
| **SSRF in `ExplorePage.jsx`** | Only env-controlled `API_URL`; no user-controlled outbound URLs. |
| **`PHONE_VERIFICATION_FIXES.md` / `TOKEN_VALIDATION_FIX.md` / `ENHANCED_PROFILE_SETUP.md` / `IMPLEMENTATION_FIXES.md` secrets** | First one is in `non-essential/`. Other three not in actively-tracked repo. |
| **`ledger.jsonl` secret** | File does not exist in repo. |
| **torch SSRF** | `torch==2.6.0` does no HTTP. PDF conflates dep with usage. |
| **Incomplete Data Deletion in `admin.py`** | See durable audit debunk above. |

**[DEPRECATED CVE / version-patched] — pinned deps already cover:**

| Dep | CVE | Pinned version |
|-----|-----|----------------|
| opencv-python | GHSA-7g3p-89gj-jh5w | `opencv-python-headless==4.11.0.86` (≥4.10 patched) |
| gunicorn | CVE-2024-1135 | `gunicorn==23.0.0` (≥22.0.0 patched) |
| pillow | CVE-2024-28219 | `pillow==11.1.0` (latest) |
| cryptography | multiple | `cryptography>=43,<46` |
| werkzeug | multiple | `werkzeug==3.1.3` |
| requests | CVE-2024-35195 | `requests==2.32.3` (≥2.32.0 patched) |
| python-multipart | CVE-2024-21503 | `python-multipart==0.0.20` (≥0.0.7 patched) |
| brace-expansion | CVE-2024-4068 | transitive ≥1.1.12 |
| nanoid | CVE-2024-55565 | transitive ≥3.3.8 |
| browserslist / immer / follow-redirects / undici / yargs / js-yaml / @xmldom/xmldom | various | transitive modern versions patched; not directly exploitable |

@xmldom/xmldom is not even a top-level dep in `frontend/package.json`.

@xmldom/xmldom — confirmed not present at top level. axios CVE-2024-39338 (`axios@^1.6.2` allows 1.6.2-1.x; CVEs fixed at 1.7.4+) needs a lockfile check.

### 6.4 Updated TL;DR additions

These items below were NOT in the original top-20 list. Adding them, re-ranked with the original items, gives the full delivery list:

21. **Live secrets in `backend/.env:1-103`** — 15+ credentials (JWT secret, service role, RESEND, INFOBIP, Turnstile, Cloudflare API token, Expo PAT, GA4 service-account private key including admin password). **Prioritize rotation + history purge.**
22. **IDOR in `routes/dealer/diagnostic.py:37-42` and `market.py:30-40`** — no `dealership_id` filter on listing fetch.
23. **`users` UPDATE RLS policy has no `WITH CHECK`** — `apply_rls_policies.sql:26-27`. A user can PATCH their own row to set `is_admin=true`.
24. **Docker containers run as root** — no `USER` directive in any of 3 Dockerfiles.
25. **OCR/Vision service auth bypass when `OCR_SERVICE_KEY` empty** — `flask-react-supabase-app/ocr-service/app.py:123`, `flask-react-supabase-app/vision-service/app.py:134`. Fail-open pattern.
26. **JWT fragments in `flask.log`** — `app.py:3366, 3400, 3404, 3437, 3457, 3461`.
27. **`auto_review_worker` SSRF** — fetches arbitrary user-supplied URLs with no guard.
28. **`dealer_inventory.py` uses raw `xml.etree.ElementTree`** — replace with `defusedxml`.
29. **`supabaseClient.js` JWT in `localStorage`** — frontend mirror of C-M1.
30. **`buying_requests.py` POST has no rate-limit.**

Other noteworthy performance/hygiene items:
- 16.5 MB `bottom-landing.jpg` + 5 other oversized marketing images in `public/images/`.
- `Cache-Control: no-store` on all cached API responses (`app.py:721`, 28+ call sites).
- `/api/homepage/preview` exists but homepage ignores it.
- 0 `prefers-reduced-motion` blocks anywhere in `frontend/src` CSS.
- Cross-screen `estimatedItemSize` inconsistency on mobile (`294/260`, `210/280`, `210/260`).
- `fetchCache.js` ExplorePage passes `ttl` but destructures `ttlMs`; intended 30 s TTL never applies.
- `Header.js:87` scroll listener missing `{passive: true}`.

### 6.5 PDF contradictions with the original audit

| Item | PDF says | Original audit says | Reality |
|------|---------|---------------------|---------|
| `@react-three/drei`, `@react-three/fiber`, `three` are "dead deps, verified 0 importers, drop them" | They're used by `HeroBackground.js` running on homepage | Original AUDIT_REPORT.md top-20 item #20 and §2.3 say drop them — **this is WRONG** | Drop them → break `HomePage.js`. The PDF's item 9 account is accurate. |
| `@tensorflow/tfjs`, `@tensorflow-models/blazeface`, `nsfwjs` are "verified 0 importers" | `imageModeration.js:25-29` dynamically imports them — present and used | Original AUDIT_REPORT.md also says drop them — **also WRONG**. They are dynamically imported but ARE used. | Keep them; verify dynamic-import path is correct in build config. |

**Action:** Original audit recommendations to drop `@tensorflow/tfjs`, `@tensorflow-models/blazeface`, `nsfwjs`, `@react-three/drei`, `@react-three/fiber`, `three` should be **reverted** — they are all used. Confirm with `npm ls @react-three/drei @tensorflow/tfjs` before any cleanup. `axios` drop in original audit remains valid for C-F4 (interceptor/header issue), but be careful: C-F2/C-F4/C-F6 are the interceptor problem, not the dep itself.

---

## Verification (v2)

**v1 spot-verifications:**
- `_mark()` PATCH in `dealer_auto_approval_worker.py:111-112` (no `state=eq.pending` filter) — confirmed
- `defaultdict(deque)` in `app.py:140` — confirmed
- `routes/admin.py:23-93` `user_role == "superadmin"` check — confirmed
- `mobile/src/utils/authService.js:17` AsyncStorage write — confirmed
- `backend/migrations/2026_06_03_dealer_rls.sql:19` `FOR ALL USING (true) WITH CHECK (true)` — confirmed

**v2 PDF cross-validation spot-verifications (new this pass):**
- **`backend/.env:1-103`** — 15+ live secrets including `SUPABASE_JWT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `INFOBIP_API_KEY`. Confirmed.
- **`backend/routes/dealer/diagnostic.py:37-42`** — `id=eq.{listing_id}` with no `dealership_id` filter. Confirmed.
- **`flask-react-supabase-app/ocr-service/app.py:30, 123`** (path corrected — sibling of `backend/`, not nested in it) — `OCR_SERVICE_KEY = os.getenv("OCR_SERVICE_KEY", "")` then `if OCR_SERVICE_KEY and x_ocr_service_key != OCR_SERVICE_KEY:` — fail-open. Confirmed at the corrected path.
- **`backend/Dockerfile`, `flask-react-supabase-app/ocr-service/Dockerfile`, `flask-react-supabase-app/vision-service/Dockerfile`** — no `USER` directive, runs as root. Confirmed at the corrected paths.
- **`backend/services/dealer_inventory.py:8, 38`** — `import xml.etree.ElementTree as ET`, `ET.fromstring(data)`. Confirmed.
- **`backend/app.py:3366, 3400, 3404, 3437, 3457, 3461`** — `token_preview = token[:20] + "..."` logged on auth failures. Confirmed.
- **`flask-react-supabase-app/apply_rls_policies.sql:26-27`** — `CREATE POLICY "Users can update own profile" ON public.users FOR UPDATE USING (auth.uid() = id)` — no `WITH CHECK`. Confirmed.
- **PDF false positives spot-verified:**
  - `app.py:5227` sets CSP on every response — confirmed; PDF claim "CSP not set" is wrong.
  - `mobile/eas.json:29` `ascApiKeyPath` is a file path reference, not inline secret — confirmed; PDF claim of "exposed secret" is wrong.
  - `verify_complete_fix.py:113-119` targets all-zeros UUID — confirmed; PDF claim of "can overwrite real listing" is wrong.
  - `webhook_delivery_worker.py:20-21` bounded BACKOFF_SECONDS + MAX_ATTEMPTS=5 — confirmed; PDF claim of "starves cross-tenant delivery" is wrong.

No files modified. Audit report is the deliverable.
