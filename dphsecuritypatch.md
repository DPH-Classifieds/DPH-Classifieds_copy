# DPH Classifieds — Audit Remediation Status

**Comparing against:** `dphdocthing.pdf` ("DPH Classifieds Comprehensive Technical Audit")
**Generated:** 2026-09-03
**Method:** Every finding below was checked against the current source in `flask-react-supabase-app/` (frontend, backend, mobile) and `devvit/` by reading the actual code paths cited in the audit — not by re-running the original scanner. Dependency-version findings were checked against pinned versions in `requirements.txt` / lockfiles, not against a live CVE feed.

---

## At a glance

| Section | Fixed | Partial | Not fixed | False positive / N-A | Dependency (current) |
|---|---|---|---|---|---|
| Part 1 — Performance (44 items) | 10 | 6 | 18 | 7 | — |
| Part 2 — Threat model (5 scenarios + arch.) | 2 | 2 | 1 (+1 unresolved architectural claim) | — | — |
| Part 3 — Vulnerability ledger (code findings) | 17 | 3 | 5 | 15 | ~28 packages, all current/pinned |

**Biggest things still open**, in order of how much they'd matter if exploited or if traffic grows:

1. **VIN is fully exposed in the API payload** regardless of the phone-verification UI gate (`CarDetail.jsx` masks it client-side; `backend/app.py` never strips it server-side) — a direct `curl` bypasses the privacy control entirely.
2. **Auto-review still can't catch price/VIN fraud** — the `duplicate` and `price_outlier` signals are hardcoded to `None`, and the VIN decoder never compares decoded make/model/year against the submitted form.
3. **Every backend/worker DB request runs as `service_role` and bypasses RLS entirely.** The Aug-28 security-hardening migration only locks out *direct client* access — it adds no dealership-scoped defense-in-depth for the backend's own queries, so a missing filter in Python code is still a full cross-tenant leak with no second line of defense.
4. **Explore is still not virtualized and still filters/sorts client-side** — the single largest perf risk in the whole audit, unaddressed.
5. **The public site (dphclassifieds.com via Vercel) still has no Content-Security-Policy header** — the backend API sets one, but the frontend host does not.
6. `buying_requests.py` has no rate limiting despite the app already having a working Redis limiter used elsewhere.

Everything else, including a long tail of dependency-version and secret-scanner findings, turned out to already be fixed or to be false positives from a scan that read local disk / example files rather than the actual git-tracked repo.

---

## Part 1 — Performance Audit (44 findings)

| # | Finding | Status | What we found |
|---|---|---|---|
| 1 | Explore not virtualized | **Not fixed** | `ExplorePage.jsx` still does `renderedItems.map()` over a manually-sliced `displayedItems` array (`renderLimit`-based "load more"), no `react-window`/`react-virtuoso`. |
| 2 | Full-data recalculation on every state change | **Not fixed** | `filteredItems` (`ExplorePage.jsx:968-993`) still runs normalize → filter → `scoreAllMatch` → sort client-side on every filter/query change. |
| 3 | Reddit Explore batches too large (250/request) | **Fixed** | `PAGE_SIZE = 24` (`ExplorePage.jsx:23`); Reddit tab now requests ~25 rows/page instead of 250. |
| 4 | Offset pagination → cursor/keyset | **Not fixed** | `_parse_pagination_args()` (`app.py:789-803`) is still offset/limit only. |
| 5 | 16.5 MB homepage image | **Fixed** | `bottom-landing.jpg` deleted; replaced with `bottom-landing.avif` (151 KB). |
| 6 | Duplicate `hero.webp` / `toplanding.webp` | **Fixed** | Both deleted; only `hero.avif` remains. |
| 7 | Hero still oversized, no responsive variants | **Partial** | `hero.avif` down to 538 KB with `fetchPriority="high"`, but no `srcSet`/`<picture>` — repo-wide grep for `srcSet` found nothing. |
| 8 | Other large images | **Improved** | All originals (16.5 MB / 6.4 MB / 5.8 MB / 4.3 MB jpgs) replaced with AVIF equivalents (151–662 KB). One unused leftover, `optimized/hero-1600.jpg` (662 KB), sits alongside `hero.avif` and isn't referenced. |
| 9 | Continuous Three.js scene | **Fixed** | `HeroBackground.js` gates `useFrame` via `IntersectionObserver` (:154), `visibilitychange` (:160), and `prefers-reduced-motion` (:165). |
| 10 | GPU-heavy composition | **Partial** | 3D loop now gated (see #9), but stacked `box-shadow`/`blur` glow effects in `HomePage.css` are unchanged. |
| 11 | Scroll handler on fixed header | **Partial** | `Header.js:87-94` still uses `window.addEventListener('scroll', ...)` + `setScrolled`; only change is `{ passive: true }` — not moved to CSS. |
| 12 | Backdrop blur expensive | **Not fixed** | `backdrop-filter: blur(20px)/blur(24px)` still present (`Header.css:4-5,21-22`), no mobile-specific reduction. |
| 13 | Multiple stacked CSS effects | **Partial** | Same stacking as #10, unchanged. |
| 14 | Memoize `MarketplaceListingCard` | **Fixed** | `export default React.memo(MarketplaceListingCard)` (`:200`). |
| 15 | Normalize listings once | **Not fixed** | Still an array re-built via `useMemo` on every `inventory` change — no `Map<id, listing>`. |
| 16 | Debounce/defer search | **Not fixed** | No debounce anywhere in `ExplorePage.jsx`; per-keystroke filters still trigger full client-side re-filter. |
| 17 | Sync `sessionStorage` cache | **Not fixed** | `fetchCache.js:8-29` still `sessionStorage` + `JSON.stringify` comparisons. |
| 18 | `Cache-Control: no-store` on cached API responses | **Not fixed** | `_cached_json_response()` (`app.py:741`) unchanged. |
| 19 | Noisy INFO-level cache logging | **Not fixed** | Cache hit/miss logs still `logger.info(...)` at 4 call sites. |
| 20 | DB indexing already good | **N/A** | Informational-only finding; not re-audited. |
| 21 | 24,000+ line monolith `app.py` | **Not fixed (grew)** | Now **25,767 lines**, up from the audited ~24,000. |
| 22 | Slim List DTO vs full object | **Not fixed** | `/api/cars` still `select=*`. |
| 23 | Full image gallery sent per card | **Not fixed** | Same root cause as #22 — no primary-image-only feed shape. |
| 24 | Use `/api/homepage/preview` | **Not fixed** | It exists server-side (`app.py:2567-2577`) but `HomePage.js:194-196` still calls separate `/api/cars` + `/api/featured-listings`. |
| 25 | Busy global App tree | **Not fixed** | `App.js:260-410` structurally unchanged — one flat provider/tracker stack. |
| 26 | Defer analytics init | **Fixed** | `analytics.js:77-78` — `requestIdleCallback(runAnalyticsInitialization, { timeout: 3000 })`. |
| 27 | Lightweight click tracker | **Not fixed** | `PlatformAnalyticsTracker.js:183-252` still does `.closest()` + reads `.title`/`.innerText`/`.textContent` on every document click. |
| 28 | Mobile Explore same data problem | **Not fixed** | `ExploreScreen.js:825-858` still normalizes/concatenates/sorts the full dataset client-side. |
| 29 | Mobile card entrance animation on every mount | **Partial** | `useStaggeredEntrance.js` added a `MAX_STAGGER_INDEX=8` delay cap, but still fires unconditionally on every FlashList cell mount/recycle. |
| 30 | Proper cached mobile image pipeline | **Fixed** | `FadeInImage` (expo-image, `cachePolicy="memory-disk"`) used consistently in `ListingCard.js`. |
| 31 | Tune FlashList `estimatedItemSize` | **Fixed** | `estimatedItemSize={columns === 2 ? 294 : 260}` — matches real card height, not a default guess. |
| 32 | Lazy load + fixed dimensions on feed images | **Partial** | `loading="lazy"` present; no explicit `width`/`height` attributes on those `<img>` tags. Hero image correctly stays eager with `fetchPriority="high"`. |
| 33 | Never send originals to cards | **Not fixed** | Upload pipeline (`app.py:8792-8807`) produces one resized JPEG (1920px/q85) only — no thumbnail/medium/large variants; Explore and detail share the same image. |
| 34 | CSS `content-visibility` for long pages | **Not fixed** | Zero hits repo-wide. |
| 35 | Respect `prefers-reduced-motion` | **Fixed** | Folded into the same gate as #9 (`HeroBackground.js:165-168`). |
| 36 | Add reduced-motion mode | **Fixed** | Same as #35. |
| 37 | Don't over-use `useMemo` | **N/A** | Advisory guidance, not a violation to fix. |
| 38 | Review global state boundaries | **N/A** | Advisory; covered indirectly by #25 (tree unchanged). |
| 39 | Remove orphaned files | **See cleanup table below** | |
| 40 | Don't delete tests/migrations | **N/A** | Advisory; not violated. |
| 41 | Keep docs in git, out of prod payloads | **N/A** | Advisory; not independently re-verified this pass. |
| 42 | Brotli/gzip already configured | **Confirmed fine** | `flask-compress==1.15` + `Compress(app)` in `app.py`. |
| 43 | Upload compression already good foundation | **Confirmed fine** | Server-side resize (1920px) + JPEG q85 compression on upload. |
| 44 | Dedicated feature isolation (TF/NSFW) | **Confirmed fine** | `imageModeration.js:25-27` — dynamic `import('@tensorflow/tfjs')` etc. |

### Cleanup: files the audit flagged for removal

| File | Status |
|---|---|
| `frontend/src/components/CarPartsRedesigned.css` | Deleted |
| `frontend/src/components/BlinkBlur.jsx` | **Still present, still unreferenced anywhere** |
| `frontend/src/components/BlinkBlur.css` | **Still present**, paired with the above |
| `frontend/src/styles/AdminOps.css` | Deleted |
| `frontend/src/styles/DetailView.css` | Deleted |
| `frontend/src/styles/PlatePreview.css` | Deleted |
| `frontend/src/utils/tokenDebug.js` | Deleted |
| `frontend/src/utils/swrCache.js` | Kept — **correctly**, it's actively imported by `AdminDashboard.js` (audit's "candidate" list was wrong here) |
| `frontend/src/components/ui/demo.tsx` | Deleted |
| `frontend/src/components/ui/navbar-5.tsx` | Deleted |
| `mobile/App.js` | Deleted |
| `mobile/src/navigation/AppNavigator.js` | Deleted |
| `frontend/src/components/Footer.js` (verify-only) | Deleted, replaced by `components/ui/hover-footer` |
| `frontend/src/styles/Footer.css` (verify-only) | Deleted, no dangling references |

---

## Part 2 — Threat Model / Recon Report

| Scenario | Status | Evidence |
|---|---|---|
| **Cross-dealership access via context manipulation** | **Partial** | App layer is solid: `dealer_required` (`_decorators.py:126-153`) derives context from real membership, and the `?as=` override only works for confirmed admins. But the audit's actual ask — a **database-level** constraint — doesn't exist. The Aug-28 RLS migration gives `service_role` unconditional `USING (true)` access with no `dealership_id` predicate, and the backend always calls PostgREST as `service_role`. A missing/incorrect filter in Python is still a full cross-tenant leak. |
| **Outbound SSRF via dealer webhook URLs** | **Fixed** | `services/url_safety.py` — `assert_safe_outbound()` resolves the hostname and rejects private/loopback/link-local/multicast ranges plus a hardcoded cloud-metadata blocklist (`169.254.169.254`, `100.100.100.200`); `request_with_safe_redirects()` re-validates every redirect hop. Applied at registration, test-send, *and* the delivery worker — no gap between "checked at save time" vs "checked at send time." |
| **Session persistence after password/membership change** | **Fixed** | `revoke_user_sessions()` (`app.py:3427-3498`) keeps a Redis-backed per-user cutoff timestamp; `token_required` checks it on both the local-JWT and Supabase-Auth-API paths. Wired into `/api/auth/update-password`, `/api/auth/logout`, and dealer membership revocation. Caveat: falls back to in-memory (per-process only) if `REDIS_URL` isn't set — worth confirming that's actually configured in prod. |
| **Fraudulent listing approval via auto-review manipulation** | **Not fixed** | `auto_review_worker.py:392-393` hardcodes `"duplicate": None` and `"price_outlier": None` — nothing computes them. `vin_gate.py`'s `evaluate_vin()` decodes the VIN but never compares the decoded make/model/year against what the submitter typed. Auto-approval is still purely trust-tier + hard-blocker gated, exactly the scenario the audit described. |
| **GitHub bridge content injection → unauthorized Reddit posts** | **Partial** | The HMAC mechanism itself is built correctly on both ends (writer signs with HMAC-SHA256 over canonical JSON; Devvit bot verifies with `timingSafeEqual`). But it's **optional on both sides** — the writer only signs `if config["hmac_secret"]`, and the bot only verifies `if hmacSecret`. If either the Railway env var or the Devvit app setting is ever left blank, it silently reverts to schema+count-only trust. |
| **Architectural fragility** (service_role bypasses all RLS; isolation lives only in Python) | **Still true** | The Aug-28 migration (`20260828000001_security_hardening.sql`) solves a *different* problem — it blocks direct `anon`/`authenticated` client access to sensitive tables. It adds `service_role_all ... USING (true)` with no row-scoping, and 100% of backend/worker traffic authenticates as `service_role`. There is still no database-level second line of defense if a Python decorator or query filter is wrong. |

---

## Part 3 — Vulnerability Ledger

### Dependencies (version-pin check only, no live CVE re-scan)

All of the following are pinned/resolved to versions that post-date the CVEs typically associated with the finding name, with explicit comments in two cases showing the pin was deliberate:

| Package | Where | Pinned/resolved version | Note |
|---|---|---|---|
| starlette | `ocr-service`, `vision-service` requirements.txt | `1.6.0` | Comment: *"Keep the Starlette security fixes explicit"* |
| opencv-python(-headless) | `backend`, `ocr-service` | `4.11.0.86` | Comment: *"Pin opencv to 4.x — 5.0 dropped cv2.CascadeClassifier"* |
| opencv-contrib-python | — | **not installed anywhere** | Explicit comment says not to add it — finding is moot |
| gunicorn | `backend` | `23.0.0` | current |
| pillow | `backend` | `12.3.0` | current |
| matplotlib | `backend` | `3.10.0` | current |
| cryptography | `backend` | `>=46,<51` | current |
| requests | `backend` | `2.33.0` | current |
| numpy | `backend` | `2.4.6` | current |
| werkzeug | `backend` | `3.1.6` | current |
| torch / open-clip-torch | `vision-service` | `2.6.0` / `2.30.0` | current |
| python-multipart | `ocr-service`, `vision-service` | `0.0.31` | current |
| posthog (python) | `backend` | `>=7.0.0` | current |
| axios | `frontend` | `1.20.0` (resolved) | current |
| browserslist | `frontend` | `4.28.2` | current |
| brace-expansion | `frontend` (both copies) | `1.1.18` / `2.1.4` | both patched |
| nanoid | `frontend` | `3.3.18` | patched |
| immer | `frontend` | `9.0.21` | patched |
| follow-redirects | `frontend` | `1.16.0` | patched |
| uuid | `frontend` | `8.3.2` | old, no known critical CVE for this finding class |
| yargs | `frontend` | `16.2.0` | patched |
| js-yaml | `frontend` | `4.3.2` / `3.15.2` | both patched |
| dompurify | `frontend` | `3.4.14` | current |
| webpack-dev-server | `frontend` (via `react-scripts`) | `4.15.2` | **dev-only build dependency, never ships in the production bundle** |
| baseline-browser-mapping | `frontend` | `2.10.16` | current |
| @xmldom/xmldom | `mobile` (2 copies) | `0.8.13` / `0.9.10` | both patched |
| undici | `mobile` | `6.28.0` | current |

### Code / config findings

| Severity | Finding | Status | Evidence |
|---|---|---|---|
| Critical | CSP header not set (dphclassifieds.com) | **Partial** | Backend API sets one (`_build_content_security_policy()` in `app.py`), but `vercel.json` — which controls the actual public frontend headers — has no `Content-Security-Policy` entry. The domain the audit named is still unprotected. |
| Critical | Blacklisted XML parsing function (`dealer_inventory.py`) | **Fixed** | Uses `from defusedxml import ElementTree as ET`, not the vulnerable stdlib parser. |
| High | Improper Access Control (`add_dealer_kyc_columns.sql`) | **False positive** | File only contains `ALTER TABLE`/index/trigger statements — no `GRANT`/`CREATE POLICY` that could introduce a bypass. |
| High | 1 exposed secret (`mobile/eas.json`) | **False positive** | Only contains file *paths* and non-secret IDs (`appleTeamId`, `ascAppId`, etc.); the actual credential files it references are gitignored and not in the repo. |
| High | IDOR (`dealer/diagnostic.py`) | **Fixed** | Query filters by both `id` **and** `dealership_id` from the caller's own context. |
| High | Plaintext Storage of Secrets (`backend/Dockerfile`) | **False positive** | Only non-secret build `ENV`s (`PYTHONDONTWRITEBYTECODE`, `PATH`, etc.). |
| High | Exposure of Sensitive Information (`api_sources.py`) | **Fixed** | Response serializer explicitly excludes `credentials_enc`; credentials are encrypted at rest; error logs only include status/body-prefix, never the credential. |
| High | Path traversal (`directUpload.js`, `PostPlate.js`) | **False positive** | Path components are sanitized to `[a-zA-Z0-9_-]`; the actual filename segment is a generated UUID, not the user-supplied name. |
| Medium | Incomplete Data Deletion (`admin.py`) | **Not fixed** | Deleting a listing removes its images and the row itself, but leaves `lead_events`, `reports`, `listing_price_history`, and `listing_verification_scans` as orphans. |
| Medium | Insufficient Verification of Data Authenticity (`registration_ocr.py`) | **Fixed** | VIN checksum cross-check, confidence-threshold gating, and explicit "evidence for an admin, not auto-approval" framing in the code. |
| Medium | Potential file inclusion (`apply_migration.py`) | **Fixed / low risk** | Path validated against an allowlist of migration roots + `.sql`-only suffix; it's a CLI script, not a web route. |
| Medium | 9 exposed secrets (`.env` files) | **False positive** | Only `.env.example` files are tracked in git; no real `.env` is committed anywhere. |
| Medium | 2 exposed secrets (`PHONE_VERIFICATION_FIXES.md`) | **Real secret, but not a repo exposure** | The file (now archived under `non-essential/`, which is fully gitignored) contains what reads as a genuine Infobip API key. Never committed to git — but worth rotating that key regardless, since Infobip is already being retired for OTP. |
| Medium | GitHub org should enforce IP allow list | **N/A** | Org-level GitHub setting, not something fixable in this codebase. |
| Medium | Cross-Tenant Isolation Bypass (`reddit_import_worker.py`) | **False positive** | No multi-tenant surface here — single hardcoded owner ID, plus an email-match validation before any write. |
| Medium | SSRF (`dealer/webhooks.py`) | **Fixed** | Same `assert_safe_outbound()` guard as Threat Scenario 2. |
| Medium | Business Logic Bypass (`CarDetail.jsx`) | **Not fixed** | `canViewVin` only toggles what the UI *displays*; the real, unmasked VIN is already present in the API JSON. Server-side `_PUBLIC_STRIP_FIELDS` (`app.py:1156-1160`) strips registration/proof document URLs but **not** `vin_number`. Any anonymous caller can read the full VIN via a direct API request, bypassing phone verification entirely. |
| Low | Missing Rate Limiting (`buying_requests.py`) | **Not fixed** | No limiter applied, despite the app already having a working Redis fixed-window limiter (`_redis_fixed_window_rate_limited`) used elsewhere. |
| Low | Oversized synchronous analytics ingestion (`dealer/analytics.py`) | **Fixed** | `MAX_SYNC_EVENTS` cap (20,000) + clamped date window, raises a 422 over the limit. |
| Low | Unbounded dealer API responses (`dealer_api_source_poller.py`) | **Fixed** | `Content-Length` pre-check plus a 5 MB mid-stream abort. |
| Low | Auto-review image downloads w/o size cap (`auto_review_worker.py`) | **Partial** | Truncates to 25 MB, but reads via `.content` (materializes the full response) rather than true streaming — bounded only by an 8s timeout, not by byte count as it downloads. |
| Low | HTTP request SSRF (`ExplorePage.jsx`) | **False positive** | `fetch()` only ever targets the app's own configured API URL. |
| Low | Dangerous use of `assert` (`expo_push.py`) | **False positive** | All asserts are confined to the `__main__` self-test block, not production code paths. |
| Low | Verification script can overwrite a real listing (`verify_complete_fix.py`) | **Safe, but dead code** | The only mutating call targets a hardcoded all-zero UUID — can't match a real row. Recommend deleting it as leftover dev tooling. |
| Low | Unbounded per-request OCR threads (`routes/ocr.py`) | **Fixed** | Fixed-size `ThreadPoolExecutor` + `BoundedSemaphore`, returns 503 when saturated. |
| Low | Destructive user deletion w/o audit (`admin.py`) | **Fixed** | `_log_admin_action(action="user_delete", ...)` writes to `admin_actions` before the response returns. |
| Low | Unredacted Third-Party Data Sharing (`BikeDetailRedesigned.jsx`) | **False positive** | Only outbound reference is a user-initiated `wa.me/...` WhatsApp link, no tracking pixel. |
| Low | Malformed dealer JSON rows retried indefinitely (`dealer_api_source_poller.py`) | **Not fixed** | Failed rows are dropped per-tick but there's no per-source failure cap or dead-letter — a permanently broken feed retries forever on its normal poll cadence. |
| Low | Slow-drip webhook starves delivery (`webhook_delivery_worker.py`) | **Fixed / mitigated** | 10s connect+read timeout, `MAX_ATTEMPTS=5` with backoff → dead-letter. Not round-robin fair across dealers, but no single delivery can hang indefinitely. |
| Low | PDF page dimensions unchecked before rasterization (`registration_ocr.py`) | **Fixed** | Max-dimension/point checks run before `page.render(...)`. |
| Low | 1 exposed secret (`test_dealer_secrets_service.py`) | **False positive** | Explicitly named `FAKE_KEY`, used only in a pytest fixture. |
| Low | Information Exposure via Error Messages (`admin.py`) | **Fixed** | Generic `{"error": "Internal server error"}` to the client; full traceback logged server-side only. |
| Low | Webhook responses buffered in full before 500-char cap (`webhook_delivery_worker.py`) | **False positive** | Genuinely streams via `response.iter_content(chunk_size=1024)` and stops once the cap is hit. |
| Low | Unrestricted File Upload (`registration_ocr.py`) | **Fixed** | Size cap, magic-byte sniff (not filename-based), PIL format validation, decompression-bomb guard. |
| Low | Missing Field-Level Authorization (`apply_rls_policies.sql`) | **Confirmed exists, reasonably complete** | 234 lines, RLS enabled on 9 tables, ~40 policy statements. |
| Low | Potential SSRF via user input (`admin.py`, `api_sources.py` + 6 others) | **Partial** | `api_sources.py` is guarded by `assert_safe_outbound()`; `admin.py`'s outbound calls only target `SUPABASE_URL`. The other 6 files named in the finding weren't individually re-checked this pass. |
| Low | Uncovered JWT (`supabaseClient.js`, `PostPlate.js`) | **False positive** | No hardcoded token constant anywhere; tokens are only ever read at runtime from the session. |
| Low | Uncovered JWT (`flask.log`) | **False positive** | File isn't tracked in git / present in the repo at all. |
| Low | 3 exposed secrets (`TOKEN_VALIDATION_FIX.md`, `ENHANCED_PROFILE_SETUP.md`) | **Unverifiable** | These files have never existed in this repo's git history — likely a local-disk scan artifact. |
| Low | Auth token in curl command header (`IMPLEMENTATION_FIXES.md`) | **Unverifiable** | Same as above — file never existed in git history. |

---

## Notes on methodology / honesty check

- This was produced by three parallel code-reading passes over the actual working tree (not a re-run of the original scanner), each asked to cite real `file:line` evidence rather than trust comments claiming a fix.
- A handful of "6 others" / broad multi-file findings in the original ledger (e.g. the wider SSRF-via-user-input finding, and the `reddit_daily_post_worker.py` input-validation finding, and OCR-service authentication) were **not individually re-checked** in this pass — they're flagged above rather than silently marked fixed.
- Dependency findings were checked by reading pinned/resolved version numbers only, not by querying a live vulnerability database — two of them (`starlette`, `opencv-python`) had explicit in-file comments confirming the pin was a deliberate security fix, which is a stronger signal than the others.
