# Canonical Admin Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Supabase the canonical, accurate source for listing views and contact leads across web and mobile, with a trustworthy admin dashboard and Cloudflare used only for edge traffic/security.

**Architecture:** Keep append-only, first-party raw events in `platform_events` and make `listing_view`, `call_click`, and `whatsapp_click` the canonical product events. Aggregate those events in PostgreSQL through a security-definer RPC and daily aggregate table; admin endpoints read aggregates rather than PostgREST samples. Cloudflare supplies separately labelled edge traffic and protects public ingest endpoints; it never replaces listing or lead metrics.

**Tech Stack:** Flask, React/CRA, Expo/React Native, Supabase/Postgres/PostgREST, pytest, Cloudflare WAF/rate limiting, GA4, Microsoft Clarity.

## Global Constraints

- A listing view means a successfully loaded listing-detail screen made visible to a user; preserve raw views and unique viewers separately.
- A lead means a user clicked call or WhatsApp; do not represent a click as a completed call, chat, or sale.
- Do not store phone numbers, WhatsApp URLs containing phone numbers, raw IP addresses, or free-text form contents in analytics payloads.
- All event names are allowlisted; all anonymous events carry stable `visitor_id` and per-launch/per-tab `session_id`.
- Cloudflare values must retain their own `edge_*` names and source label; never mix them with product-event counts.
- Do not use a Cloudflare Global API key. Keep the existing scoped API token and label its cross-day visitor total as estimated.
- Retain raw events for 180 days, daily aggregates for 25 months, and document the retention job before enabling deletion.

---

## File map

- Create: `supabase/migrations/<timestamp>_canonical_analytics.sql` — event constraints, idempotency, aggregate tables/RPCs, indexes, RLS.
- Create: `backend/services/analytics_events.py` — event validation, identity normalization, idempotency and aggregate refresh calls.
- Create: `backend/test_analytics_events.py` — unit and endpoint contract tests.
- Create: `backend/test_admin_analytics_aggregates.py` — aggregate/admin payload tests.
- Modify: `backend/app.py` — replace raw write logic, remove read-then-write listing counters, make admin endpoints query RPCs.
- Modify: `backend/analytics_metrics.py` — consume canonical aggregate payloads; remove `view_count` fallback for admin metrics.
- Modify: `backend/routes/dealer/analytics.py` and `backend/services/dealer_kpi.py` — use the same aggregate definitions and identities.
- Modify: `frontend/src/components/PlatformAnalyticsTracker.js` — shared browser identity, explicit listing events, reliable delivery.
- Modify: `frontend/src/components/{CarDetail,BikeDetailRedesigned,PlateDetailRedesigned,PartDetailRedesigned}.jsx` — dispatch canonical view and lead events only.
- Modify: `mobile/src/utils/{platformTracker,leadTracking}.js` and `mobile/src/navigation/AppNavigator.js` — carry the resolved listing ID and identity.
- Modify: `frontend/src/components/{AdminDashboard,AdminMetrics,AdminListings,AdminListingDetail}.js[x]` — render one contract with definitions and data freshness.
- Modify: `backend/services/cloudflare_analytics.py`, `backend/.env.example`, `docs/ANALYTICS_SETUP.md` — Cloudflare boundary, security setup and operator runbook.

## Task 1: Establish the analytics contract and Supabase schema

**Files:** Create migration; modify `backend/app.py`; test `backend/test_analytics_events.py`.

**Produces:** `analytics_event_name` values `listing_view`, `call_click`, `whatsapp_click`, `vin_open`, `vin_reveal`; required identity and idempotency columns; SQL function `public.record_analytics_event(...)`.

- [ ] Write failing tests that reject unknown events, missing listing identity for listing/contact events, duplicate `event_id`, and a malformed UUID.
- [ ] Add nullable `event_id UUID`, `visitor_id TEXT`, `session_id TEXT`, `platform TEXT`, `occurred_at TIMESTAMPTZ`, `received_at TIMESTAMPTZ` to the canonical event table; backfill `occurred_at = created_at`, `received_at = created_at`.
- [ ] Add `UNIQUE (event_id)`, `CHECK (event_name IN ('listing_view','call_click','whatsapp_click','vin_open','vin_reveal','page_view','page_exit','session_start','session_end','form_submit'))`, and partial indexes on `(listing_type, listing_id, occurred_at DESC)` and `(visitor_id, occurred_at DESC)`.
- [ ] Create `record_analytics_event(p_event_id uuid, p_event_name text, p_listing_type text, p_listing_id text, p_visitor_id text, p_session_id text, p_user_id uuid, p_platform text, p_occurred_at timestamptz, p_metadata jsonb)` that validates the allowlist, inserts once with `ON CONFLICT (event_id) DO NOTHING`, and returns `{accepted, duplicate}`.
- [ ] Enable RLS and revoke direct `anon`/`authenticated` writes; only the backend service role may call the RPC/write raw data.
- [ ] Run migration in a staging Supabase project, then verify indexes, constraints, RLS, and RPC permissions with service-role and anon test queries.
- [ ] Commit: `feat(analytics): add canonical event schema and idempotency`.

## Task 2: Make first-party collection reliable and privacy-safe

**Files:** Create `backend/services/analytics_events.py`; modify `backend/app.py`, web tracker/detail components, mobile trackers; test `backend/test_analytics_events.py`.

**Consumes:** Task 1 RPC.

- [ ] Write failing API tests for accepted `listing_view`, anonymous `call_click` with visitor/session IDs, duplicate event replay, and contact payload stripping.
- [ ] Implement `validate_analytics_event(payload, authenticated_user_id)` with explicit field lengths, UUID validation, event-specific listing requirements, and a metadata allowlist (`referrer_host`, `utm_*`, `source`, `route`, `schema_version`).
- [ ] Replace `/api/analytics/events` and `/api/listings/<type>/<id>/lead-events` persistence with `record_analytics_event`; retain the lead endpoint only as a compatibility wrapper that maps to the canonical service.
- [ ] In `PlatformAnalyticsTracker`, generate one UUID `event_id` per event; include local visitor/session IDs; send listing views explicitly after listing data has loaded and the document is visible for one second. Keep generic page events separate.
- [ ] Remove direct `/api/{type}/{id}/view` calls from all four web detail components. Send contact events with `keepalive: true`; use `navigator.sendBeacon` for page-unloading navigations and queue retryable failures in `sessionStorage`.
- [ ] Make mobile `trackLeadEvent` call `trackMobilePlatformEvent` identity helpers and send `event_id`, visitor ID and session ID. Resolve listing ID from `listingId || itemId || carId` and assert it exists before emitting a detail event.
- [ ] Ensure GA4 is only a mirror: emit the GA4 contact event from the same accepted client event, with no phone number or URL payload.
- [ ] Commit: `feat(analytics): unify web and mobile event collection`.

## Task 3: Replace mutable view counters with canonical aggregates

**Files:** Modify migration, `backend/app.py`, `backend/analytics_metrics.py`; create `backend/test_admin_analytics_aggregates.py`.

**Produces:** `public.analytics_listing_daily` and RPC `public.get_admin_analytics(p_start timestamptz, p_end timestamptz)`.

- [ ] Write failing SQL/service tests for two simultaneous views, same visitor reloading a listing, unique contact conversion, and raw-vs-unique totals.
- [ ] Create `analytics_listing_daily(day, listing_type, listing_id, platform, raw_views, unique_viewers, raw_call_clicks, unique_callers, raw_whatsapp_clicks, unique_whatsapp_clickers, primary key(day, listing_type, listing_id, platform))`.
- [ ] Add an idempotent aggregate refresh function that calculates unique viewers by `(visitor_id, listing_type, listing_id, UTC day)` and unique contact intent by `(visitor_id, listing_type, listing_id, event_name, UTC day)`.
- [ ] Call the refresh function after accepted writes for affected day/listing; add a nightly full reconciliation job for the last 48 hours.
- [ ] Delete `_increment_listing_view_count` use from public routes. If legacy `view_count` must remain for old UI, set it only from aggregate reconciliation and mark it deprecated.
- [ ] Change `build_platform_metrics` to use aggregate totals; remove its global “prefer tracked views” fallback, which currently makes some listings use raw events and others `view_count`.
- [ ] Commit: `feat(analytics): aggregate canonical listing performance`.

## Task 4: Rebuild admin and dealer query contracts

**Files:** Modify `backend/app.py`, `backend/routes/dealer/analytics.py`, `backend/services/dealer_kpi.py`, `backend/test_admin_stats_and_posts.py`; create aggregate tests.

**Consumes:** Task 3 RPC.

- [ ] Write failing tests for a 30-day window with more than 1,000 events, cross-source unique visitors, listing breakdown, dealer scoping, and zero-data behavior.
- [ ] Replace `/api/admin/stats`, `/api/admin/lead-metrics`, and `/api/admin/metrics/overview` full-row requests with `get_admin_analytics`. Never rely on a PostgREST `limit` for an aggregate.
- [ ] Return a versioned payload with `definitions`, `window`, `generated_at`, `data_freshness_seconds`, `raw_views`, `unique_listing_viewers`, `raw_call_clicks`, `unique_callers`, `raw_whatsapp_clicks`, `unique_whatsapp_clickers`, and `unique_contact_conversion_rate`.
- [ ] Remove fallback chains such as `stats.total_calls || totals.call_click`; each UI tile must consume exactly one named server field.
- [ ] Update dealer queries to call dealer-scoped aggregate SQL. Retire the empty-string visitor fallback in `dedupe_leads` so anonymous people cannot merge into one lead.
- [ ] Return `data_health` from actual aggregate freshness/reconciliation status, not from event-fetch truncation.
- [ ] Commit: `feat(admin): serve analytics from canonical aggregates`.

## Task 5: Make the admin UI explicit and auditable

**Files:** Modify `frontend/src/components/AdminDashboard.js`, `AdminMetrics.js`, `AdminListings.js`, `AdminListingDetail.jsx`; add component/unit tests if the existing frontend harness supports them.

- [ ] Replace “Views” with `Listing views` and a tooltip: “Raw listing detail views in the selected period.” Add `Unique viewers` beside it.
- [ ] Display Calls and WhatsApp as `clicks` and show unique contactors as a secondary number; show conversion as unique contactors divided by unique listing viewers.
- [ ] Use the same source/definition in dashboard tiles, listing list totals, listing detail KPI, and dealer views.
- [ ] Add a visible `Data status` panel: aggregate last refreshed time, accepted/rejected/duplicate events, Cloudflare source/estimate label, and a hard error state when the backend payload is stale.
- [ ] Keep Cloudflare edge requests, threats, cache and estimated unique visitors in a separate “Edge traffic” section; do not include those values in product conversion denominators.
- [ ] Add empty/error/loading states that state the missing source rather than displaying zero as a real measured value.
- [ ] Commit: `feat(admin): clarify canonical analytics definitions`.

## Task 6: Add Cloudflare protections and provider hygiene

**Files:** Modify `backend/services/cloudflare_analytics.py`, `backend/.env.example`, `docs/ANALYTICS_SETUP.md`; configure Cloudflare dashboard rules.

- [ ] Create Cloudflare rate-limit rules for `POST /api/analytics/events` and `POST /api/listings/*/lead-events`, scoped per IP and route, with an action that challenges or blocks bursts while allowing normal buyer interaction.
- [ ] Add a WAF rule that blocks malformed analytics JSON/content types and known abusive bot patterns; do not challenge normal listing GET pages.
- [ ] Keep `CLOUDFLARE_API_TOKEN` least-privileged: Zone Analytics Read and Zone Read only. Remove documentation that recommends a Global API key.
- [ ] Update backend Cloudflare payload to return `edge_unique_visitors_estimate`, `edge_page_views`, `edge_requests`, `edge_threats`, `edge_cached_requests`, and `edge_source`; stop overwriting generic product fields.
- [ ] Add Clarity configuration to the production frontend environment, verify its privacy masking configuration, and document GA4/Clarity as external mirrors rather than admin sources of truth.
- [ ] Commit: `chore(analytics): harden edge ingestion and provider boundaries`.

## Task 7: Verification, backfill and staged release

**Files:** Modify `docs/ANALYTICS_SETUP.md`; create `docs/analytics-runbook.md` and `backend/scripts/reconcile_analytics.py`.

- [ ] Restore the backend test environment first: install the pinned `backend/requirements.txt` into `backend/.venv` and confirm `./.venv/bin/pytest -q test_platform_metrics.py test_admin_stats_and_posts.py` collects successfully.
- [ ] Add test coverage for all four listing types on web, mobile car navigation (`carId`), anonymous/authenticated leads, duplicate retries, concurrent views, event rejection, >1,000 event windows, and Cloudflare separation.
- [ ] Deploy the schema migration before application code; run the reconciliation script in dry-run mode and compare aggregate rows to raw events for the prior 30 days.
- [ ] Deploy backend, then web and mobile clients. Monitor rejected/duplicate events and API error rates for 24 hours before enabling legacy-counter retirement.
- [ ] Execute a controlled production checklist: open a known listing once from web and mobile; click Call and WhatsApp once each; verify one raw event, one aggregate increment, one admin tile increment, one GA4 mirror, and no Cloudflare/product metric mixing.
- [ ] Backfill historical reporting only as `legacy_unattributed` where identity is absent; never relabel old counters as unique viewers or unique leads.
- [ ] Add scheduled nightly reconciliation plus an alert when aggregate freshness exceeds 15 minutes, event rejection exceeds 2%, or Cloudflare edge traffic materially diverges from first-party event traffic.
- [ ] Commit: `test(analytics): verify canonical admin reporting end to end`.

## Release order and acceptance gates

1. Task 1 plus Task 2 must be merged and migrated before any dashboard semantics change.
2. Task 3 must pass concurrency and dedupe tests before legacy `view_count` is hidden.
3. Task 4 and Task 5 ship together so no UI reads an obsolete contract.
4. Task 6 can deploy independently but must be configured before public event ingest is promoted.
5. Task 7 is the release gate. Do not call analytics accurate until the controlled production checklist reconciles all first-party surfaces.

## Self-review

- Covers every audit finding: truncation, split counters, race conditions, anonymous lead identity, delivery loss, mobile `carId`, dealer dedupe, endpoint abuse, provider configuration, and Cloudflare source mixing.
- No product metric relies on a PostgREST result limit.
- Every metric has a declared definition, one canonical source, an identity/deduplication policy, and a verification route.
