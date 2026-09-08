# Verification policy

Run checks from the directory shown. A stage is not complete until every
applicable required lane passes and its result is recorded. Never write secrets,
OTP values, test credentials, or service-role keys to source, logs, reports, or
browser artifacts.

## Backend gates

- Focused red/green: from `flask-react-supabase-app/backend`, run the smallest
  affected pytest file first, then rerun it after the implementation.
- Route contract: run `./.venv/bin/pytest -q test_route_manifest.py`. Compare the
  full immutable manifest and the recorded legacy `(path, method)` collision
  baseline. A change may remove a collision only in an explicitly approved
  cleanup stage; it must never introduce a new collision.
- Extraction boundary: statically inspect every newly extracted production
  module and fail the change if it imports `app.py` or imports from `app`.
  Extracted code receives runtime dependencies through
  `current_app.extensions` or explicit injection.
- Health boundary: run `pytest -q test_health_route_module.py
  test_api_error_contracts.py test_route_manifest.py` and confirm
  `rg -n 'from app|import app' application/health_routes.py
  application/http_runtime.py` returns no matches. Health aliases must retain
  their legacy endpoint names and liveness responses.
- Full backend: from `flask-react-supabase-app/backend`, run
  `./.venv/bin/pytest -q`.
- Docker API E2E: from `flask-react-supabase-app/backend`, run `./e2e/run.sh`.
- Worker Docker smoke: from `flask-react-supabase-app/backend`, run
  `./e2e/worker.sh`. The bounded script creates only its own Redis/network/
  worker resources, asserts the worker health endpoint, and reads the actual
  Redis heartbeat; it uses no provider credentials and always cleans up.

## Frontend and mobile gates

- Frontend: from `flask-react-supabase-app/frontend`, run
  `CI=true npm test -- --watchAll=false`, `npm run build`,
  `npm run check:bundle`, and `npm run audit:media`.
  The decorative Three.js hero is intentionally idle-deferred so the initial
  homepage paint does not request its large vendor chunk; keep this behavior
  covered when changing the homepage shell.
- Mobile: from `flask-react-supabase-app/mobile`, run
  `npx tsc --noEmit` and `npm test -- --runInBand`.

## Browser and role gates

- Public Playwright: from `flask-react-supabase-app/frontend`, run the public,
  credential-free Playwright project with `npm run e2e` across all required responsive viewports.
  The dealer SPA route `/dealer/dashboard` is covered by the authenticated dealer
  lane; it is not part of the credential-free public route list.
- Dealer-panel feature modes: run route checks with the dealer panel explicitly
  enabled and explicitly disabled. Verify the documented route availability,
  status, and authorization contract in both modes.
- Worker role: start the worker composition independently of the web role,
  smoke its health surface, and require evidence that its heartbeat was written.
- Authenticated release lane: run protected user, dealer, admin, posting, and VIN
  browser checks with disposable credentials supplied only through the
  environment: `E2E_STRICT_AUTH=true E2E_USER_EMAIL=... E2E_USER_PASSWORD=... E2E_DEALER_EMAIL=... E2E_DEALER_PASSWORD=... E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... E2E_CAR_ID=... E2E_ALLOW_MUTATIONS=true E2E_MUTATION_FIXTURE=/absolute/path/fixture.json PLAYWRIGHT_BASE_URL=https://target PLAYWRIGHT_API_URL=https://api.target npm run e2e:release`. Missing required credentials fails this command; the ordinary public lane may skip protected tests when credentials are absent.
- Live E2E: after deployment approval, run the public and authenticated smoke
  suites against the exact live release with the preceding command and record the deployed revision. Local,
  CI, health-only, or provider-pending results do not count as live proof.

## Current staged-extraction baseline

The current staged branch has completed the bounded admin route cleanup and the
authenticated identity/listing extraction through the current staged checkpoint. The canonical
saved-listings, saved-searches, push-token, auth, profile, dealer-verification,
moderation, analytics, diagnostics, sitemap, and recommendations boundaries live
in dedicated route modules and resolve services through
`current_app.extensions["dph_user_backend"]`. The canonical
saved-listings, saved-searches, and push-token routes live in
`flask-react-supabase-app/backend/routes/user.py`; the module must remain free
of static `app.py` imports and resolve runtime services through
`current_app.extensions["dph_user_backend"]`.

The verified local baseline for the current staged extraction is:
`app.py` 14,268 lines; focused moderation, analytics, diagnostics, sitemap,
recommendation, phone, metrics, live-user, dealer-info, public-info, upload,
reports, overview-metrics, admin-stats, admin-listing-search,
admin-reddit-analytics, user-lead-metrics, lead-events, price-history, and
manifest suites pass; dealer document review is now also isolated in
`routes/dealer_document_review.py`; dealer admin verify/reject actions are
isolated in `routes/dealer_admin_actions.py`; admin dealer listing deletion is
isolated in `routes/admin_listing_delete.py`; dealer listing-limit decisions are
isolated in `routes/admin_upgrade_decisions.py`; the full backend suite is
`1295 passed, 11 skipped, 57 warnings`; the dealer upgrade create/list/decision
routes now live in their extracted boundary; Docker API
liveness/readiness/404/auth-gate
smoke and worker health plus Redis heartbeat smoke passed. Frontend Jest is
`153 passed`, CRA production build passed, the main bundle is `102.0 KiB`, the
largest JavaScript asset is `1320.3 KiB` under the `1500 KiB` policy, and the
media audit found 29 images with no oversized or exact duplicate assets. Mobile
TypeScript passed and Jest is `261 passed`; public Playwright is `48 passed, 27 credential-gated
skips` across desktop/tablet/mobile. Protected browser flows remain
credential-gated and must not be reported as passed when their disposable
credentials and target environment are absent.

The authenticated user listing inventory routes (`/api/user/cars`, `/bikes`,
`/plates`, `/parts`, and `/listings`) now live in
`routes/user_listing_index.py`. The terminal-listing owner dismissal route lives
in `routes/user_listing_actions.py`; both preserve the legacy endpoint exports,
runtime dependency boundary, and exact response/auth contracts. Focused extraction
and lifecycle tests pass.

The public contact and missing-model fallback routes now live in
`routes/contact.py` and `routes/car_model_request.py`. The authenticated signed
storage-upload URL route now lives in `routes/storage_upload.py`; its bucket,
path, MIME, size, and extension checks remain runtime-resolved and are covered by
focused security contracts.

The featured-listing admin/public routes, hydration helpers, and placement
pattern contract now live in `routes/featured_listings.py`. This preserves the
admin-only gates, public visibility filtering, upsert behavior, Redis fallback,
and compatibility exports. The featured-listing checkpoint passed `1277
tests`, with 11 credential-gated skips.

The admin saved-search analytics route now lives in
`routes/admin_saved_searches.py`, preserving the admin gate, date/limit
clamping, owner enrichment, category summary, missing-table handling, and
compatibility export. The saved-search checkpoint passed `1280 tests`, with 11
credential-gated skips.

The authenticated `/api/auth/admin-check` route now lives in
`routes/admin_check.py`, preserving token enforcement, service-role lookup,
super-admin resolution, fail-closed user/provider handling, and its legacy
endpoint export. The admin-check checkpoint passed `1284 tests`, with 11
credential-gated skips.

The dealer verification notification and message timeline routes now live in
`routes/dealer_verification.py` with their original unprefixed endpoint names,
runtime helper bridge, dealer-only guard, audit insert, notification isolation,
and provider-error mapping. The dealer-message checkpoint passed `1288 tests`,
with 11 credential-gated skips.

The compatibility `/api/users` route now lives in `routes/users_legacy.py`,
preserving its admin gate, service-role fetch, partial-content envelope, and
legacy endpoint export. The current backend total is `1292 passed, 11 skipped,
57 warnings`, with `app.py` at `14,302` lines at the prior checkpoint.

The legacy public `/api/license-plates` read route now lives in
`routes/license_plates_legacy.py`, preserving approved-only filtering, query
parameters, seller enrichment, cache behavior, and its compatibility export.
The current backend total is `1295 passed, 11 skipped, 57 warnings`, with
`app.py` at `14,268` lines.

Dealer document listing, upload, deletion, profile-photo, and KYC application
submission routes now live in `routes/dealer_verification.py`. It follows the
same `current_app.extensions["dph_user_backend"]` dependency boundary and
preserves compatibility exports from `app.py`.

User statistics live in `routes/statistics.py`, while authenticated draft
listing/read/write/delete routes live in `routes/drafts.py`; reminder workers
remain in their existing worker boundary.

Listing image uploads live in `routes/media.py`, admin VIN unlock in
`routes/vin_admin.py`, and the authenticated listing outcome transition in
`routes/listing_outcomes.py`. These modules keep compatibility exports and
resolve patchable services through the runtime dependency registry.

Generic moderation APIs live in `routes/moderation.py`; platform event ingestion
lives in `routes/platform_analytics.py`; diagnostics config lives in
`routes/diagnostics.py`; public sitemap aliases live in `routes/sitemap.py`;
recommendation HTTP handling lives in `routes/recommendations.py`; phone
verification lives in `routes/phone_verification.py`; admin email/error metrics
live in `routes/admin_metrics.py`; live-user metrics live in `routes/live_users.py`;
admin dealer info-request controls live in `routes/dealer_info_requests.py`; public
dealer info-request lookup lives in `routes/public_info_request.py`; public dealer
info-request multipart upload/lifecycle handling lives in
`routes/public_info_upload.py`; public car detail and VIN privacy handling lives
in `routes/car_detail.py`; and report create/list handling lives in
`routes/reports.py`.
Plate and car-part detail helpers used by the optional-auth GET dispatchers live
in `routes/listing_details.py`; public price-history handling lives in
`routes/price_history.py`; and the admin platform metrics overview route lives
in `routes/admin_overview_metrics.py`; admin dashboard stats live in
`routes/admin_stats.py`; unified admin listing search lives in
`routes/admin_listing_search.py`; aggregate Reddit-import analytics live in
`routes/admin_reddit_analytics.py`; authenticated user lead metrics live in
`routes/user_lead_metrics.py`; public listing lead-event ingestion lives in
`routes/lead_events.py`; authenticated repost handling lives in
`routes/repost.py`.
Each module
has focused route-contract coverage and independent review evidence.

The authenticated listing extension route is isolated in
`routes/listing_lifecycle.py`. Admin listing renewal, bulk moderation, status,
and expiry routes are isolated in `routes/admin_listing_lifecycle.py` and retain
their compatibility exports and route precedence.

The authenticated car update route, including JSON/multipart image replacement,
lives in `routes/car_update.py`; its compatibility aliases and existing direct
upload contract are retained.

The authenticated bike update and delete routes live in `routes/bike_update.py`.
They retain JSON aliases, ownership/validation gates, image replacement fallback,
notifications, cache invalidation, and direct-call compatibility. Client-supplied
`status` and `user_id` are explicitly excluded from bike mutation writes.

Plate mutation dispatch and delete routes live in `routes/plate_update.py`, part
mutation dispatch and delete routes live in `routes/part_update.py`, and the
admin listing renewal/bulk/status/expiry routes live in
`routes/admin_listing_lifecycle.py`. Part mutations perform an explicit owner
check before persistence; all three modules retain compatibility exports and
route-manifest coverage.

Remaining root cleanup is limited to coupled helpers and legacy families that
still require separate contract work: overview and stats aggregation, and
lifecycle/reminder worker composition. These must not be
deleted mechanically. Protected browser/provider verification remains
credential-gated; the ordinary public browser lane is not evidence for those
flows.

Local authenticated browser simulation is available from
`flask-react-supabase-app/frontend` with `npm run e2e:local-sim`. It uses only
`.test` identities and an in-memory page-local API simulator; it verifies the
real React login, car/part/plate/bike posting contracts, VIN reveal analytics,
phone verification UI, dealer metrics, admin metrics, and responsive scrolling
at desktop, tablet, and mobile viewports. The 2026-09-08 verification passed
27/27 simulation tests, the full browser matrix 75 passed/27 skipped, backend pytest 1334/1334,
mobile TypeScript plus Jest 261/261, frontend Jest 153/153, the production
build/bundle/media checks, and both Docker smoke scripts. The simulator is not
evidence for Supabase RLS, SMS/email/OCR providers, storage, or deployment;
those remain release-gated and require disposable live credentials/fixtures.
