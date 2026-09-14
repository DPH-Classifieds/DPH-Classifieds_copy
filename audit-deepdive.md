---

# Deep-Dive Audit — 12 Specialized Subagents

This file is the consolidated second-wave audit, complementing `auditissues.md`. Each section is the output of one specialist subagent dispatched in parallel; all paths are absolute and line numbers are from the live source.

---

## 1. Backend Hot-Path Performance Audit (app.py, 25,747 lines)

**Subagent: backend performance specialist. ~30+ findings across 3 severity tiers.**

### Critical (P0)

- **P0-1. `_collect_user_listing_records` does N+1 image fetches.** `app.py:2849-2858`. For each of 4 listing types, the function loops over rows and issues a separate `GET /rest/v1/{images_table}?{fk}=eq.{listing_id}` per row. A user with 4 cars + 4 bikes + 4 plates + 4 parts triggers 16+ Supabase round-trips per My-Listings render. The `PUBLIC_CAR_PREVIEW_SELECT` already supports embedded `car_images(*)` join — one batched query per type would replace this.
- **P0-2. `_collect_user_listing_records` calls `_sync_listing_lifecycle` per record on the My-Listings hot path.** `app.py:2864-2876`. Up to 16× wasted CPU per page load; the worker is the right place for this, not the read path.
- **P0-3. `_run_listing_draft_reminders_once` fires per-row claims + per-row user-email + per-row image fetches.** `app.py:13694-13809`. For `limit=100` rows: 100 × claim PATCH + 100 × `get_user_email` (often 2-RTT) + 100 × image fetch + 100 × push-token fetch + 100 × mark PATCH = ~600+ round-trips per tick. Should be batched with `id=in.(...)` and per-user map.
- **P0-4. `_run_saved_car_reminders_once` does per-row car lookup.** `app.py:13929-13934`. Should be one batched `GET /rest/v1/cars?id=in.(...)`.
- **P0-5. `_run_saved_search_alerts_once` does per-search per-table count queries with no caching.** `app.py:14363` + `_count_listings_for_saved_search` (line 13144-13183). Up to 400 GETs per sweep tick for `limit=100` saved searches × 4 tables. Should use `Prefer: count=exact` and group by category.
- **P0-6. `get_user_email` (`app.py:18878-18903`) is un-cached and called from 21+ hot paths.** Should be deleted in favor of `_get_user_email_by_id(user_id).get("email")` plus per-request memoization.
- **P0-7. `get_user_email` and `_get_user_email_by_id` are called twice in a single request** for the same user in `app.py:7681-7690` and `app.py:18501-18502`. Same pattern in admin user-profile patch.
- **P0-8. `get_bikes` / `get_parts` / `get_plates` reimplement the same direct-`requests.get` + fallback to `supabase_request` pattern** at `app.py:15273-15358`, `app.py:17469-17534`. The "main" direct path bypasses the shared HTTP session, the per-request timing instrumentation, and the retry/cache layers. The fallback path silently diverges in error handling from the primary path. **Delete the direct `requests.get` paths** and use `supabase_request` with embedded `bike_images(*)` / `part_images(*)` joins (same pattern as `get_cars` at `app.py:6795`).

### High (P1)

- **P1-1. `_run_listing_lifecycle_sweep_once` and `_run_listing_expiry_reminders_once` issue PII-bearing N+1 user lookups per row.** Same fix as P0-6.
- **P1-2. `_run_dealer_doc_expiry_reminders_once` does one users SELECT per dealer doc row.** `app.py:25364-25371`. 500 expiring docs = 500 user lookups. Should be batched.
- **P1-3. `_admin_collect_user_events` fetches all 2000 lead_events and 500 reports then filters in Python.** `app.py:23676-23712`. Should push filter to SQL with `listing_id=in.(owned_ids)`.
- **P1-4. `_get_admin_live_users` returns up to 5000 events per 15-second poll** (`app.py:21178-21226`); `_get_admin_live_users_history` returns up to **20,000 events** (`app.py:21230-21326`). Both are admin-polled.
- **P1-5. `_get_admin_listing_overview` issues 5 sequential Supabase queries** with overlapping scope (`app.py:23800-23873`). Can be embedded via `users:user_id(*)` and `<images_table>(*)` joins.
- **P1-6. Admin `get_listings_search` and `get_admin_reddit_listings` use `select=*`** (`app.py:23270-23273`, `22747-22750`). Returns full row including JSONB metadata; should project only the columns the UI uses.
- **P1-7. `get_bike_by_id` and `get_part_details` issue two sequential GETs** when PostgREST could embed (`app.py:15481-15485`).
- **P1-8. `_get_user_email_by_id` primary fallback path** still does an un-cached `/auth/v1/admin/users/<id>` GET (`app.py:18930-18939`). Cache auth-fallback responses with TTL.
- **P1-9. `get_admin_listing_overview` re-fetches the same owner in 4 places** (`app.py:23367-23375`, `23813`, `23750`). Owner row already in parent `select=*`.
- **P1-10. `_resolve_listing_owner_email` falls back to `get_user_email` because the worker queries select `*` minus `user_email`** (`app.py:2373-2389`, worker `app.py:25630, 25444`). The function's email-presence optimization is defeated by the query shape.
- **P1-11. `get_user_statistics` issues 5 sequential GETs** to count rows per table (`app.py:11806-11830`).

### Medium (P2)

- **P2-1. `defaultdict(deque)` rate limiters grow without eviction.** `app.py:145, 155, 158`. Per-key deques are pruned; the outer dict is not.
- **P2-2. `re` is imported but no module-level pre-compilation of hot patterns.** `app.py:25` + 9+ inline `re.match/re.search/re.fullmatch/re.findall` sites.
- **P2-3. `_normalize_for_profanity` compiles 3 regexes and a translation table per call.** `app.py:4421-4444`. `str.maketrans` and 2 `re.sub` per call.
- **P2-4. `_validate_description_word_count` uses `re.findall(r"\S+", description)` per request.** `app.py:4413-4418`. `description.split()` is equivalent and faster.
- **P2-5. `datetime.datetime.utcnow()` instead of `_utc_now()` (timezone-aware UTC).** 8 sites: `app.py:5790, 5889, 10673, 18498, 20306, 24072, 24246, 24728`. Naive UTC; implicit timezone coercion at read time.
- **P2-6. `_run_admin_stats` and `_get_admin_metrics_overview` page through every row** in cars/bikes/plates/parts/users for the dashboard (`app.py:21484-21813`, `20939-21103`). ~135 round-trips per call. Should be replaced by a materialized view.
- **P2-7. `_build_email_listing_card_html` builds a 100-line HTML string inside the worker for every draft / saved-car / saved-search alert** (`app.py:13256-13348`). Plus unsafe `f"...src={image_url}"` — XSS class.
- **P2-8. `to_int` calls `float(value)` then `int(...)` — slow string conversion.** `app.py:4391-4394`.
- **P2-9. `gzip` / `brotli` configured but email payloads to Resend are uncompressed.** `app.py:4521-4544`. Probably not worth fixing (Resend uses HTTPS).
- **P2-10. `_get_user_profile_for_verification` issues 3-4 Supabase calls per verify.** `app.py:4911-4968` + `app.py:5410`. Listing create hot path.
- **P2-11. `get_recommendations` loops `for t in target_types`** issuing one Supabase query per type (`app.py:25149-25170`).
- **P2-12. `_run_reddit_vin_dedup_sweep_once` reads 100k cars** to deduplicate (`app.py:19280-19340`).
- **P2-13. Admin `_admin_fetch_user_display_map` chunks at 50 IDs** but sequential (`app.py:23395-23429`).
- **P2-14. `get_user_admin_status` is uncached** and called per-admin-request (`app.py:14525-14545`). Should use `_require_admin_api_user` Redis-cached path.
- **P2-15. `normalize_username_value` runs `re.sub` per call** (`app.py:6255`).
- **P2-16. `_build_sitemap_xml` pages every row in cars/bikes/plates** then re-parses every record's lifecycle (`app.py:2670-2712`, `2762-2783`). 15-min cache. Should project `is_active_listing` as a column.
- **P2-17. `_get_user_info` re-fetches everything the JWT already knew** (`app.py:14810-14817`). 2-4 round-trips per `/api/auth/me` call.

### Low (P3)

P3-1 through P3-17: small wins — pre-compile UUID regex, cache `datetime.now().year`, use `logger.debug` not `logger.info` for hot-path logs, hoist `os.getenv` to module scope, use `brotli` level 6+ once dictionary warm, replace `json.dumps` with `orjson` in `_api_cache_set` (`app.py:608-682`), escape `image_url` in email HTML, use `xml.etree.ElementTree` for sitemap, add `is_dealer_created_at` to dealer listing search, drop per-row `int(value)` conversion, etc.

---

## 2. Backend Security Audit (app.py + routes/ + services/ + workers/ + devvit/hmac.ts)

**Subagent: backend security specialist. ~50 findings across 4 severity tiers.**

### CRITICAL (auth bypass, RCE, secret leak)

- **C-1: User-controlled `is_approved` flag bypasses moderation.** `app.py:7544` (create car), `app.py:7986` (update car), `app.py:16251` (parts create), `app.py:17963` (parts update). The whitelist in `create_car` includes `"is_approved"` — a normal user can POST `is_approved: true` and skip admin review. The whitelist excludes `dealership_id` but not `is_dealer`, `expires_at`, `retention_expires_at`.
- **C-2: `admin_required` in `routes/admin.py:32-102` is a JWT-only check with an in-memory cache.** Stale token after revocation still grants admin for up to 30s. Does not honor Redis-backed revocation that `app.py:18390-18411` provides.
- **C-3: `webhook_delivery_worker` does not deduplicate deliveries** (`workers/webhook_delivery_worker.py:41-55, 87-103`). Receiver can capture, replay, or forward signed deliveries — SSRF-replay primitive.
- **C-4: `_iter_auth_users` + `cleanup_unverified_accounts` can delete verified accounts** if GoTrue pagination shifts the cutoff (`auth_cleanup.py:42-95, 97-180`).
- **C-5: Phone OTP verification is brute-forceable via `_verify_msg91_access_token`** (`app.py:12706-12841`). No per-user attempt counter on the widget path.
- **C-6: `_normalize_listing_vin` skipped if user posts fields directly.** `app.py:7376-7380`. `is_dealer=true`, `is_approved=true`, `dealership_id` all writable before whitelist filter at 7574.

### HIGH (auth weakness, missing validation, info disclosure)

- **H-1**: `_iter_auth_users` non-constant-time pagination; admin cache TTL 5 min post-demotion.
- **H-2**: `webhook_delivery_worker._claim` uses `next_retry_at=eq.delivery['next_retry_at']` — fails silently if `next_retry_at IS NULL`.
- **H-3**: `services/url_safety.assert_safe_outbound` does not re-resolve DNS at request time — DNS rebinding defeats the guard (`services/url_safety.py:14-35`).
- **H-4**: `BLOCKED_IPS` is a tiny hardlist; CGNAT `100.64.0.0/10` is not explicitly blocked.
- **H-5**: Email enumeration via `/api/auth/login` timing (`app.py:11988-12105`).
- **H-6**: `_normalize_for_profanity` not applied to admin `rejection_note` / `rejection_fix` — XSS injection in outbound email (`app.py:9490-9495, 9572-9575`).
- **H-7**: `car_data["status"] = _initial_listing_status()` reachable on update without admin check (`app.py:7986`).
- **H-8**: `/api/admin/users/<user_id>/profile` PATCH allows admin to set `is_admin=true`; `_protect_super_admin_target` only checks the primary admin email.
- **H-9**: `_send_listing_status_email` sets `reply_to` from reporter-supplied email; header injection possible.
- **H-10**: `dealer_required` admin-acting-as bypass via `X-Acting-As-Dealership`; `_audit_write` is best-effort and silently drops on DB failure.
- **H-11**: `/api/info-requests/<token>/upload` accepts user-supplied `filename` and uses `secure_filename` only on the extension.
- **H-12**: `/static/uploads/<filename>` has no auth — empty directory today but legacy. Any future write becomes public.
- **H-13**: `_send_resend_email` allows long `subject` lines and `reply_to: email` can be header-injection vector.
- **H-14**: `/api/auth/admin-check` exposes `is_super_admin`; logs PII at INFO level.
- **H-15**: `lat`/`lng` not validated.
- **H-16**: VIN normalization accepts any 17-char string.
- **H-17**: Dealer webhook URL allowlist requires secret length ≥ 16, no entropy check.
- **H-18**: Webhook signature uses `secret_enc` at row-insert time; no rotation grace window.
- **H-19**: HMAC signing uses `sort_keys=True`; receiver-side canonicalization may differ.
- **H-20**: `devvit/dph-bot/src/server/hmac.ts:3-16` excludes `generated_at` from signed canonical form — replay-via-mutated-timestamp possible.

### MEDIUM (CSRF, SSRF, rate-limit gap)

- **M-1**: CORS allowlist accepts unnormalized origins (`app.py:4482-4509`).
- **M-2**: No CSRF protection on state-changing routes.
- **M-3**: Webhook delivery retries without jitter; no `Idempotency-Key` header.
- **M-4**: Rate-limit middleware returns `None` on Redis errors → fail-open, in-memory dict used per worker.
- **M-5**: `/api/auth/check-username` is unauthenticated and returns whether a username exists.
- **M-6**: `/api/phone-verifications/start` rate-limited on `phone_key` (good); legacy Infobip path retired.
- **M-7**: `/api/user/delete-account` deletes public row first; auth-row failure leaves orphan.
- **M-8**: Dealer API sources re-validated on each poll (good) but still TOCTOU-on-DNS.
- **M-9 through M-20+**: various input validation gaps, XSS via stored data, no URL regex on `tour_url`, etc.

### LOW (defense-in-depth)

Many defense-in-depth improvements including:
- `app.py:4482-4509` CORS allowlist validation
- JWT expiry alignment
- `gunicorn.conf.py` workers trust `X-Forwarded-For` directly
- `redis` connection lacks TLS
- etc.

---

## 3. Database Schema / Query / Index Audit (117 SQL migrations + app.py queries)

**Subagent: Postgres/Supabase schema specialist. ~67 findings across 5 categories.**

### Missing indexes (high impact)

1. **Admin listing overviews scan full tables** (`app.py:18957, 19013, 19065, 19117`). `select=*, order=created_at.desc` with no `deleted_at` predicate — partial indexes don't match.
2. **`/api/admin/listings-search` per-type full scans** (`app.py:23267-23276`). `drafts` branch is the worst.
3. **`saved_listings` reminder queue unindexed** for `(listing_type, created_at)` (`app.py:13869-13880`).
4. **`listing_drafts` reminder query uses obsolete `reminder_email_sent_at` predicate** (`app.py:13665-13676`).
5. **`dealer_listing_upgrade_requests` admin queue has only partial pending-only index** (`app.py:11195-11204`).
6. **`/api/admin/stats` lacks `created_at` index on `users/saved_searches/drafts`** (`app.py:21546-21580`).
7. **`users` is_dealer partial doesn't help `order=created_at.desc`** (`app.py:23979, 20277`).
8. **`lead_events` composite index leads with `listing_type`, queries lead with `listing_id`** (`app.py:23828, 23678`). Add `(listing_id, listing_type, created_at DESC)`.
9. **`listing_deletion_events` same column-order mismatch** (`app.py:23860-23870`).
10. **`reports.reporter_id` index is single-column** (`app.py:22179`).
11. **Public listings have no `deleted_at` predicate** to match partial indexes (`app.py:6796, 15200, 10102`).
12. **`dealer_documents.replaced_at=is.null` not covered by index** (`app.py:24004, 10556, 10777, 11719, 24195`).
13. **`dealer_admin_messages.dealer_id` has no index** (`app.py:26030`).

### Suboptimal indexes (16-41)

- 16. `users.is_dealer` single-column, no order support.
- 17. `idx_cars_user_id_created` doesn't include `user_dismissed_at`.
- 18. `idx_cars_user_dismissed_at` doesn't include `created_at`.
- 19. `idx_users_created` only in supabase migrations.
- 20-41. Various shadowed / duplicated / dead indexes.

### Type drift (42-50)

- 42. `expected_selling_price` is INTEGER, app sends string.
- 43. `trn=eq.X` lookup with digit-only normalization.
- 47. **`sold_status CHECK excludes 'no_response'`** — `app.py:1672` writes it, `backfill_no_response_sold_status_20260629.sql:16` writes it. Will fail with constraint violation 23514.
- 48. `account_status` values.
- 49. `dealer_application_status` value drift.
- 50. `dealer_documents.status` value drift.
- 51. **`featured_listings.listing_id` has no FK → orphans on hard delete.**
- 53. `outbound_emails.user_id` no FK.
- 55. `reports.reporter_id` CASCADE behaviour not defined.
- 56. `dealer_listing_upgrade_requests.resolved_by` and `dealer_listing_limit_history.changed_by` are FKs with default NO ACTION.

### RLS issues (57-67)

- 57. **`apply_rls_policies.sql:182-191` references non-existent table `public.dealers`** (real table is `dealerships`).
- 58. RLS policies on `cars/bikes/car_parts/license_plates` allow `FOR SELECT` only when `status='approved'` but no service-role bypass in same file.
- 59. **`Users can update own profile` does not block `is_admin` change** — self-promotion possible if hardening migration not applied (`apply_rls_policies.sql:25-27`).
- 60. `users` table `FOR ALL` admin policy doesn't constrain `is_admin` self-modification.
- 61. `dealer_admin_messages` not in any migration — app writes to a table that never existed.
- 62. `listing_verification_scans` is `FORCE ROW LEVEL SECURITY` with no policies.
- 63. `platform_events` has no RLS enabled.
- 64. `outbound_emails` not in the hardening list.
- 67. **`is_admin()` no-arg overload may have broken old `is_admin(uuid)` callers** — non-deterministic at RLS evaluation time.

### Confirmed clean

- JSONB column filters: `app.py` never filters on `metadata`/`payload` JSONB columns. No missing GIN indexes for that reason.
- Public read of `lead_events.listing_id, listing_type` — column order suboptimal but the index exists.
- Saved listings restore flow uses `id=in.(...)` against PK; OK.

---

## 4. Frontend Bundle / Render Audit (120+ files)

**Subagent: frontend bundle / React render specialist. ~70+ findings across 4 categories.**

### Bundle size wins (largest first)

1. **Lazy-load Radix UI used by Header** (~25-40 KB). `Header.js:17-28` synchronously imports `@radix-ui/react-accordion`, `@radix-ui/react-slot`, `@radix-ui/react-navigation-menu`, `@radix-ui/react-dialog`, `class-variance-authority` (button variants). Convert to `React.lazy` or dynamic import.
2. **Move ExplorePage.css out of Header** (~25 KB CSS) — Header imports a heavy CSS file (line 35 `import './components/cropper/unifiedCropper.css'`; the cross-import is wrong).
3. **Defer Supabase Realtime / Phoenix client** (~55 KB gz) — `supabaseClient.js` constructs the realtime client at import time, even if no realtime subscription is ever opened.
4. **Replace `axios` with `fetch` in authService** (~17 KB gz) — `authService.js:1` `import axios from 'axios'`. Half the codebase uses `apiClient` (fetch-based); `authService` is the only place that still pulls `axios`.
5. **Lazy three.js / drei HeroBackground** (~180 KB gz on home). `HomePage.js:20` is `lazy(() => import('./HeroBackground'))` (good) but `HeroBackground.js:2-3` synchronously imports `@react-three/fiber` + `@react-three/drei` + transitively `three` (~180 KB gz). Consider rendering a static-image hero when WebGL is unavailable.
6. **Lazy react-leaflet in CarDetail** (~40 KB gz). `CarDetail.jsx:17-21` synchronously imports `MapContainer, Marker, TileLayer` from `react-leaflet` + `leaflet` + `leaflet/dist/images/marker-*.png`. Should use the same `await import('leaflet')` pattern as `PostCar.js:217-225`. The map is below the fold for most visitors.
7. **Native `<select>` for non-searchable dropdowns in CarList** (~25 KB gz). `CarList.jsx:91-149` uses `SearchableSelect` (which transitively imports `react-select`, ~25 KB) for the body type / fuel / transmission / etc. dropdowns — those are simple native-style selects, not searchable comboboxes. Use plain `<select>` for those.

### Render perf wins

- **R1 (admin tables motion stagger)**: Every admin table row uses `<motion.tr initial animate transition={{ delay: i * 0.03 }}>`. Across 200 rows that's 200 fresh transition objects per render. Replace with CSS animations.
- **R2 (Intl.NumberFormat per row)**: `seo.js:29`, `adminUtils.js:3,12` construct a fresh `Intl.NumberFormat` (~50 µs) per call. ~13 calls per AdminMetrics render = ~650 µs.
- **R14 (inline arrow functions defeating memo)**: Many components pass `onClick={() => ...}` as new identities every render, defeating child memoization.
- **R9 (Header scroll listener)**: `Header.js:85-93` fires `setScrolled(window.scrollY > 24)` on every scroll event.
- **R10 (PlatformAnalyticsTracker capture-phase click)**: Listens on every click in the document and POSTs to `/api/analytics/events`. Targets not narrowed to tracked elements.

### Image wins

- **I1 (MarketplaceListingCard missing dimensions)**: `MarketplaceListingCard.jsx:120-132, 135-145` — every Explore card has CLS.
- **I11 (no srcset/sizes on user images)**.
- **I12 (538 KB hero.avif with no responsive variant)**.
- **I21 (PNG logos in Footer)** — 78KB + 62KB for 28×28 px.

### Effect cleanup wins

- **E4-E6**: Only 1 `AbortController` in entire codebase (`apiClient.js`). Need ~12 — every useEffect with a fetch should cancel on unmount.
- **E2 (refreshSession for anonymous visitors)**: `apiClient.js:127` calls `authService.refreshToken()` on 401 for anonymous users too — pointless round-trip.
- **E11 (PostCar setTimeout chain)**: `PostCar.js:1449` `setTimeout` not cleared on unmount.

### Quick memoization wins

- **M2 (relTime formatter)** — duplicated 7× across admin/dealer files; each is a fresh 6-branch `if/else` ladder with `new Date()` allocations.
- **M11 (CarList bodyTypes/fuelTypes arrays hoisted from render body)** — recreated every render.
- **M16 (Header headerSurfaceStyle)**.
- **M22 (useIsAdmin request dedup)**.

---

## 5. Mobile (Expo) Performance Audit (mobile/ — ~100 files)

**Subagent: Expo / React Native performance specialist. ~54 findings across 5 categories.**

### Bundle size wins (12 findings)

1. **`@tensorflow/tfjs` + tfjs-react-native loaded eagerly** in `mobile/src/utils/imageModeration.js:6-11`. `nsfwjs` + `blazeface` are correctly lazy, but tfjs itself pulls ~1MB+. Top-level imports execute at module load even if `moderateImage` is never called.
2. **`react-native-maps` imported synchronously into PostListingScreen** (`mobile/src/screens/listing/PostListingScreen.js:8`). The native module loads its iOS/Android shim eagerly.
3. **`@shopify/react-native-skia` heavy import in PhotoEditorModal and bakeImageEdits** (`mobile/src/components/ui/PhotoEditorModal.js:4`, `mobile/src/utils/bakeImageEdits.js:2`).
4. **`react-native-webview` loaded eagerly by TurnstileModal** (`mobile/src/utils/turnstile.js:4`).
5. **`@msg91comm/sendotp-react-native` is gated correctly but listed as a top-level dep** (`mobile/package.json:19`).
6. **`native-tabs-liquid-glass` example folder confirmed NOT bundled** — verified by grep.
7. **`carData.js` (77 KB) imported synchronously by listingConstants** (`mobile/src/utils/listingConstants.js:1`). 1,230 lines of static array literals.
8. **`react-native-fs` declared as dependency but unused** — `expo-file-system` is what's used everywhere.
9. **`postListingScreen.js` (108 KB / 2,843 lines) loaded synchronously** for both `Edit` and `Sell` routes. Splits into `LazyPostListingScreen`.
10. **Admin screens bundled for all users** — every `app/(tabs)/(profile)/Admin*.tsx` is statically imported.
11. **Dealer screens bundled for all users** — same pattern.
12. **`(saved)` tab loads `EditListing` route** even if user never edits.

### Screen-perf wins (13 findings)

13. **`PostListingScreen.js` (2,843 lines) runs full draft restore + draft auto-save on mount** — `mobile/src/screens/listing/PostListingScreen.js:1037-1081,1084-1158`.
14. **`ExploreScreen.js` (1,418 lines) fires 4 simultaneous fetches + 4 featured fetches on mount** — `mobile/src/screens/explore/ExploreScreen.js:879-921, 1046-1066`.
15. **`ExploreScreen.js` mount fires synchronous AsyncStorage.getItem + coach-mark timer** — `mobile/src/screens/explore/ExploreScreen.js:786-796`.
16. **`SettingsScreen.js` (1,081 lines) — 17+ useState hooks**.
17. **`CarListScreen.js` (750 lines) — uses FlashList but estimates 210/280 fixed** — `mobile/src/screens/listing/CarListScreen.js:727-750`.
18. **`MyListingsScreen.js` (529 lines) — 5-tab FlashList re-fetch on every tab change**.
19. **`SignupScreen.js` (1,047 lines) — every keystroke runs password-strength regex** — `mobile/src/screens/auth/SignupScreen.js:72-83, 188-194`.
20. **`PostListingScreen.js` heavy constant arrays re-evaluated each render**.
21. **`SettingsScreen.js` pull-to-refresh round-trips `/api/auth/me` every time**.
22. **`PostListingScreen.js` image moderation runs `loadModels()` on every photo** (warm them at app start instead).
23. **`PostListingScreen.js` Skia surface cost on every color-edit** (debounce).
24. **`ocrScanner.js` builds FormData and uploads twice per scan** — `mobile/src/utils/ocrScanner.js:108-128`.
25. **`PostListingScreen.js` camera+location+imagepicker imported at top** — lazy-require instead.

### Network wins (7 findings)

26. **`CheckEmailScreen.js` uses raw `fetch` instead of `apiClient`** — `mobile/src/screens/auth/CheckEmailScreen.js:25-29, 57-61`.
27. **`ForgotPasswordScreen.js` calls `supabase.auth.resetPasswordForEmail` directly** — `mobile/src/screens/auth/ForgotPasswordScreen.js:36-39`.
28. **`SignupScreen.js:164` raw `fetch` for username check** — `mobile/src/screens/auth/SignupScreen.js:163-166`.
29. **`AuthContext.js:238, 255` raw `fetch` for reset/update password** — `mobile/src/context/AuthContext.js:238-244, 255-261`.
30. **`analytics.js` raw `fetch` with `keepalive: true`**.
31. **`apiClient.js:120-142` 401 retry has no debounce / no in-flight deduplication** — 5 concurrent 401s trigger 5 parallel `refreshToken()` calls.
32. **`apiClient.js` URLSearchParams reconstruction on every fetch** — `mobile/src/screens/explore/ExploreScreen.js:881-893`.

### AsyncStorage wins (6 findings)

33. **`AuthContext.js` writes `cached_user_v1` on every user mutation** — `mobile/src/context/AuthContext.js:141-143`.
34. **`PostListingScreen.js` draft autosave fires `multiSet` on every form change** — debounce / diff.
35. **`ExploreScreen.js` mount reads AsyncStorage to gate coach-mark tour** — `mobile/src/screens/explore/ExploreScreen.js:786-800`.
36. **`swrCache.js` TTL semantics are wrong for `EXPLORE_INITIAL_CACHE_KEY`** — `mobile/src/utils/swrCache.js:5-15`, `mobile/src/screens/explore/ExploreScreen.js:45, 913`.
37. **`PostListingScreen.js` writes `last_listing_location` on every submit** — combine with `listing_draft_*` via `multiSet`.
38. **`listingCache.js` — in-memory only, good** (confirmed clean).

### Dead code (9 findings)

39. **`mobile/src/screens/home/HomeScreen.js` is not routed** — verified zero imports outside `__tests__/HomeScreen.test.js`. 362 lines.
40. **`mobile/examples/native-tabs-liquid-glass/`** — confirmed not bundled, can be deleted.
41-46. Various `*.web.js` placeholders, `featuredPlacement.js` tiny, `userBehavior.js` doesn't exist (audit prompt was wrong), `listingType.js` tiny.

### Console.log cleanup (7 findings)

47. **`supabaseClient.js:86` unguarded `console.log`** of deep-link URL — leaks LAN IP / dev tunnel.
48. **`imageModeration.js:79, 103` unguarded `console.warn`** — NSFW probabilities in production.
49. **`PostListingScreen.js:1449` `__DEV__`-gated (correct)** — only one.
50. **`pushNotifications.js:78, 93, 128`** — correctly gated.
51. **`ErrorBoundary.js:21`** — correctly gated.
52. **`ocrScanner.js:93`** — correctly gated.
53. **`config.js:14`** — correctly gated.

---

## 6. Worker / Background Job Audit (worker.py + workers/ + app.py sweeps)

**Subagent: distributed systems specialist. 50 findings across 3 categories.**

### Per-worker findings (41 findings)

1. **`worker.py:131-150` — adaptive backoff broken for dict-returning workers.** `_result_did_work` returns True for any non-empty dict, including `{"status": "disabled"}`. Reddit daily, bridge, dealer auto-approval never actually back off.
2. **`worker.py:131-150` — failure branch never resets `wait` to base after recovery.** Cap-bound retry loop forever on sustained outage.
3. **`worker.py:49-56` — health server binds `PORT`** (same as API). No `WORKER_PORT` env var.
4. **`worker.py:153-573` — no SIGTERM handler.** `time.sleep(60)` blocks in `KeyboardInterrupt` only; SIGTERM kills threads mid-tick, orphans in-flight claims.
5. **`worker.py:159-160, 277-484` — 18 threads; no overrun detection.** Slow tick → immediate re-entry.
6. **`workers/auto_review_worker.py:141-162` — `fetch_pending_for_type` is read-only; no atomic claim.** Two replicas both process same row.
7. **`workers/auto_review_worker.py:59-97` — per-row try/except is good** but `_result_did_work` returns 0 even after processing 4 of 5 rows.
8. **`workers/auto_review_worker.py:230-322` — ~800 Supabase round-trips per tick** (4 tables × 20 rows × 10 trust-context calls).
9. **`workers/auto_review_worker.py:187-208` — image downloads sequential.** `requests.get(..., stream=True)` × up to 20 per row.
10. **`workers/auto_review_worker.py:709-734` — downgrade_to_pending triggers email side-effects without transactional idempotency.** Re-runs send duplicate admin emails.
11. **`workers/dealer_api_source_poller.py:269-283` — claim is racey.** Two replicas read same `due_sources`, both PATCH succeed.
12. **`workers/dealer_api_source_poller.py:296` — `_update_source` not called on exception.** Row left in `last_status='polling'`.
13. **`workers/dealer_api_source_poller.py:204-266` — bulk-upsert GET-N1 then write-N+1.** Up to 1000 sequential PATCHes per tick.
14. **`workers/dealer_api_source_poller.py:60-67` — service-role headers missing `Prefer: count=exact`**.
15. **`workers/dealer_auto_approval_worker.py:111-119` — claim semantics race** (`_claim` returns False on race, but dev with empty `SUPABASE_URL` returns True unconditionally).
16. **`workers/dealer_auto_approval_worker.py:130, 137` — `datetime.utcnow()` naive** (correctness issue).
17. **`workers/dealer_auto_approval_worker.py:174-220` — `_process_one` waits silently after claim if not yet due.** Row stuck in `firing` forever.
18. **`workers/dealer_kpi_aggregator.py:40-149` — one tick fetches `platform_events` 4× per dealership per chunk** (up to 2000 GETs per night).
19. **`workers/dealer_kpi_aggregator.py:127-138` — aggregations in Python; O(N) memory.**
20. **`workers/dealer_kpi_aggregator.py:144-149` — `dealer_kpi_daily` POST not idempotent under retry** (no outer try/except).
21. **`workers/dealer_lead_aggregator.py:42-51` — cursor read is not atomic.** Two replicas can duplicate-insert leads.
22. **`workers/dealer_lead_aggregator.py:144-184` — `_save_cursor` advances max(ev.created_at)**; events with older timestamps get skipped.
23. **`workers/dealer_lead_aggregator.py:83-112` — `_find_existing_lead` does a fresh GET per event** (500/tick).
24. **`workers/inventory_import_worker.py:37-61` — `_claim_job` returns 0 even when queue is deep** (adaptive backoff misfires).
25. **`workers/inventory_import_worker.py:248-295` — top-level try/except catches entire job**; `_emit_row_error` is best-effort and silently dropped.
26. **`workers/market_snapshot_worker.py:34-71` — single GET returns up to 5000 cars; compute_snapshot is sequential.**
27. **`workers/market_snapshot_worker.py:65-71` — purge deletes snapshots older than 90 days, unbounded DELETE.**
28. **`workers/reddit_daily_post_worker.py:298-307` — last is read once but `post_date` may differ** (Dubai vs UTC).
29. **`workers/reddit_daily_post_worker.py:325-340` — window widening can produce duplicate posts.**
30. **`workers/reddit_daily_post_worker.py:172-176` — span_label may lie about the actual window.**
31. **`workers/reddit_import_worker.py:84-92` — run row is created but not committed atomically with first insert.**
32. **`workers/reddit_import_worker.py:466-507` — `sync_removed_imports` issues one /api/info call per `_REMOVAL_CHECK_CAP` rows; auth-token may be empty.**
33. **`workers/reddit_import_worker.py:509-531` — `_expire_stale_reddit` issues PATCHes with `status='eq.approved'` filter but uses `Prefer: return=representation`** — bandwidth waste.
34. **`workers/reddit_import_worker.py:330-441` — `_upsert_listing` no in-tick dedup across listings with the same `source_external_id`.**
35. **`workers/reddit_roundup_bridge_worker.py:133-164` — concurrent GitHub PUTs race.**
36. **`workers/reddit_roundup_bridge_worker.py:69-86` — rolling window offset shifts content_hash; commit frequency is high.**
37. **`workers/webhook_delivery_worker.py:87-104` — claim semantics rely on `next_retry_at=eq.delivery['next_retry_at']`** (same race pattern as dealer_api_source).
38. **`workers/webhook_delivery_worker.py:58-67` — `_recover_stale_deliveries` uses `status=eq.in_progress` but the new claim path writes `next_retry_at=lease_until` without changing `status`.** Inconsistent.
39. **`workers/webhook_delivery_worker.py:121-124,249-256` — backoff is per-delivery but `attempt_count` is mutated via PATCH race.**
40. **`workers/webhook_delivery_worker.py:200-208` — no response-size guard on success body.**

### Cross-cutting worker issues (42-50)

- **42. `worker.py` — no leader election**; every worker except `dealer_auto_approval` is vulnerable to double-work.
- **43. `worker.py:548-573` — `finally:` block omits `dealer_doc_expiry_thread`.**
- **44. `worker.py:131-150` — `scheduled_loop` never detects overrun.**
- **45. `worker.py` — no back-pressure on global failure rate.**
- **46. `workers/*.py` — all workers leak `requests.Session`.**
- **47. `workers/*.py` — per-row try/except is inconsistent** (best: `auto_review_worker`; worst: `dealer_kpi_aggregator` has no try/except).
- **48. `workers/*.py` — no global rate-limit awareness on outbound HTTP.**
- **49. `worker.py:202-214` — `UNVERIFIED_CLEANUP_DRY_RUN` defaults to false.**
- **50. `worker.py:159-160` — health handler accepts GET only; no readiness vs liveness distinction.**

### Sweep-function findings (51-58)

- **51. `app.py:13641-13809` — `_run_listing_draft_reminders_once` does up to 8 sequential round trips per row + email send.**
- **52. `app.py:13860-13977` — `_run_saved_car_reminders_once` fetches one listing per saved_listings row (N+1).**
- **53. `app.py:14224-14298` — `_run_price_drop_alerts_once` is N+1 on `price_drops` × saved_searches.**
- **54. `app.py:14301-14423` — `_run_saved_search_alerts_once` has no outer try/except.**
- **55. `app.py:25328-25420` — `_run_dealer_doc_expiry_reminders_once` stamps `expiry_reminder_sent_at` *after* sending — claim race.**
- **56. `app.py:25423-25612` — `_run_listing_expiry_reminders_once` does per-listing email + 1 SELECT per type.** Worst case in the codebase.
- **57. `app.py:25615-25658` — `_run_listing_lifecycle_sweep_once` re-fetches every approved listing on every tick.** Up to 200k+ round-trips per sweep at scale.
- **58. `app.py:19280-19340` — `_run_reddit_vin_dedup_sweep_once` fetches all live reddit cars (limit=100000) every hour.**

---

## 7. CI / Build / Deploy Audit (61 findings)

**Subagent: CI/CD / build-system specialist.**

### CI / test automation gaps (1-13)

1. **CI never invokes backend `worker.py`** (`.github/workflows/ci.yml:25`).
2. **`docker-e2e` job: no `docker buildx` setup, never caches layers** (`.github/workflows/ci.yml:62-68`).
3. **`docker-e2e` job: no fallback when Docker daemon is unavailable** (`flask-react-supabase-app/backend/e2e/run.sh:8,25`).
4. **CI has no Python lint job (no ruff/black/mypy)**.
5. **CI does not pin `actions/checkout`/`setup-python`/`setup-node` to SHA** (`.github/workflows/ci.yml:18,19,34,51`).
6. **CI does not run the devvit bot tests** (`devvit/dph-bot/package.json:8-11`).
7. **CI does not test the ocr-service or vision-service**.
8. **`pytest -q` with no coverage gate**.
9. **`mobile` job: `npm test -- --runInBand --watch=false` with no env matrix**.
10. **`frontend` job: `npm run check:bundle` runs but has no fail threshold**.
11. **CI matrix excludes ocr-service tests, but its tests live in the backend.**
12. **`start.sh` does `python3 -m backend.app` (broken entry)**.
13. **Two `start-local.sh` scripts do almost the same thing with conflicting defaults.**

### Build config duplicates (14-20)

14. **FOUR start-command definitions for the same backend** (Dockerfile, Procfile, nixpacks.toml, railway.json).
15. **TWO `vercel.json` for the same Vercel project** (root vs `frontend/vercel.json`).
16. **`nixpacks.toml` and `railway.json` reference `./requirements.txt` from a directory that doesn't exist** when Root Directory is set.
17. **`nixpacks.toml` and `railway.json` use the same broken shell pattern** (`[ -d ... ] && cd ...; python -m venv .venv`).
18. **`.env.railway.example` duplicates `.env.example` for the backend.**
19. **`frontend/.env.railway.example` likewise duplicates `frontend/.env.example`** + contains real production values.
20. **`mobile/.env` and `mobile/.env.local` are duplicates of each other.**

### Docker / deploy bugs (21-36)

21. **`ocr-service/Dockerfile` EXPOSE/PORT mismatch** (8080 vs 8000).
22. **`vision-service/Dockerfile` EXPOSE/PORT mismatch (same).**
23. **`ocr-service/download_models.py` is dead code** — never invoked by the Dockerfile.
24. **`vision-service` runs CPU-only, hardcoded** (`vision-service/app.py:58`).
25. **`ocr-service/Dockerfile` does NOT pin `OCR_LANG` (not baked in).** (Audit prompt was wrong.)
26. **Pinned versions that don't exist on PyPI:** `starlette==1.6.0` in `ocr-service/requirements.txt:3` and `vision-service/requirements.txt:3`. (Latest Starlette is 0.45.x.)
27. **`paddlepaddle==2.6.2` / `paddleocr==2.8.1` are old and CPU-only**.
28. **`vision-service/requirements.txt` pins `torch==2.6.0` — large image** (~2.5 GB).
29. **`vision-service/Dockerfile` lacks `Pillow` libimagequant/libjpeg-turbo**.
30. **`backend/Dockerfile` HEALTHCHECK hits `/healthz/live` via Python urllib** — spawns Python on every healthcheck.
31. **`backend/.dockerignore` excludes `test_*.py`** — confirmed correct.
32. **Both Dockerfiles use `python:3.11-slim-bookworm`** instead of `python:3.11-slim`.
33. **Backend Dockerfile ENV order: `PATH=/opt/venv/bin:$PATH` is set before venv exists.**
34. **`ocr-service/Dockerfile` GunicornWorker config: `--timeout 120` with `--graceful-timeout 30`**.
35. **Backend `Procfile` is correct but unused.**
36. **`start-local.sh` (root) hardcodes port 8000 but uses gunicorn which expects Railway `PORT`.**

### Frontend build issues (37-45)

37. **`frontend/.env.production` is gitignored (correct) but the actual real value lives in `.env.railway.example` (also tracked)** — contains real anon key + PostHog key.
38. **`frontend/.env` contains `BETA_PASSWORD="dubaipetrolh3ads"`** — local-only.
39. **`frontend/vercel.json` lacks the CSP header that the root `vercel.json` defines**.
40. **`craco.config.js` overrides `splitChunks.maxSize = 500 * 1024` — fragile**.
41. **`tailwind.config.js` does not declare `mode: 'jit'`** — fine, JIT is default in 3.x.
42. **No image-optimization plugin in `craco.config.js`.**
43. **`frontend` job runs `npm run build` and `check:bundle` but no Lighthouse / a11y check**.
44. **`frontend/package.json` has `postinstall` that runs `node scripts/ensure-mediapipe-sourcemap.js` — runs on every CI install**.
45. **`frontend/.env.example` references `REACT_APP_ENABLE_BETA_GATE=false` (commented) but `frontend/.env` has it uncommented**.

### Mobile / deploy issues (46-54)

46. **`mobile/eas.json` `appVersionSource: remote` references a remote that doesn't exist**.
47. **`mobile/credentials/` contains real Apple/Google submission keys but gitignore is correct**.
48. **`mobile/eas.json` `submit.production` references `./credentials/...` — path must be CWD-relative to EAS CLI**.
49. **`mobile/app.json` `package` and `bundleIdentifier` both `com.dphclassifieds.app` — fine**.
50. **`mobile/package.json` uses React 19.2.3 but Expo SDK 57 only supports up to React 19.1.x**.
51. **`mobile/.env` and `mobile/.env.local` are duplicated** (already covered).
52. **`mobile/.env` contains `EXPO_TOKEN=...` — gitignored but real**.
53. **No CI job for the mobile EAS build**.
54. **`mobile/jest.config.js` only collects coverage from `src/utils/**` and `src/hooks/**`**.

### Secret hygiene (55-61)

55. **Tracked `.env.railway.example` files contain real production values** (anon key + PostHog key).
56. **`.gitignore` does not ignore `.vercel/`, `.expo/`, `metro-cache/`.**
57. **Tracked: `client_secret_*.json` and `fit-asset-*.json` — both gitignored** (verified).
58. **`.dockerignore` does not block `mobile/.env`, `mobile/.env.local`, or `mobile/credentials/`.**
59. **Backend `.env` (gitignored) exists on disk with 7KB of values** — standard.
60. **`mobile/.npmrc` is explicitly un-ignored by `.gitignore:18`** — correct.
61. **Devvit bot has no `app.json`-equivalent secret handling** — correct (Reddit-managed secrets).

---

## 8. Data Integrity / Correctness Audit (41 findings)

**Subagent: data integrity / correctness specialist.**

### Data corruption risks (1-10)

1. **Listing create is multi-write with no transaction — orphan rows on partial failure.** `app.py:7587-7704` (create_car), `16545` (create_bike), `17616` (create_part), `18671` (_create_plate_with_image_impl).
2. **`view_count` is read-then-write — lost updates + unbounded drift.** `app.py:7185-7213`. Two concurrent viewers both GET 41 and both PATCH 42 — viewer #2's count is lost. **`get_bike_by_id` (`app.py:15450`) does not increment views at all.**
3. **Status transitions skip the state machine.** `app.py:1661-1673`. `pending_auto_review → deleted` is reachable without admin review.
4. **`_record_price_point` is non-atomic and loses first-write history.** `app.py:14007-14035`.
5. **Reddit dedup is a race window — duplicate VINs can land on import.** `workers/reddit_import_worker.py:365-404`. No DB-level UNIQUE on `vin_number`.
6. **Sold status repair writes back to `approved` without verifying the user isn't suspended.** `app.py:1606-1637`.
7. **`_soft_delete_listing` is unconditional — admin clicks cancel race against expiry sweep.** `app.py:1513-1554`.
8. **`_archive_user_listings` hardcodes `status='archived'` but the CHECK constraint doesn't include it.** `routes/admin.py:1333-1356`. CHECK allows `pending, pending_auto_review, approved, active, expired, deleted, rejected, sold, draft, source_archived` — **`archived` is NOT in the allowlist**. PATCHes silently no-op (or fail at constraint time).
9. **`dealer_documents` migration adds `replaced_at` column but never indexes the historical view query.** `migrations/2026_08_13_dealer_verification_lifecycle.sql:19-25`.
10. **Money is rounded by `int()` then re-stored — silent truncation.** `app.py:7425, 8015-8017, 13984, 13993, 14001, 14014`. `int(14999.99) = 14999`.

### Race conditions (11-20)

11. **Lifecycle sweep PATCH is unguarded — concurrent sweeps produce conflicting writes.** `app.py:25615-25658`.
12. **`is_archived` race with `_sync_listing_lifecycle` and admin actions.** `app.py:1675`.
13. **`view_count` race on bike/plate/part listing routes — no increment at all, but cars has it.** Inconsistency.
14. **`get_car_by_id` increments views even for owner requests in some flows.** `app.py:7185`. Hidden reddit rows can be polled.
15. **Email claim window vs duplicate cron runs.** `app.py:1443-1510`.
16. **`_send_listing_status_email` (`app.py:9452`) has no caller-level idempotency.**
17. **Webhook delivery lease is time-window only — no idempotency across receiver-side replays.** `workers/webhook_delivery_worker.py:87-103`.
18. **`process_once` in `auto_review_worker.py` reads pending listings and approves them without a row lock.**
19. **`_stale_renewal_repair_fields` race with concurrent renew endpoint.** `app.py:1065-1095`.
20. **`_reject_listing_for_images` between-image writes are sequential, not transactional.** `workers/auto_review_worker.py:673-706`.

### Soft-delete / retention holes (21-25)

21. **`cleanup_unverified_accounts` deletes the auth user and the `public.users` row — but leaves orphan rows in 20+ tables.** `auth_cleanup.py:138-170`. Listings, leads, push_tokens, etc. stay orphaned.
22. **Admin delete-user flow** (`routes/admin.py:1459-1543`) does soft-archive then delete — but storage objects are never cleaned up. **Orphan storage objects growing without bound for every deleted user.**
23. **`LISTING_TERMINAL_STATUSES` (`app.py:413`) excludes `archived` and `expired`.**
24. **`_run_listing_lifecycle_sweep_once` (`app.py:25615`) does not include `pending_auto_review` in its sweep filter.**
25. **`_sync_listing_lifecycle` writes `is_archived=True` even for soft-deleted listings** — leaks via `persist=False` path.

### PII leaks (26-30)

26. **`get_user_email` (`app.py:18878-18903`) holds full Auth user payload in memory; full dict may leak to logs on exception.**
27. **`registration_ocr.upload_training_image` (`services/registration_ocr.py:854-893`) uploads the original unredacted mulkiya scan to a training bucket.** Name, nationality, ID, DOB, plate, chassis, address. **PII to a training bucket with no consent gate.**
28. **`_record_listing_deletion_event` (`app.py:1539-1546`) logs deletion metadata; admin-driven deletes log email, username — GDPR Art. 5(1)(e) violation for never-verified users.**
29. **`EmailChange` flow (`app.py:14979-15029`) lists every Supabase Auth user via `/auth/v1/admin/users`** to find the one matching the current email. PII dump on every email-change request.
30. **`_get_safe_redirect_url` (`app.py:4576-4590`) does not validate redirect path against the app's allowlist** — open redirect via misconfigured CORS allowlist.

### Orphan resources (31-35)

31. **`upload_to_supabase_storage` (`app.py:8953-9088`) uploads the original then optionally a display variant — partial-failure leaves orphan original.** Subsequent retries leak storage (no de-dup).
32. **`_delete_user_owned_listing` (`app.py:2912-2946`) only calls `_soft_delete_listing` — storage objects are never deleted.**
33. **Admin listing delete (`routes/admin.py:824-828`) deletes `car_images` rows but does not delete the storage objects.**
34. **`_reject_listing_for_images` (`workers/auto_review_worker.py:673-706`) deletes storage and image rows but no rollback for the PATCH.**
35. **`price_drops` is never deleted.** Monotonic growth; no TTL or cron sweep.

### Idempotency holes (36-41)

36. **`_send_resend_email` is fire-and-forget — no DB dedup on the email send itself.**
37. **`_send_resend_email` does not check the message-id against Resend's recent-sends; webhook_delivery_worker doesn't add `Idempotency-Key` header.**
38. **`_approve_via_helper` → `_approver()` is the canonical approver, but admin routes also patch status directly** — duplicate approval emails.
39. **`_maybe_record_price_drop` triggers an alert + a `_record_price_point` in the same call, but neither checks the other** — both insert on idempotent retry.
40. **`send_expo_push` (expo_push.py:16-41) caps at 100 tokens silently.**
41. **Webhook dead-letter is final — receiver outage > 12 hours means permanent loss.**

---

## 9. Static Assets / SEO / Accessibility Audit (69 findings)

**Subagent: static assets / SEO / accessibility specialist.**

### Orphan / wasted assets (~3.4 MB)

1. `frontend/public/instagram.png` orphan (5 KB).
2. `frontend/public/redditlogo.png` orphan (58 KB).
3. `frontend/public/images/About-page.avif` orphan (548 KB).
4. `frontend/public/images/IMG_3391.avif` orphan (619 KB).
5. `frontend/public/images/optimized/` — both files orphan (852 KB).
6. `frontend/public/images/plates/*` — all 7 files orphan (281 KB).
7. `frontend/src/assets/images/*` — all 7 files orphan (~2.0 MB).
8. `logo192.png`/`logo512.png` referenced only by manifest (24 KB).

### Format / size inefficiencies (9-19)

9. `About-page-removebg-preview.png` (216 KB) has no AVIF/WebP sibling.
10. `hero.avif` (538 KB) is single-resolution.
11. `bottom-landing.avif` (152 KB) single-resolution.
12. `Our Mission.avif` (211 KB) single-resolution.
13. `instagram-logo.png` (78 KB) + `reddit-logo.png` (62 KB) are lossless PNGs for 28×28 px icons.
14. `apple-touch-icon.png` (6,683 B) can shrink.
15. `favicon-48.png` (2,331 B) duplicates favicon.png.
16. `favicon.ico` (1,786 B) is a PNG renamed `.ico`.
17. `manifest.json` cache-bust mismatch `?v=4` vs `?v=3`.
18. No `image-minimizer-webpack-plugin` or `@squoosh/lib` in pipeline.
19. Build emits 7.9 MB of JS into `/static/js`.

### Responsive / CLS issues (20-28)

20. `HomePage.js:234-242` — good (only `<img>` with dimensions).
21-24. `CarDetail.jsx:574-587`, `MarketplaceListingCard.jsx:120-145`, `BikesRedesigned.jsx:401-408`, `PlateDetailRedesigned.jsx`, `PartDetailRedesigned.jsx`, `BikeDetailRedesigned.jsx` — every listing detail page renders the hero `<img>` without intrinsic dimensions.
25. No `<img>` in the codebase uses `srcset` / `sizes`.
26-27. `BuyingRequestDetail.jsx:128,152` — `<img>` with empty `alt`, no dimensions.
28. `AdminListingDetail.jsx:742-748,795-801, 814-820, 833-839` — preview/document `<img>` lack intrinsic size.

### SEO issues (29-38)

29. `frontend/public/index.html:36-40` — OG image type/mime mismatch. Twitter/Facebook scrapers don't accept AVIF reliably; `og:image:type` is `image/avif`.
30. `frontend/public/llms.txt` — content quality is thin.
31. `frontend/public/robots.txt` — disallow rules look correct.
32. SEO meta on every public page — `<title>`, `<description>`, OG tags.
33. Canonical URLs — set per page.
34. Sitemap caching — `/api/sitemap.xml` cache `max-age=900`.
35. `<meta name="robots" content="index, follow">` is always present, even on detail pages with `noindex` filter.
36. `seo.js:300` — `type: 'product'` for ALL listing kinds.
37. `seo.js:264-283` — keyword stuffing in `keywords` meta.
38. No canonical host declaration (`<link rel="canonical">` is per-page only).

### Accessibility issues (39-61)

39-42. **Loan Calculator inputs in `CarDetail.jsx:996-1036`, `BikeDetailRedesigned.jsx:575-616`, `PartDetailRedesigned.jsx:528-569`, `PlateDetailRedesigned.jsx:425-466` have no `id` and the `<label>` has no `htmlFor`.** 16 inputs mislabeled for screen readers.
43. `PlateDetailRedesigned.jsx:411-414` — SVG map pin with corrupted `path` `d` attribute.
44. `ListingPicker.jsx:67-69` — close `<button>` lacks `aria-label`.
45. `ListingPicker.jsx:73-80` — search `<input>` lacks a label or `aria-label`.
46-47. `AdminListingDetail.jsx:1209, 1285`, `AdminDealerDetail.jsx:124, 294, 1032` — admin form inputs unlabeled.
48. `DealerSidebar.jsx:108-115` — fine.
49. `VinRevealAnalyticsModal.jsx:25` — fine.
50. `CarDetail.jsx:863-880` — `<div role="button" tabIndex={0}>` for VIN reveal. Use `<button type="button">`.
51. `Contact.js:112` — decorative `<div>` icon containers.
52. `MyListings.js:46, 575-668` — multiple icon-only buttons have `aria-label`s already; status OK.
53. `SavedListingToggleButton.jsx:45-62` — has `aria-pressed` + `aria-label`.
54. `CarDetail.jsx:603, 611` — fine.
55. `index.html:2` — `<html lang="en">` hardcoded; Arabic content in `UAELicensePlate.js`.
56. `HeroBackground.js:180-184` — `aria-hidden="true"`. Good.
57. `ExplorePage.jsx:1702-1707` — chip remove `<button>` uses `×` glyph + has `aria-label`.
58. `UAELicensePlate.js:35,50, 67, 83, 99, 115, 131` — Arabic text inside `<div>` without `lang="ar"`.
59. `<img>` with empty `alt=""` where the alt should be content.
60. `MarketplaceListingCard.jsx:155-160` — minor inconsistency.
61. `ImageLightbox.jsx:65-69` — generic alt; acceptable.

### Build-pipeline gaps (62-71)

62. `craco.config.js` has no image optimization.
63. No responsive-image generation pipeline.
64. `vercel.json` lacks cache headers for `/api/sitemap.xml`.
65. `/static/*` and `/images/*` cache headers are correct.
66. `.avif` files don't need separate cache rule.
67. `tailwind.config.js` content paths are correct.
68. `tailwind.config.js:69-76` — `container` extension + `background.DEFAULT` collision.
69. `build/` is correctly gitignored.
70. `audit:media` script exists but not wired into CI.
71. No `404.html` or SPA fallback status.

---

## 10. OCR + Vision Microservices Audit (42 findings)

**Subagent: microservices / ML deployment specialist.**

### Cold-start / scale issues (1-7)

1. PaddleOCR model downloaded at runtime, not at build time. `ocr-service/Dockerfile:19-28` doesn't invoke `download_models.py`. Each new replica pays ~50-100 MB download on first `/scan` cold start.
2. Vision-service cold start is ~2 GB. `vision-service/app.py:48-71` loads NudeDetector + OpenCLIP ViT-B-32 + torch + onnxruntime.
3. `EXPOSE` port mismatches actual bind port in both services. ocr-service declares `EXPOSE 8080`, README says **8000**. Same for vision-service.
4. No horizontal worker startup strategy / shared model cache. Each gunicorn worker loads independent copy of model. No preload hook.
5. `VISION_MAX_CONCURRENCY=1` (`vision-service/.env.example:10`) — vision-service is effectively single-threaded per worker.
6. Memory foot-gun: per-worker RSS × N workers. At `GUNICORN_WORKERS=2`, vision-service RSS ceiling is ~4 GB; OCR at ~1 GB. No `max_requests` to recycle workers.
7. No `IMAGE_MAX_IMAGE_PIXELS` raised to fit modern phone photos. `OCR_MAX_IMAGE_PIXELS=25000000` (~5000×5000).

### Auth / security (8-13)

8. Timing-attack vulnerable key comparison (`==`). Both `ocr-service/app.py:125` and `vision-service/app.py:136` use `!=` / `==` instead of `hmac.compare_digest`.
9. Default `OCR_SERVICE_KEY=""` causes blanket 401. No startup validation.
10. Vision-service bound to `[::]:8080` with no auth on `/health`. Returns model fingerprint.
11. README's "no public domain" requirement is unenforced.
12. No `X-OCR-Service-Key` rotation story.
13. `cv_image = np.asarray(image)[:, :, ::-1].copy()` leaves full decoded RGB frame on heap. 5000×5000 = ~75 MB per request × N concurrent.

### Concurrency / backpressure (14-19)

14. `OCR_MAX_CONCURRENCY=2` semaphore + 20s queue timeout returns 503; backend retries only once. No backoff, no jitter.
15. `VISION_MAX_CONCURRENCY=1` is even tighter than OCR. Backend `vision_service.py:36-41` does **no** retry on 503.
16. **`_infer_lock` (`ocr-service/app.py:47,94`) serialises inference behind a single mutex regardless of `OCR_MAX_CONCURRENCY=2`.** The semaphore is effectively decorative.
17. `OCR_QUEUE_TIMEOUT_SECONDS=20` but per-attempt `OCR_SERVICE_TIMEOUT_SECONDS=8`. Decoupled timeouts.
18. Gunicorn worker timeout 120s vs semaphore 20s — second request out of 5 will hit gunicorn.
19. `LocalVisionProvider.analyze()` lazy-loads on every first call per process. Two concurrent first-calls will each instantiate `NudeDetector()` and Haar cascade.

### Backend integration (20-25)

20. `PaddleOCRServiceProvider.extract` retries on transient errors but not on hard 503-with-body. No `time.sleep` backoff.
21. `VisionServiceClient.analyze()` blocks the request thread for up to 12s. Backend's 12s client timeout is **less** than the service-side semaphore timeout (20s) — server work is wasted.
22. `PaddleOCRServiceProvider` reads the entire image into memory twice.
23. `OCR_SERVICE_ATTEMPT_TIMEOUT_SECONDS=8` defaults lower than what real OCR runs need. PaddleOCR p99 inference is 5-10s. The 8s attempt cap is **below** p99 inference.
24. No circuit breaker around either service.
25. OCR service has no `/metrics` or queue-depth reporting.

### Dockerfile / deploy (26-33)

26. `download_models.py` ships in the image but is never invoked.
27. `pip install paddlepaddle==2.6.2 paddleocr==2.8.1` pulls native wheels with no build isolation.
28. Both Dockerfiles run `pip install --upgrade pip setuptools wheel` — non-reproducible.
29. `PATH=/opt/venv/bin:$PATH` baked into image.
30. No multi-stage build.
31. `appuser` has no `/app` write permission.
32. No `--keep-alive`, no `--access-logfile -`.
33. `vision-service/Dockerfile` lacks `Pillow` libimagequant/libjpeg-turbo.

### Observability gaps (34-42)

34. No structured logging in either service.
35. No request IDs / correlation IDs.
36. No metrics endpoint.
37. `/health` on vision-service suppresses failure detail.
38. `vision-service/app.py:155` logs without context.
39. Backend integration never logs the OCR/Vision round-trip latency.
40. No log level for `_semaphore` contention.
41. `LocalVisionProvider._ensure_loaded` is silent on lazy-load cost.
42. `registration_ocr.py:106-108` does not log retry attempts.

---

## 11. Email / Push / Webhook Deliverability Audit (52 findings)

**Subagent: email/push/webhook deliverability specialist.**

### Email deliverability / idempotency (1-10)

1. **No idempotency on listing status emails** — every transition re-sends.
2. `outbound_emails` is logged *after* the Resend API call — post-call DB insert failure = silent duplicate on retry.
3. Listing approval resets `expiry_reminder_sent_at`/`expired_email_sent_at` to NULL but does not reset any "approval email sent" column.
4. Auto-review worker re-sends the rejection email on every run.
5. Renewal endpoint always sends "renewed" status email; no idempotency on re-renewal.
6. Renewal nudge throttle return-shape mismatch — `sms_ok, sms_resp = _send_renewal_nudge_sms(...)` packs dict into sms_resp.
7. Saved-search/draft/saved-car reminders rely on advisory claim columns, not unique constraints.
8. Price-drop worker has no DB-level dedupe; concurrent drops for the same `(listing, new_price)` notify twice.
9. Listing auto-review path uses `actor` parameter — but no email-claim row.
10. Bulk admin delete re-sends deletion emails for each row with no idempotency.

### Resend webhook (11-15)

11. Signature verification has no timestamp / replay protection.
12. **Signature comparison is NOT timing-safe** (`==`).
13. Signature path is optional (`if webhook_secret`).
14. Webhook does not dedupe by `event_id`.
15. Open/click counts use read-then-write — race condition.

### Push notification (16-20)

16. `expo_push.send_expo_push` silently truncates to 100 tokens.
17. No retry on Expo push failure.
18. Mobile push token registration has no failure surfacing.
19. Mobile `console.log` of redirect URL runs in production.
20. Unregister on logout races the register on login.

### Webhook delivery / signing / safety (21-30)

21. Worker has no post-success idempotency check.
22. Backoff schedule maxes out at 12 hours; receiver downtime beyond that loses the event.
23. `_bounded_response_text` truncates to 500 bytes without PII scrubbing.
24. DNS rebinding: hostname is resolved at *registration*, not at *delivery* (mitigated, verified).
25. Cross-origin redirects: VERIFIED CLEAN.
26. Dealer webhook creation does not enforce HTTPS.
27. No per-dealer webhook rate limit.
28. Dealer webhook payload includes plaintext `X-DPH-Delivery` and `X-DPH-Event` headers.
29. `webhook_signing.sign` uses non-constant-time hex digest.
30. `url_safety.assert_safe_outbound` blocks reserved ranges but accepts IPv6 ULA — VERIFIED CORRECT.

### Rate-limit gaps (31-33)

31. No outbound rate limit on Resend calls.
32. No outbound rate limit on Expo push.
33. WhatsApp / SMS (MSG91) rate limits declared but never enforced.

### PII / bounce / unsubscribe handling (34-43)

34. `outbound_emails.bounced_at`, `.spam_at`, `.unsubscribed_at` are written but never read for suppression.
35. **No `List-Unsubscribe` header in any email** — Gmail bulk-sender compliance.
36. `subject` field in contact form is interpolated raw into the email header.
37. Contact form `reply_to: email` lets the user supply any RFC-822-ish string.
38. Contact form `name` is interpolated raw into the email body.
39. **`_send_listing_status_email` injects `rejection_note` and `rejection_fix` raw into HTML** — admin XSS.
40. `_send_info_request_email` interpolates admin-supplied `documents` and `message` raw.
41. Listing title rendered raw in multiple status emails.
42. `webhook_delivery_worker._bounded_response_text` stores arbitrary receiver output in DB.
43. `last_response_body` exposed in the deliveries endpoint has no auth gate beyond dealership scope.

### Template / content issues (44-52)

44. No shared header/footer template — every email is its own inline-styled HTML.
45. **Most emails are HTML-only — no multipart text/plain.** Gmail bulk-sender guidance violation.
46. URLs in some templates are relative, not absolute.
47. Unsubscribe link is missing entirely.
48. Renewal nudge throttle is admin-only, not user-respecting.
49. Listing-deletion email hardcodes the support address as plain text.
50. Renewal nudge URL includes a tracking param `?utm_source=admin_nudge` — privacy leak.
51. `_send_draft_listing_reminder` and `_send_listing_draft_reminder_email` send up to 3 reminders in 48h with no user preference check.
52. Subject rotation is week-keyed, not per-user.

---

## 12. Postgres Migration Audit (91 findings)

**Subagent: Postgres migration / DDL specialist.**

### Migration noise (1-7)

1. `fix_security_issues.sql` vs `_v2.sql` vs `_FINAL.sql` — none is canonical. **3 live `is_admin()` signatures** plus a 4th SQL body.
2. `fix_performance_issues.sql` vs `_v2.sql` vs `_FINAL.sql` — if `_FINAL.sql` ever replaced the no-arg plpgsql with the parameterised version, **every one of those policies would fail**.
3. `COMPLETE_SCHEMA_FIX.sql` vs `00_COMPLETE_SCHEMA.sql` vs `COMPLETE_DATABASE_FIX.sql` — byte-similar but `00_COMPLETE_SCHEMA.sql` is **strictly a superset**.
4. `enhance_user_profiles.sql` vs `enhance_user_profiles_FIXED.sql` vs `COMPLETE_DATABASE_FIX.sql` — 3 versions adding nearly-identical columns to `public.users`.
5. `2026_06_08_dealer_info_requests.sql` vs `supabase/migrations/20260818010000_dealer_info_requests.sql` — **identical content, two months apart**.
6. `2026_06_05_dealer_leads.sql` vs `2026_06_05_DEALER_PANEL_PHASES_2_3_4_COMBINED.sql` — COMBINED file is **byte-identical** to per-phase file for Phase 2.
7. Cross-folder duplicates (push_tokens, outbound_emails, car_images is_primary, composite indexes).

### Type drift (8-20)

8. `cars.country_code` — TEXT vs VARCHAR(10).
9. `cars.vin_number` — 3 sizes: VARCHAR(50), VARCHAR(255), VARCHAR(17).
10. `bikes.vin_number` — VARCHAR(255) then VARCHAR(17).
11. `bikes.price` — INT vs DECIMAL(10,2).
12. `bikes.price` index points at a deleted column.
13. `cars.focal_x` / `focal_y` — NUMERIC(5,2) vs double precision.
14. `users.username` — VARCHAR(50) vs VARCHAR(100).
15. `users.phone` — VARCHAR(20) vs VARCHAR(30).
16. `users.phone_number` and `users.phone` are dual-written via trigger.
17. **`cars.expected_selling_price` is INT (no price constraint)** — no CHECK enforces `> 0`.
18. `users.account_status` constraint vs `users.banned_at` column — two sources of truth for "banned".
19. `users.is_admin` vs `users.is_super_admin`.
20. `dealerships.owner_user_id` is NOT NULL FK with no ON DELETE.

### Function drift (21-29)

21. `is_admin()` — **3 live signatures** + 1 SQL body.
22. `handle_new_user` — **7 divergent bodies**.
23. `calculate_profile_completion` — 5 distinct scoring systems.
24. `dealer_users` VIEW — **7 distinct column lists**.
25. `sync_car_image_urls` / `sync_bike_image_urls` — 3 bodies, one is broken.
26. `set_user_id` — orphan trigger function.
27. `featured_listings_touch_updated_at` — purpose?
28. `record_analytics_event` — 3 successive bodies.
29. `update_reports_updated_at` — duplicated.

### FK / CASCADE gaps (30-48)

30. `car_images.car_id REFERENCES cars ON DELETE CASCADE` — set but soft-delete never triggers it.
31. `bike_images.bike_id REFERENCES bikes ON DELETE CASCADE` — same.
32. `part_images.part_id` and `plate_images.plate_id` — same.
33. `dealer_documents.user_id REFERENCES users ON DELETE CASCADE` — but storage objects orphaned.
34. `dealer_documents.reviewed_by` — ON DELETE SET NULL. Good.
35. **`dealerships.owner_user_id` — no cascade.** Inconsistent with `dealership_members.user_id` (CASCADE).
36. `dealership_invitations.invited_by` — no cascade.
37. `lead_events.user_id` — no cascade.
38. `listing_deletion_events.deleted_by` — no cascade.
39. `dealer_inventory_jobs.triggered_by` — SET NULL. Good.
40. `dealer_leads.assigned_to` — SET NULL. Good.
41. `platform_events.user_id` — no FK.
42. **`cars.user_id UUID` — no FK constraint.** `cars_schema.sql:4` comment: "Removing the foreign key constraint for now."
43. `bikes.user_id`, `car_parts.user_id`, `license_plates.user_id`, `buying_requests.user_id` — same.
44. `dealer_info_requests.dealer_user_id` — CASCADE. Good.
45. `dealer_info_requests.requested_by` — SET NULL. Good.
46. `users_trn_unique` — unique index partial. Good.
47. `featured_listings.featured_by` — SET NULL. Good.
48. `dealer_listing_upgrade_requests.resolved_by`, `dealer_listing_limit_history.changed_by` — proper CASCADE/SET NULL. Good.

### Redundant indexes (49-63)

49. `idx_cars_status` created 3 times with different names.
50. `idx_cars_price` (single-column) — created and dropped in different files.
51. `idx_cars_make_year` — created then dropped.
52. `idx_cars_status_created` — created in 3 places.
53. `idx_users_is_admin` — multiple partial indexes.
54. `idx_users_username` — created and dropped.
55. `idx_bikes_wheels` — orphan index.
56. `idx_cars_price_year` and `idx_cars_manufacturer_model`.
57. `idx_lead_events_listing` — column-order drift.
58. `idx_cars_user_id` — created 3 times (idempotent).
59. `idx_car_images_car_id` — created 3 times (idempotent).
60. `idx_plates_status` — name conflict.
61. `idx_car_images_cropped_at_null` partial indexes.
62. `idx_lead_events_user_id` — single, covered by composite.
63. `idx_users_email` — created and dropped.

### CHECK constraint mismatches (64-83)

64. `status CHECK` — value drift across listing tables.
65. **`sold_status CHECK excludes 'no_response'`** — `backfill_no_response_sold_status_20260629.sql:16` writes it. Will fail with 23514.
66. `lead_events.listing_type CHECK` — 5 values, OK.
67. `listing_deletion_events.listing_type CHECK` — 5 values after `_buying_request` addition.
68. `dealer_leads.listing_type CHECK` vs `dealer_lead_aggregator_cursor` — `price_drops.listing_type CHECK` uses **PLURAL** table names (`'cars'`, `'bikes'`, `'car_parts'`, `'license_plates'`) vs. singular in other tables.
69. `dealer_listing_upgrade_requests.status CHECK`.
70. `dealer_pending_approvals.state CHECK`.
71. `featured_listings.listing_type CHECK`.
72. `auto_review_decisions.decision CHECK`.
73. `moderation_labels.label CHECK`.
74. `listing_verification_scans` — no CHECK on `listing_type`.
75. `users.account_status` constraint values.
76. `users.dealer_application_status CHECK`.
77. `expected_selling_price > 0` — no CHECK.
78. `bikes.cylinders` CHECK.
79. `cars.listing_title` NOT NULL.
80. `users.trn` length.
81. `dealer_documents.document_type CHECK` — still allows `company_registration` after the 2-doc requirement.
82. `dealer_info_requests.status CHECK`.
83. `is_admin` — no CHECK (BOOLEAN).

### RLS / permission gaps (84-91)

84. `is_admin` policies use `is_admin()` no-arg, but only one of three signatures takes no args.
85. `is_admin()` and `is_admin(user_id)` — both are SECURITY DEFINER, both executable by `authenticated`. Malicious authenticated client can probe admin status.
86. `record_analytics_event` REVOKE chain.
87. `20260828000001_security_hardening.sql` — drops service_role_all policies but the function is still SECURITY DEFINER.
88. `dealer_users` VIEW — no SECURITY INVOKER.
89. `apply_rls_policies.sql` (project root) — has `current_setting('request.jwt.claim.role', true) = 'service_role'`.
90. **`apply_rls_policies.sql` references tables that don't exist** — `public.dealers` (real is `public.dealerships`).
91. `apply_rls_policies.sql` policies are world-readable.

---

## Cross-Cutting Recommendations (Aggregated)

### Top 10 P0/P1 fixes by ROI

1. **Split `app.py` into feature blueprints** (eliminates the 25k-line monolith). Save ~5s on every dev cycle.
2. **Add `.github/workflows/ci.yml` that runs `pytest`** — the 95 test files are already there.
3. **Replace per-row sweep functions with 3 bulk SQL stored procedures** for listing expiry, listing lifecycle, and dealer doc expiry. **Save 10–100s of round-trips per tick** at scale.
4. **Lazy-load the 9 synchronous dealer pages + remove `motion/react` from initial bundle** — save ~200–400 KB gz.
5. **Add `dealer_documents(user_id, replaced_at)` and `users(is_dealer, created_at)` partial indexes** — the 3 "partial coverage" gaps.
6. **Add `(listing_id, listing_type, created_at DESC)` index on `lead_events` and `listing_deletion_events`** — fixes 8 hot-path scans.
7. **Replace `axios` with `fetch` in `authService.js`** — save ~17 KB gz.
8. **Convert `favicon.ico` to a real ICO** and align manifest cache-busters.
9. **Add `image-minimizer-webpack-plugin` to `craco.config.js`** — generate AVIF/WebP at build.
10. **Set `worker.py` SIGTERM handler + add leader election** (Postgres advisory lock per worker type).

### Most dangerous single file

**`backend/app.py`** is the worst single file in the entire repo: 25,747 lines, 177 routes, 6+ variant functions, 4+ N+1 patterns in hot paths, multiple dead-code blocks, missing imports, broken claims, and the only file that has both `_send_infobip_sms` that always raises and `_send_renewal_nudge_sms` that doesn't exist. The single highest-leverage refactor is to break this into 8–10 blueprints by feature (auth, listings, admin, dealer, user, profile, ocr-proxy, vision-proxy, public).

### Dead weight to delete today

- `frontend/src/assets/images/*` (2.0 MB)
- `frontend/public/images/plates/*` (281 KB)
- `frontend/public/images/optimized/*` (852 KB)
- `frontend/public/images/About-page.avif` (548 KB)
- `frontend/public/images/IMG_3391.avif` (619 KB)
- `frontend/public/instagram.png` (5 KB)
- `frontend/public/redditlogo.png` (58 KB)
- `mobile/examples/native-tabs-liquid-glass/`
- `mobile/src/screens/home/HomeScreen.js` (362 lines, not routed)
- 3 of `fix_performance_issues.sql/_v2/_FINAL.sql` (keep only _FINAL)
- 3 of `fix_security_issues.sql/_v2/_FINAL.sql` (keep only _FINAL)
- `apply_rls_policies.sql` (references non-existent `public.dealers`)
- `setup_storage_bucket.py`, `debug_supabase.py`, `diagnose_auth.py` if dev-only (move to `scripts/`)
- `react-router` from `frontend/package.json` (unused)
- `@tensorflow-models/blazeface` from `frontend/package.json` (only in test mock)
- `html2canvas` from `frontend/package.json` (not imported)
- `react-native-fs` from `mobile/package.json` (replaced by `expo-file-system`)
- The "ocr-service bakes OCR_LANG=en" claim in the audit prompt is **false** — it's runtime only.
- The "lucide-react 1.x doesn't exist" claim in the audit prompt is **false** — it does.

---

**End of deep-dive audit. Combined with `auditissues.md`, this is the complete audit corpus. No code was changed.**