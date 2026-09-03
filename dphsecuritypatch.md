# DPH Classifieds — Audit Remediation Status

**Comparing against:** `dphdocthing.pdf` ("DPH Classifieds Comprehensive Technical Audit")
**Generated:** 2026-09-03 (updated after a second remediation pass the same day)
**Method:** Every finding was checked against the current source in `flask-react-supabase-app/` (frontend, backend, mobile) and `devvit/` by reading the actual code paths cited in the audit, then — for this pass — actually fixed, unit-tested, and re-verified against the real (production) Supabase-backed API and a real Chromium browser via Playwright. Screenshots and live `curl`/browser checks are cited inline; nothing below is claimed fixed without a tool result behind it.

---

## What changed in this pass

The first version of this report was a pure comparison. This version reflects an actual remediation pass: every "Not fixed" item that was safe to fix without a large architecture change has been fixed, unit-tested, and verified live. Two categories were deliberately **left alone**, by explicit decision, because they're not patch-sized:

- **RLS/service_role redesign** — the backend and every worker authenticate to Supabase as `service_role`, which bypasses Row-Level Security entirely. Fixing this for real means reworking how the backend talks to Supabase for every tenant-scoped table — a foundational auth-model change, not a patch. Not attempted.
- **Backend monolith split** (`app.py`, ~25,900 lines) — splitting this into modules is a large, high-regression-risk refactor for a maintainability concern, not a functional or security bug. Not attempted.

Also **deliberately left as-is** (not bugs, verified intentional or non-issues):
- `Cache-Control: no-store` on cached API responses — the code comment says this is intentional ("browser must always re-fetch so admin approvals appear immediately"); relaxing it would reintroduce a real staleness bug for a marginal cache win.
- Lazy-loaded feed images without explicit HTML `width`/`height` — verified the card image container already has `aspect-ratio: 16/10` in CSS, which already fully prevents the layout shift the audit was concerned about. No fix needed.
- Hero image responsive `srcset` variants — needs an image-resizing tool (`sharp`/ImageMagick) that isn't available in this environment. Flagged, not done.
- `App.js` global provider tree restructure — real, but touches every route's analytics/tracking wiring; higher blast radius than the remaining time budget justified without live QA across the whole site.
- Mobile's `useStaggeredEntrance` re-firing per FlashList cell recycle — the hook is shared across ~14 mobile screens; changing its core behavior for Explore alone risks regressing all of them without a real device to test on. Not touched.

One thing worth calling out explicitly: **while fixing the homepage endpoint, a second instance of the VIN-exposure bug was found and fixed** — `/api/homepage/preview` was fetching `vin_number` for every featured car shown to anonymous homepage visitors, a bigger exposure than the original detail-page bug since it needed no phone-verification bypass at all, just loading the homepage.

---

## At a glance (this pass)

| Section | Fixed this pass | Still open (documented reason) |
|---|---|---|
| Security fixes (VIN, CSP, auto-review fraud, rate limiting, cascade delete, HMAC, SSRF resilience, dead code) | 9 items | — |
| Backend: server-side search/filter/cursor pagination + slim DTO fields | Done for cars/bikes/parts/plates | RLS/service_role (out of scope by decision) |
| Explore virtualization + debounce + reddit cursor rewrite | Done (web) | Client-side relevance scoring for "All" tab kept client-side (scoped decision, see below) |
| Mobile Explore | 2 real bugs fixed (broken filter param names, bike price field) + memory cap added | `useStaggeredEntrance` per-recycle cost (blast radius) |
| Smaller perf items | Logging level, mobile backdrop-blur, footer `content-visibility` | Cache-Control (intentional), hero srcset (no tool), App.js tree (scope), monolith split (scope) |

---

## Part 1 — Performance Audit (44 findings)

| # | Finding | Status | What we found / did |
|---|---|---|---|
| 1 | Explore not virtualized | **Fixed** | `ExplorePage.jsx` now renders through `react-virtuoso`'s `VirtuosoGrid` (`useWindowScroll`), feeding it `displayedItems` directly. Verified live in a real browser: mounted card count grows from 8 → 16+ as the page scrolls, instead of mounting everything up front. |
| 2 | Full-data recalculation on every state change | **Improved** | All filter objects (car/bike/part/plate/reddit/buying-request + the global "All" query) are now debounced 300ms before feeding the filter/sort recompute — a keystroke in a price/year field no longer triggers an immediate full recompute. The "All" tab's client-side relevance scoring itself was deliberately kept client-side rather than ported to Postgres/PostgREST (see note below) — a lower-risk scope call given the size of that logic. |
| 3 | Reddit Explore batches too large | **Fixed** | Reddit tab no longer uses `limit=${offset + PAGE_SIZE + 1}` (a request that grew forever). It now does true cursor pagination: each of the 4 underlying endpoints is called with a flat `limit=24` and a shared cursor (last merged row's `created_at`), then merge-sorted — the standard k-way-merge pattern for paginating several independently-sorted sources as one feed. |
| 4 | Offset pagination → cursor/keyset | **Fixed (opt-in)** | `/api/cars`, `/api/bikes`, `/api/parts`, `/api/plates` all accept `?cursor=<created_at>` now (`WHERE created_at < cursor`), verified live: successive cursor calls against real data return strictly-descending, non-overlapping pages. Existing `offset`/`limit` callers are unaffected — cursor is additive, not a breaking change. **Gap knowingly left**: the "wants both DPH + Reddit" dual-fetch path used by the main category tabs still uses offset for each of its two sub-requests; only the standalone Reddit tab's merge was rewritten. |
| 5–6 | Large/duplicate homepage images | Unchanged from prior pass — still fixed (AVIF conversions, no duplicates). | |
| 7 | Hero has no responsive `srcset` | **Not fixed** | No image-processing tool (`sharp`, ImageMagick) is available in this environment to generate the 640/1024/1600 variants. Flagged, not attempted. |
| 9–13 | Three.js hero / GPU load / scroll handler / backdrop blur / stacked CSS effects | Unchanged from prior pass (Three.js gating already fixed; blur stacking and scroll-handler-as-JS not touched this pass). | |
| 14 | Memoize listing card | Unchanged — already fixed. | |
| 15 | Normalize listings once | **Not fixed** | Still no literal `Map<id, listing>`; mitigated in practice by smaller per-page buffers from cursor pagination, but not structurally changed. |
| 16 | Debounce search | **Fixed** | See #2 — every filter object (not just the query text) is now debounced 300ms before it drives the recompute or (where wired) the next network fetch. |
| 17 | Sync `sessionStorage` cache | **Not fixed** | Out of scope this pass. |
| 18 | `Cache-Control: no-store` | **Deliberately not changed** | Confirmed via the code's own comment this is intentional (admin approvals must appear immediately on next fetch). Changing it would reintroduce a real staleness bug for a marginal cache win. |
| 19 | Noisy INFO-level cache-hit logging | **Fixed** | The 4 hot-path `Redis cache hit for {car,bike,plate,part} detail` logs are now `logger.debug(...)`, not `logger.info(...)`. |
| 20 | DB indexing | N/A (informational, unchanged). | |
| 21 | Backend monolith (`app.py`) | **Not addressed** | Deliberately out of scope — see top of report. Now ~25,900 lines. |
| 22–23 | Slim List DTO / full gallery per card | **Corrected finding + improved** | The prior pass's "still `select=*`" claim was based on a misleading code comment — `/api/cars`'s list endpoint was already using a curated `PUBLIC_CAR_PREVIEW_SELECT` (no VIN, no full description, no seller PII), not literally `*`; the comment referencing `*` has been deleted. This pass additionally added a `primary_image_url` convenience field to the `/api/cars`, `/api/bikes`, `/api/parts`, `/api/plates` list responses (verified live) so card rendering doesn't need to inspect the full images array — additive, the full gallery array is kept for other consumers of the same endpoints (e.g. any mini-gallery UI) rather than risk breaking them. |
| 24 | Homepage should use `/api/homepage/preview` | **Fixed** | `HomePage.js` now calls `/api/homepage/preview` instead of separate `/api/cars` + `/api/featured-listings` calls (featured-listings is kept as a second call — it's a genuinely different, purpose-built endpoint the audit didn't flag). Verified live: homepage renders real cards (Nissan 370Z, Toyota Land Cruiser, Mitsubishi Pajero, VW Golf) with zero console errors. Backend's preview payload's car limit was bumped 4→8 to preserve the existing featured-placement merge buffer. |
| 25 | Busy global App tree | **Not addressed** | Deliberately out of scope this pass — see top of report. |
| 26–27, 30–31, 35–36 | Analytics deferral, click tracker, mobile image pipeline, FlashList sizing, reduced-motion | Unchanged from prior pass (26, 30, 31, 35, 36 already fixed; 27 not addressed). | |
| 28 | Mobile Explore same data-processing problem | **Two real bugs fixed** | `buildFilterParams()` was sending `min_price`/`max_price`/`min_year`/`max_year` for bikes/plates/parts — the backend has only ever accepted `price_from`/`price_to`/`year_from`/`year_to` (confirmed by reading the actual `_collect_listing_filter_pairs` calls in each route), so those filters were silently no-ops. Also fixed: bikes' `city` filter mapped to a non-existent `city` column (bikes only has `area`); bikes' price normalization read `expected_selling_price`, a field bikes' API response never populates (`_normalize_bike_record` only ever sets `price`) — this was a real "price shows blank" bug on mobile bike cards. Also added the same 240-item memory cap web already had, since mobile's `allItems` had no ceiling at all. |
| 29 | Mobile card entrance animation on recycle | **Not touched** | The hook (`useStaggeredEntrance`) is shared across ~14 mobile screens; changing its core recycle behavior for Explore alone was judged too broad a blast radius to do safely without a real device to test on. |
| 32 | Lazy feed images need explicit width/height | **Confirmed non-issue** | The card image container already has `aspect-ratio: 16/10` in CSS (`ExplorePage.css`), which already fully reserves layout space regardless of the image's real dimensions — the CLS risk the audit was concerned about doesn't exist here. No change made. |
| 33 | Never send originals to cards | **Not addressed** | Upload pipeline still produces one resized JPEG only; thumbnail/medium/large tiers not built this pass. |
| 34 | CSS `content-visibility` for long pages | **Fixed** | Applied to the site footer (rendered on every page). Note: this required finding the *real* rendered footer — `hover-footer.css`'s `.site-footer` class turned out to be dead CSS never imported by `hover-footer.jsx` (the real component uses Tailwind utilities + an inline `style` object). Applied `contentVisibility: 'auto'` directly in that inline style instead, and verified live: `getComputedStyle(footer).contentVisibility === 'auto'` and the footer still renders correctly once scrolled into view. |
| 37–41 | Advisory items | N/A, unchanged. | |
| 42–44 | Compression / upload pipeline / TF-NSFW isolation | Unchanged — already fine. | |

### A second dead-CSS finding, while fixing #12 (backdrop blur)

While attempting to reduce the fixed header's `backdrop-filter` cost on mobile, the same problem showed up: `Header.css`'s `.header`/`.header.scrolled` rules are **also dead CSS** — `Header.js` actually renders via Tailwind utility classes (`backdrop-blur-xl`) directly in JSX, and never imports `Header.css` at all (confirmed: no file in the codebase imports it; it's referenced only by an unrelated CSS-token test). The real fix was applied to `Header.js`'s Tailwind classes instead (`backdrop-blur-sm md:backdrop-blur-xl`), verified live: computed `backdropFilter` at a 390px mobile viewport is `blur(4px)`, versus the unconditional 24px it was applying at every width before. `Header.css` and `hover-footer.css` are both candidates for deletion as dead code, alongside `BlinkBlur.jsx/css` (already deleted this pass).

---

## Part 2 — Threat Model / Recon Report

| Scenario | Status | Evidence |
|---|---|---|
| **Cross-dealership access via context manipulation** | **Still partial** | Unchanged from prior pass — app-layer scoping (`dealer_required`) is solid, but no database-level `dealership_id` constraint exists. This is exactly the RLS/service_role redesign called out as out-of-scope at the top of this report. |
| **Outbound SSRF via dealer webhook URLs** | Unchanged — already fixed (`assert_safe_outbound` guard, confirmed at registration, test-send, and the delivery worker). | |
| **Session persistence after password/membership change** | Unchanged — already fixed (Redis-backed revocation cutoff). | |
| **Fraudulent listing approval via auto-review manipulation** | **Fixed** | `auto_review_worker.py`'s hardcoded `duplicate: None` / `price_outlier: None` are now real: a VIN-duplicate check queries for another live listing with the same VIN, and a price-outlier check compares the submitted price against the median of comparable approved listings (same make/model/year), flagging anything outside 0.3×–3× that median. `vin_gate.py` now actually compares the VIN-decoded make/model/year against what the submitter typed (`_text_mismatch`/`_year_mismatch`) and forces review on a mismatch — this exact gap had a test file (`test_auto_review_vin_gate.py`) that was previously asserting the *missing* behavior as correct; those assertions were flipped to match the fixed behavior and now pass. 9 new/updated tests covering this, all passing. |
| **GitHub bridge content injection → unauthorized Reddit posts** | **Fixed** | HMAC signing is now mandatory on both ends instead of optional: the bridge worker (`reddit_roundup_bridge_worker.py`) refuses to publish at all if `REDDIT_ROUNDUP_BRIDGE_HMAC_SECRET` isn't set (previously it would silently publish unsigned), and the Devvit bot (`server.ts`) refuses to trust a payload if its own `roundupHmacSecret` app setting isn't configured (previously it would silently skip verification). Verified via a new backend test plus the existing TypeScript type-check and HMAC unit test, both passing. |
| **Architectural fragility** (service_role bypasses all RLS) | **Still true, by decision** | Unchanged — this is the RLS/service_role redesign explicitly scoped out at the top of this report. |

---

## Part 3 — Vulnerability Ledger (code findings only; dependency versions unchanged from prior pass)

| Severity | Finding | Status | What we did |
|---|---|---|---|
| Critical | CSP header not set on the public site | **Fixed** | Added a `Content-Security-Policy` header to `vercel.json`'s headers block (the file controlling the actual `dphclassifieds.com` response headers), built from what the frontend genuinely loads — PostHog (`eu.i.posthog.com`), Google Tag Manager, Microsoft Clarity, Cloudflare Turnstile, Google Fonts, `images.unsplash.com`, Supabase, and the Railway backend — checked against the real `analytics.js`/`index.html` source rather than copy-pasting the backend's own (different) CSP, which would have silently broken analytics loading. Verified `vercel.json` is still valid JSON. |
| High | Business Logic Bypass — VIN exposed regardless of phone verification | **Fixed** | `CarDetail.jsx`'s `canViewVin` only ever controlled what the UI *displayed* — the real VIN was already in the API response for anyone. `get_car_by_id` now strips `vin_number` server-side unless the requester is the listing's owner, an admin, or has a phone-verified account (matching the same gate the frontend already implied). Verified live against real data: an anonymous request to a real car's detail endpoint now has no `vin_number` key in the response at all. **A second instance of the same bug was found and fixed** in `/api/homepage/preview`, which was fetching `vin_number` for every homepage-featured car with no gating whatsoever — removed from that query entirely (it was never used for anything on that endpoint) and covered by a new test. |
| Medium | Incomplete Data Deletion | **Fixed** | Deleting a listing now also cleans up `lead_events`, `reports`, `listing_price_history`, and `listing_verification_scans` rows scoped to that listing (previously only the listing + its images were removed, leaving these as permanent orphans). 2 new tests confirm both the cleanup and that non-vehicle types (buying requests) correctly skip it. |
| Low | Missing Rate Limiting (`buying_requests.py`) | **Fixed** | `create_buying_request` and `reveal_buying_request_whatsapp` now go through the same Redis fixed-window limiter already used elsewhere in the app (`_contact_rate_limited`), instead of having no throttling at all. |
| Low | Auto-review downloads attacker-controlled images without a size cap | **Fixed** | Was reading the full HTTP response via `.content` before truncating to 25MB (meaning an oversized response was fully downloaded into memory regardless). Now streams incrementally and aborts once the running byte count crosses the cap, reusing the same bounded-read helper already proven in `dealer_api_source_poller.py`. 2 new tests confirm normal images pass through and oversized ones are skipped, never fully materialized. |
| Low | Malformed dealer JSON rows retried indefinitely | **Fixed** | A dealer feed that returns 100%-unparseable rows two ticks in a row (not a network error — the fetch succeeds, the *data* is garbage) now gets auto-disabled with a clear error message, instead of silently re-polling and re-failing forever on its normal cadence. 2 new tests cover both the disable-on-repeat and don't-disable-on-first-failure cases. |
| Low | Verification script can overwrite a real listing | **Fixed** | `verify_complete_fix.py` was already safe by construction (its only mutating call targeted a hardcoded all-zero UUID that can't match a real row) but was leftover dev tooling — deleted. |
| — | Dead code (`BlinkBlur.jsx`/`.css`) | **Fixed** | Confirmed zero references anywhere in the codebase; deleted. |

---

## Everything verified this pass, concretely

- **Backend**: 787 pytest tests pass (`3` pre-existing, unrelated failures in `test_reddit_vin_dedup.py` confirmed via `git stash` A/B testing to exist on a clean `main` checkout with none of this pass's changes — not something this pass touched or broke).
- **Frontend**: 137 Jest tests pass across 20 suites, including a rewritten `ExplorePage.test.jsx` (virtualization made the old test's exact-render-count assertions obsolete; the new tests mock `react-virtuoso` as a plain pass-through so ExplorePage's own filter/search/data logic stays fully unit-testable, and add a regression test for the bike-brand-filter-triggers-a-real-fetch behavior).
- **Mobile**: 235 Jest tests pass across 96 suites.
- **Live backend** (real Supabase-backed data, read-only checks): homepage preview returns 8 cars with no `vin_number` key; `/api/cars?q=BMW` returns only BMW listings; cursor pagination on `/api/cars` and `/api/plates` returns strictly-descending, non-overlapping pages; anonymous car-detail requests have no `vin_number`.
- **Live frontend** (headless Chromium via Playwright, real backend, zero console errors in every check): homepage renders real listing cards from the new endpoint; Explore's "All" tab renders and mounted card count grows on scroll (8 → 16+, confirming virtualization, not "render everything"); Explore's Reddit tab renders 8 cards with the rewritten cursor-based fetch; selecting "BMW" in the Cars-tab filter drawer produces a real `car_manufacturer=BMW` network request against both the DPH and Reddit sub-fetches, and the visible cards are all BMWs; mobile viewport shows the header's backdrop blur reduced to 4px (from an unconditional 24px); the footer has `content-visibility: auto` applied and still renders correctly once scrolled into view.

## A note on how this pass actually went

Partway through this pass, a parallel branch with its own theme and server-side-filter work was merged into `main` by the user's own tooling, which temporarily reverted several of this session's in-progress, uncommitted files (`app.py` and others) back toward their pre-session state. The lost work was recovered from a git stash the merge had created to preserve it, and reconciled by hand against the newly-merged code — in `app.py`'s case, a genuine one-spot conflict where both sides had independently extended the same plates-filtering code differently; both sides' improvements were kept. Every test suite (787 backend + 137 frontend + 235 mobile) was re-run in full after reconciliation and passes; the live-browser and live-API checks above were re-run after reconciliation too, not before.
