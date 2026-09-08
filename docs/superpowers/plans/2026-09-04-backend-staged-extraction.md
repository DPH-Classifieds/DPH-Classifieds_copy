# DPH Classifieds Backend Staged Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `backend/app.py` from a 26k-line route-and-runtime monolith into
a test-protected composition root while preserving every externally observable
contract.

**Architecture:** Extract domains behind Flask blueprints and a runtime adapter
backed by `current_app.extensions`. First freeze route behavior with a manifest,
then migrate low-coupling platform routes, public listing routes, identity,
dealer/admin, and workers in independently verifiable commits.

**Tech Stack:** Flask, Pytest, Gunicorn, Docker, React/CRA/Jest, Expo/Jest,
Playwright, Supabase HTTP APIs.

**Spec:** `docs/superpowers/specs/2026-09-04-backend-staged-extraction-design.md`

## Global Constraints

- Preserve every existing URL, HTTP method, endpoint name, response shape,
  authorization decision, status code, and side effect unless a regression test
  explicitly documents an existing defect.
- Extracted modules must not import `app.py`; runtime access must use
  `current_app.extensions` or injected callables.
- No service-role key, secret, OTP, or supplied test credential may be written
  to source, fixtures, logs, commits, or browser artifacts.
- Every production-code change starts with a focused failing test and records
  red/green evidence.
- Do not delete migrations or automatically apply remote schema changes.
- Do not push, deploy, or mutate live data as part of this plan.
- Keep the 48 public responsive browser checks executable without credentials;
  protected tests must use explicit skips when prerequisites are absent.

---

### Task 1: Freeze contracts and add agent verification policy

**Files:**
- Create: `flask-react-supabase-app/backend/application/route_manifest.py`
- Create: `flask-react-supabase-app/backend/test_route_manifest.py`
- Create: `AGENTS.md`
- Modify: `flask-react-supabase-app/backend/app.py`

**Interfaces:**
- Produces `build_route_manifest(app) -> tuple[RouteContract, ...]` where a
  contract contains rule, methods, endpoint, and API/public classification.
- Produces `assert_route_manifest(app, expected)` for later extraction tests.

- [ ] Write a failing test that asserts `/healthz`, `/healthz/live`,
  `/api/health`, `/api/cars`, and `/api/admin/stats` keep their method sets;
  record existing rule/method collisions as a baseline inventory so later
  stages can prove they introduce none. `/dealer/dashboard` is a frontend SPA
  route and is covered by Playwright rather than Flask's `url_map`.
- [ ] Run `./.venv/bin/pytest -q test_route_manifest.py` and confirm it fails
  because the manifest module does not exist.
- [ ] Implement immutable route-contract collection with Flask `url_map`
  inspection; exclude only static asset routes.
- [ ] Add `AGENTS.md` verification gates for focused, full backend, Docker,
  frontend, mobile, public E2E, authenticated E2E, and live E2E checks.
- [ ] Run the focused route-manifest test, then `./.venv/bin/pytest -q`.
- [ ] Commit the task with message `test(backend): freeze route contracts`.

### Task 2: Establish factory/runtime boundaries and extract platform routes

**Files:**
- Create: `flask-react-supabase-app/backend/application/runtime.py`
- Create: `flask-react-supabase-app/backend/application/errors.py`
- Create: `flask-react-supabase-app/backend/routes/health.py`
- Modify: `flask-react-supabase-app/backend/app.py`
- Modify: `flask-react-supabase-app/backend/test_api_error_contracts.py`

**Interfaces:**
- Produces `register_platform_routes(app) -> None`.
- Produces `register_api_error_handlers(app) -> None`.
- Produces `runtime_value(name) -> object` that reads
  `current_app.extensions['classifieds_runtime']` and raises a clear runtime
  error for a missing dependency.

- [ ] Write failing tests proving the extracted registration helpers preserve
  singleton health rules, JSON 404/405/413 responses, and security headers.
- [ ] Run the focused tests and verify failures are caused by absent modules.
- [ ] Implement the registration helpers and wire app runtime dependencies into
  `app.extensions['classifieds_runtime']` without importing `app.py` from the
  new modules.
- [ ] Move only health and error-handler definitions; preserve endpoint names
  and readiness/liveness behavior.
- [ ] Run focused tests, full backend pytest, and Docker API E2E.
- [ ] Commit with message `refactor(backend): extract platform route boundary`.

### Task 3: Extract public listing read contracts

**Files:**
- Create: `flask-react-supabase-app/backend/routes/listings/read.py`
- Create: `flask-react-supabase-app/backend/test_listing_read_route_parity.py`
- Modify: `flask-react-supabase-app/backend/app.py`

**Interfaces:**
- Produces `register_listing_read_routes(app) -> Blueprint`.
- Consumes runtime callables for Supabase requests, slug resolution, media URL
  normalization, and listing visibility checks.

- [ ] Write failing parity tests for the existing car, bike, plate, and part
  list/detail route methods, unauthenticated visibility, JSON envelope keys,
  and missing-record status behavior.
- [ ] Run the focused tests to verify they fail before the blueprint exists.
- [ ] Move one listing type at a time, beginning with cars, then bikes, plates,
  and parts; bind every original rule and endpoint name to the blueprint.
- [ ] Run the focused parity tests after each listing type and run full backend
  pytest after all four are moved.
- [ ] Run frontend Jest/build/bundle checks and public Playwright E2E.
- [ ] Commit each listing type separately using `refactor(listings): extract <type> read routes`.

### Task 4: Extract listing mutations, VIN, and media gates

**Files:**
- Create: `flask-react-supabase-app/backend/routes/listings/write.py`
- Create: `flask-react-supabase-app/backend/test_listing_write_route_parity.py`
- Modify: `flask-react-supabase-app/backend/app.py`

**Interfaces:**
- Produces `register_listing_write_routes(app) -> Blueprint`.
- Consumes identity, ownership, validation, auto-review, VIN, and media
  runtime callables without direct `app.py` imports.

- [ ] Write failing tests for unauthorized create/update/delete requests,
  ownership rejection, valid car/part/plate/bike payload acceptance, VIN gate
  response shape, and upload-size JSON 413 behavior.
- [ ] Run focused tests and confirm failure before the extracted blueprint is
  registered.
- [ ] Move mutation routes one listing type at a time while preserving existing
  validation and audit calls.
- [ ] Run focused tests, full backend pytest, Docker E2E, and credential-gated
  mutation E2E when disposable credentials and fixtures exist.
- [ ] Commit each moved listing type separately.

### Task 5: Extract identity, profile, verification, and contact routes

**Files:**
- Create: `flask-react-supabase-app/backend/routes/identity/auth.py`
- Create: `flask-react-supabase-app/backend/routes/identity/profile.py`
- Create: `flask-react-supabase-app/backend/test_identity_route_parity.py`
- Modify: `flask-react-supabase-app/backend/app.py`

**Interfaces:**
- Produces `register_identity_routes(app) -> tuple[Blueprint, Blueprint]`.
- Consumes auth verification, phone OTP, rate-limit, and notification
  callables from the runtime adapter.

- [ ] Write failing tests for token extraction, invalid-token 401 behavior,
  profile ownership, OTP send/verify rate limits, and contact rate limits.
- [ ] Run the focused tests and verify failure before extraction.
- [ ] Move auth/profile/phone/contact routes without altering cookie, bearer,
  or MSG91 contracts.
- [ ] Run focused tests, full backend pytest, frontend tests, mobile typecheck,
  mobile tests, and credential-gated login E2E when credentials exist.
- [ ] Commit with message `refactor(identity): extract auth and profile routes`.

### Task 6: Complete dealer and admin route ownership

**Files:**
- Modify: `flask-react-supabase-app/backend/routes/admin.py`
- Modify: `flask-react-supabase-app/backend/routes/dealer/*.py`
- Create: `flask-react-supabase-app/backend/routes/admin_web.py`
- Create: `flask-react-supabase-app/backend/test_admin_dealer_route_parity.py`
- Modify: `flask-react-supabase-app/backend/app.py`

**Interfaces:**
- Produces `register_admin_web_routes(app) -> Blueprint`.
- Uses existing dealer/admin service modules and preserves `admin_required`,
  dealer guards, audit events, and metric response structures.

- [ ] Write failing tests for unauthenticated 401/redirect behavior, dealer
  isolation, admin metric authorization, and dealer dashboard route parity.
- [ ] Run focused tests and verify absence of the extracted registration.
- [ ] Move the legacy `admin_web_bp` block into `routes/admin_web.py` with
  injected runtime helpers and no import cycle.
- [ ] Normalize registration of existing dealer/admin blueprints in one
  composition function.
- [ ] Run focused tests, full backend pytest, public E2E, and dealer/admin E2E
  when credentials exist.
- [ ] Commit with message `refactor(admin): extract admin web blueprint`.

### Task 7: Extract worker composition and lifecycle boundaries

**Files:**
- Create: `flask-react-supabase-app/backend/application/worker_registry.py`
- Modify: `flask-react-supabase-app/backend/worker.py`
- Modify: `flask-react-supabase-app/backend/workers/*.py`
- Create: `flask-react-supabase-app/backend/test_worker_registry.py`

**Interfaces:**
- Produces `build_worker_registry(runtime) -> tuple[WorkerSpec, ...]` where a
  worker has name, interval, lock key, heartbeat behavior, and callable.

- [ ] Write failing tests that assert no duplicate worker names or lock keys,
  that each worker records a heartbeat, and that an unavailable lock skips work
  without reporting success.
- [ ] Run the focused tests and verify the registry is absent.
- [ ] Implement registry-driven worker startup while preserving current worker
  names, intervals, and service role behavior.
- [ ] Run focused tests, full backend pytest, and Docker E2E with web and
  worker roles.
- [ ] Commit with message `refactor(worker): centralize worker registry`.

### Task 8: Shrink compatibility root and run release verification

**Files:**
- Modify: `flask-react-supabase-app/backend/app.py`
- Modify: `AGENTS.md`
- Modify: `.github/workflows/ci.yml`

- [ ] Add a failing size guard asserting `app.py` is below the documented
  stage target and contains no direct route decorators for migrated domains.
- [ ] Replace migrated legacy definitions with imports and compatibility
  registration calls only after parity tests pass.
- [ ] Add CI commands for manifest, backend, Docker E2E, frontend, mobile, and
  public Playwright checks.
- [ ] Run `git diff --check`, full backend pytest, Docker E2E, frontend Jest,
  production build/bundle/media audit, mobile typecheck/tests, and Playwright.
- [ ] Record credential-gated and live-only verification outcomes separately.
- [ ] Commit with message `refactor(backend): reduce legacy composition root`.

### Task 8u: Extract legacy moderation API ownership

**Files:**
- Create: `flask-react-supabase-app/backend/routes/moderation.py`
- Create or modify: `flask-react-supabase-app/backend/test_moderation_route_parity.py`
- Modify: `flask-react-supabase-app/backend/app.py`
- Modify: `flask-react-supabase-app/backend/workers/auto_review_worker.py` only if
  required for the compatibility callable

**Interfaces:**
- Produces a moderation route registration boundary for the generic approve,
  reject, and pending-list API routes currently implemented in `app.py`.
- Preserves the existing `_perform_approval` callable for the auto-review
  worker and direct tests through a compatibility export.

**Constraints:**
- Preserve route precedence against the existing `routes/admin.py` blueprint,
  including the canonical reject route; do not introduce a second live handler
  for the same rule.
- Preserve auth status codes, response envelopes, item-type validation,
  rejection-note requirements, notification best-effort behavior, and service
  role usage.
- Do not mix admin metrics, dealer verification, workers, or unrelated listing
  mutations into this task.
- Add contract tests before deleting the root implementations, then run the
  focused moderation/manifest suite and the full backend suite.

### Task 8v: Extract platform analytics event ingestion

**Files:**
- Create: `flask-react-supabase-app/backend/routes/platform_analytics.py`
- Create or modify: `flask-react-supabase-app/backend/test_platform_analytics_route_extraction.py`
- Modify: `flask-react-supabase-app/backend/app.py`
- Modify: `flask-react-supabase-app/backend/test_route_manifest.py`

**Interfaces:**
- Produces a route registration boundary for `POST /api/analytics/events`.
- Resolves Supabase access and optional user identity through the runtime
  boundary while preserving the `track_platform_event` endpoint contract.

**Constraints:**
- Preserve the current `201`, `200 duplicate`, `400`, and `503` response
  envelopes, event normalization, path classification, session/listing fields,
  and optional bearer-derived `user_id` behavior.
- Keep `normalize_analytics_event` and `ensure_platform_events_table` in the
  root if other routes/startup consumers still require them; do not move lead
  events, admin metrics, webhooks, or worker code in this task.
- Leave exactly one live rule with the original endpoint and methods.
- Add contract tests before deleting the root implementation, then run focused
  analytics/manifest tests and the full backend suite.

### Task 8w: Extract diagnostics config route

**Files:**
- Create: `flask-react-supabase-app/backend/routes/diagnostics.py`
- Create or modify: `flask-react-supabase-app/backend/test_diagnostics_route_extraction.py`
- Modify: `flask-react-supabase-app/backend/app.py`
- Modify: `flask-react-supabase-app/backend/test_route_manifest.py`

**Interfaces:**
- Produces a runtime-boundary registration helper for `GET /api/diagnostics/config`.

**Constraints:**
- Preserve the feature flag gate, admin authorization, masked-key response
  fields, status codes, and exception envelope; never expose full secrets.
- Keep exactly one live route and preserve the existing endpoint name.
- Do not move unrelated admin settings, metrics, auth, or provider routes.

### Task 8x: Extract public sitemap generation

**Files:**
- Create: `flask-react-supabase-app/backend/routes/sitemap.py`
- Create or modify: `flask-react-supabase-app/backend/test_sitemap_route_extraction.py`
- Modify: `flask-react-supabase-app/backend/app.py`
- Modify: `flask-react-supabase-app/backend/test_route_manifest.py`

**Interfaces:**
- Produces a runtime-boundary registration helper for `/api/sitemap.xml` and
  `/sitemap.xml`.

**Constraints:**
- Preserve the public XML content type, static URLs, active-listing filtering,
  XML escaping, pagination, cache key/TTL, cache headers, and malformed-upstream
  behavior.
- Preserve the existing `sitemap_xml` endpoint name for both aliases and keep
  exactly one live owner per path.
- Do not move unrelated recommendation, listing, admin, or SEO helper code.

### Task 8y: Extract recommendations HTTP family

**Files:**
- Create: `flask-react-supabase-app/backend/routes/recommendations.py`
- Create or modify: `flask-react-supabase-app/backend/test_recommendations_route_extraction.py`
- Modify: `flask-react-supabase-app/backend/app.py`
- Modify: `flask-react-supabase-app/backend/test_route_manifest.py`

**Interfaces:**
- Produces a runtime-boundary registration helper for `POST /api/recommendations`.
- Preserves compatibility exports for `get_recommendations` and any direct
  similar/newest recommendation callers.

**Constraints:**
- Preserve similar-listing, cold-start, viewed-history, preferred-type, price
  band, card/image hydration, response envelope, malformed-input, and upstream
  failure behavior.
- Keep shared saved-listing configuration/card/image helpers in the root when
  they have consumers outside this route; do not move unrelated user listing,
  analytics, admin, or worker code.
- Keep exactly one live route with endpoint `get_recommendations` and no app.py
  import in the extracted module.

### Task 8z: Extract admin user maintenance routes

**Files:**
- Create: `flask-react-supabase-app/backend/routes/admin_users.py`
- Create or modify: `flask-react-supabase-app/backend/test_admin_user_routes_extraction.py`
- Modify: `flask-react-supabase-app/backend/app.py`
- Modify: existing source-coupled tests only when they must follow the extracted
  production owner

**Interfaces:**
- Produces a runtime-boundary registration helper for admin user profile patch
  and unverified-account cleanup routes.
- Preserves compatibility exports for direct callers and worker/service helpers.

**Constraints:**
- Preserve admin/super-admin authorization, protected-field filtering, phone
  verification and dealer notification behavior, soft-delete/account cleanup,
  auth-user deletion, status codes, response envelopes, and error handling.
- Keep destructive cleanup logic isolated from background lifecycle workers and
  do not move unrelated dealer verification, metrics, or auth routes.
- Preserve exactly one live owner for each route and use no static app.py import.

### Task 8aa: Extract phone-verification HTTP routes

**Files:**
- Create: `flask-react-supabase-app/backend/routes/phone_verification.py`
- Create or modify: `flask-react-supabase-app/backend/test_phone_verification_route_extraction.py`
- Modify: `flask-react-supabase-app/backend/app.py`
- Modify: `flask-react-supabase-app/backend/test_route_manifest.py`
- Modify existing source-coupled phone tests only when required to follow the
  extracted production owner

**Interfaces:**
- Produces a runtime-boundary registration helper for the three phone
  verification HTTP routes: start, verify, and MSG91 verify-token.

**Constraints:**
- Preserve optional/authenticated token behavior, IP rate limits, purpose and
  listing binding, resend semantics, MSG91 routing, Infobip issuance/finalize
  behavior, exact response messages/statuses, and sensitive error handling.
- Leave shared normalization, persistence, provider, and listing-sync helpers
  in their existing ownership unless their direct call contracts require a
  compatibility export.
- Keep exactly one live owner per route and no static app.py import; do not move
  VIN/admin routes, profile routes, or workers in this task.

### Task 8ab: Extract email and error admin metrics routes

**Files:**
- Create: `flask-react-supabase-app/backend/routes/admin_metrics.py`
- Create or modify: `flask-react-supabase-app/backend/test_admin_metrics_route_extraction.py`
- Modify: `flask-react-supabase-app/backend/app.py`
- Modify: `flask-react-supabase-app/backend/test_route_manifest.py`

**Interfaces:**
- Produces a runtime-boundary registration helper for `GET
  /api/admin/metrics/email` and `GET /api/admin/metrics/errors`.

**Constraints:**
- Preserve endpoint names, automatic `HEAD`/`OPTIONS`, admin authorization,
  days clamping, cache keys/TTLs, missing-table envelopes, upstream errors,
  and response shapes.
- Preserve the distinction between the existing admin-auth helpers; do not
  replace the route-specific authorization contract with a generic guard.
- Keep overview/stats/live-user/Cloudflare analytics and unrelated helpers in
  `app.py`; use `current_app` runtime dependencies and no static app import.
- Keep exactly one live owner for each route and retain compatibility exports
  for direct callers or source-coupled tests.

### Task 8ac: Extract live-user metrics routes

**Files:**
- Create: `flask-react-supabase-app/backend/routes/live_users.py`
- Create or modify: `flask-react-supabase-app/backend/test_live_users_route_extraction.py`
- Modify: `flask-react-supabase-app/backend/app.py`
- Modify: `flask-react-supabase-app/backend/test_route_manifest.py`

**Interfaces:**
- Produces a runtime-boundary registration helper for
  `GET /api/admin/live-users` and `GET /api/admin/live-users/history`.

**Constraints:**
- Preserve admin authorization, lookback/bucket clamping, cache keys/TTLs,
  service-role reads, timestamp normalization, empty-bucket behavior, and
  response/error envelopes.
- Keep Cloudflare, overview/stats aggregation, dealer flows, and workers out of
  this slice; use no static `app.py` import.
- Preserve endpoint names and exactly one live owner per path, including
  automatic `HEAD`/`OPTIONS` behavior and compatibility exports.

### Task 8ad: Extract admin dealer information-request controls

**Files:**
- Create: `flask-react-supabase-app/backend/routes/dealer_info_requests.py`
- Create or modify: `flask-react-supabase-app/backend/test_dealer_info_request_route_extraction.py`
- Modify: `flask-react-supabase-app/backend/app.py`
- Modify: source-coupled dealer lifecycle tests only when they must follow the
  extracted production owner

**Interfaces:**
- Produces a runtime-boundary registration helper for admin create/list/cancel
  information-request controls.

**Constraints:**
- Extract only the three admin routes; keep public token retrieval/upload,
  signed URLs, MIME/signature validation, and lifecycle submission separate.
- Preserve admin authorization, dealer verification state checks, document
  normalization/deduplication, pending-request cancellation, Resend
  email_sent/email_error behavior, redaction/signing of private attachments,
  response envelopes, and known path/method collision behavior.
- Keep shared document-label and provider helpers in their current ownership
  unless direct-call compatibility requires runtime exports.
- Use no static `app.py` import and preserve exactly one live route owner.

### Task 8ae: Extract public dealer information-request lookup

**Files:**
- Create: `flask-react-supabase-app/backend/routes/public_info_request.py`
- Create or modify: `flask-react-supabase-app/backend/test_public_info_request_route_extraction.py`
- Modify: `flask-react-supabase-app/backend/app.py`
- Modify: source-coupled dealer lifecycle tests only when they must follow the
  extracted public lookup owner

**Interfaces:**
- Produces a runtime-boundary registration helper for `GET
  /api/info-requests/<token>`.

**Constraints:**
- Preserve token-length validation, public token authorization, expiry mutation,
  dealer-name-only lookup, upload metadata redaction, status/envelopes, and
  error handling.
- Keep public multipart upload, storage writes, MIME/signature validation, and
  lifecycle transitions in a separate task; use no static `app.py` import.

### Task 8af: Extract report create/list routes

**Files:**
- Create: `flask-react-supabase-app/backend/routes/reports.py`
- Create or modify: `flask-react-supabase-app/backend/test_reports_route_extraction.py`
- Modify: `flask-react-supabase-app/backend/app.py`
- Modify: `flask-react-supabase-app/backend/test_route_manifest.py`

**Interfaces:**
- Produces a runtime-boundary registration helper for `POST` and `GET
  /api/reports`.

**Constraints:**
- Preserve the intentional GET/POST path collision, token auth, validation,
  reporter/admin scoping, notification best-effort behavior, write payloads,
  response/status/error envelopes, and compatibility exports.
- Keep admin status patching and analytics/contact helpers separate; use no
  static `app.py` import.

### Task 8ag: Extract public dealer information-request upload

Status: complete in commit `56445c34`.

**Files:**
- Create: `flask-react-supabase-app/backend/routes/public_info_upload.py`
- Create or modify: `flask-react-supabase-app/backend/test_public_info_upload_route_extraction.py`
- Modify: `flask-react-supabase-app/backend/app.py`
- Modify: source-coupled dealer lifecycle/media tests only when they must follow
  the extracted upload owner

**Interfaces:**
- Produces a runtime-boundary registration helper for `POST
  /api/info-requests/<token>/upload`.

**Constraints:**
- Preserve token authorization, request expiry/status/quota checks, multipart
  validation, MIME/signature and size limits, private storage writes, canonical
  dealer-document replacement, upload row creation, submitted-state transitions,
  and exact safe error envelopes.
- Keep shared validators, storage helpers, label mapping, and dealer lifecycle
  readiness helpers in their existing ownership unless runtime compatibility
  requires exports; use no static `app.py` import.
- Do not move unrelated public lookup, admin controls, or worker code.

### Task 8ah: Extract public car detail route

Status: complete in commit `58028479`.

The public `/api/cars/<string:car_id>` route now lives in
`routes/car_detail.py`, with runtime dependency resolution and the existing VIN
privacy, visibility, caching, image, seller, and lifecycle contracts covered by
the existing VIN suite plus a dedicated route-boundary test.

### Task 8ai: Extract plate and car-part detail helpers

Status: complete in commit `21fe38e1`.

The optional-auth GET dispatch targets for plates and car parts now live in
`routes/listing_details.py`, preserving compatibility exports and existing
plate/part read-parity behavior.

### Task 8aj: Extract public price-history route

Status: complete in commit `a9e1a922`.

The public listing price-history endpoint now lives in `routes/price_history.py`
with its approved-listing and migration-fallback contracts preserved.

### Task 8ak: Extract admin metrics overview route

Status: complete in commit `2c464a74`.

Scope: move `/api/admin/metrics/overview` into a runtime-bound route module,
preserving the admin guard, paginated analytics reads, platform metric shape,
Cloudflare override/fallback behavior, cache coordination, compatibility
export, and route manifest. Add direct contract coverage for cache hits,
provider fallback, and error responses before running the full backend suite.

Out of scope: `/api/admin/stats`, unified admin listing search, Cloudflare
diagnostics, and lifecycle/reminder worker composition; those remain separate
coupled stages. Focused suite: `6 passed`; full backend suite: `1204 passed,
11 skipped, 56 warnings`.

### Task 8al: Extract admin stats route

Status: complete in commit `f32bcdca`.

Scope: move `/api/admin/stats` into a runtime-bound route module while keeping
the existing shared pagination, lifecycle summary, visitor identity, lead
deduplication, Cloudflare override, cache, and admin authorization contracts.

Out of scope: the shared lifecycle-summary helpers, unified admin listing
search, Cloudflare diagnostics, and background lifecycle/reminder workers.
Focused suite: `35 passed`; full backend suite: `1208 passed, 11 skipped,
56 warnings`.

### Task 8am: Extract unified admin listing search route

Status: complete in commit `053542e2`.

Scope: move `/api/admin/listings-search` into a runtime-bound route module,
preserving type/source/status filters, draft and buying-request handling,
per-type limits, image normalization, verification enrichment, admin guards,
metadata counts, compatibility exports, and route precedence.

Out of scope: shared preview/normalization helpers and admin mutation routes;
they remain root-owned until their own consumer contracts are mapped.
Focused suite: `76 passed`; full backend suite: `1212 passed, 11 skipped,
56 warnings`.

### Task 8an: Extract Reddit-import analytics route

Status: complete in commit `ab6a0834`.

Scope: move `/api/admin/reddit-import-analytics` into a runtime-bound module,
preserving aggregate-only privacy, import-category rollups, event windowing,
top-listing shaping, latest-run health, admin auth, cache, and compatibility
exports.
Focused suite: `60 passed`; full backend suite: `1215 passed, 11 skipped,
56 warnings`.

### Task 8ao: Extract user lead-metrics route

Status: complete in commit `6a839203`.

Scope: move `/api/user/lead-metrics` into a runtime-bound route module while
preserving authenticated owner scoping, listing-type normalization, days
clamping, zero-owner behavior, recent-event shaping, and error envelopes.
Focused suite: `14 passed`; full backend suite: `1219 passed, 11 skipped,
56 warnings`.

### Task 8ap: Extract public listing lead-event route

Status: complete in commit `9dada2bc`.

Scope: move `POST /api/listings/<item_type>/<item_id>/lead-events` into a
runtime-bound module, preserving listing-type validation, rate limiting,
canonical and legacy event writes, optional auth, bot metadata, seller push
notifications, response/status envelopes, and compatibility exports.

Out of scope: analytics aggregation routes and the provider-backed notification
helpers themselves.
Focused suite: `19 passed`; full backend suite: `1223 passed, 11 skipped,
56 warnings`.

### Task 8aq: Extract authenticated listing repost route

Status: complete in commit `pending`.

Scope: move `POST /api/user/listings/<item_type>/<item_id>/repost` into a
runtime-bound module, preserving ownership and deleted-state gates, listing
limits, dealer verification, lifecycle-field stripping, image cloning,
original dismissal, cache invalidation, response contracts, and auth.

Out of scope: shared repost/image/lifecycle helpers and the adjacent dismiss
route.

### Task 8ar: Extract admin dealer-document review route

Status: complete in commit `57fd0ccc`.

Scope: move `POST /api/admin/dealer-documents/<doc_id>/review` into a
runtime-bound module, preserving admin auth, action validation, document lookup,
status updates, denial metadata, dealer application state changes, denial email
behavior, and safe error responses.

Out of scope: shared dealer policy evaluation, document listing/upload routes,
and email provider implementation.
Focused dealer-document/manifest suite: `95 passed`; full backend suite: `1231 passed, 11 skipped,
56 warnings`.

The route is registered once with its legacy endpoint and resolves admin,
Supabase, and email dependencies through the runtime backend registry. The
source-coupled lifecycle contract now inspects the extracted module as well as
the compatibility root.

### Task 8as: Extract dealer admin verify/reject actions

Status: complete in commit `3e6e6c91`.

Scope: move `POST /api/admin/dealers/<dealer_id>/verify` and
`POST /api/admin/dealers/<dealer_id>/reject` into the runtime-bound dealer admin
action module, preserving admin auth, reason/note validation, readiness gates,
user state transitions, response/status envelopes, notification behavior, and
compatibility exports.

Out of scope: dealer document policy evaluation, document review, and shared
email/provider helpers.
Focused suite: `99 passed`; full backend suite: `1239 passed, 11 skipped,
57 warnings`.

### Task 8at: Extract admin dealer-document listing route

Status: complete in commit `cb2bda59`.

Scope: move `GET /api/admin/dealers/<dealer_id>/documents` into the existing
runtime-bound dealer document module, preserving admin auth, private signed-URL
shaping, provider query/error behavior, response envelopes, and the legacy
compatibility export.

Focused suite: `105 passed`; full backend suite: `1241 passed, 11 skipped,
57 warnings`.

### Task 8au: Extract admin dealer listing-limit decision route

Status: complete in commit `pending`.

Scope: move `POST /api/admin/dealer/listing-upgrade-requests/<request_id>/decision`
into a runtime-bound module, preserving admin authorization, pending/resolved
guards, pure decision validation, user-limit/history writes, notification
behavior, response envelopes, and the compatibility export.

Out of scope: the dealer upgrade-request creation/list routes and the shared
decision validator.
Focused suite: `40 passed`; full backend suite: `1251 passed, 11 skipped,
57 warnings`.

### Task 8av: Extract admin upgrade-request queue route

Status: complete in commit `c565d6f8`.

Scope: move `GET /api/admin/dealer/listing-upgrade-requests` into the existing
runtime-bound upgrade-decision module, preserving admin authorization, status
filtering, missing-table hints, dealer enrichment, response shaping, and the
legacy compatibility export.

Focused suite: `41 passed`; full backend suite: `1252 passed, 11 skipped,
57 warnings`.

### Task 8aw: Extract dealer upgrade-request creation route

Status: complete in commit `65c162a5`.

Scope: move `POST /api/dealer/listing-upgrade-requests` into the runtime-bound
upgrade-decision module, preserving dealer/verification guards, validator
status mapping, duplicate-pending conflict handling, missing-table hints,
request persistence, best-effort admin notification, and the compatibility
export.

Out of scope: the shared dealer policy, validator, notification provider, and
database migration.
Focused suite: `43 passed`; full backend suite: `1254 passed, 11 skipped,
57 warnings`.

### Task 8ax: Extract authenticated user listing inventory reads

Status: complete in the current staged checkpoint.

Scope: move `GET /api/user/cars`, `/api/user/bikes`, `/api/user/plates`,
`/api/user/parts`, and `/api/user/listings` into
`routes/user_listing_index.py`, preserving category hydration, bike
normalization, status filtering, newest-first ordering, listing-limit metadata,
auth behavior, route methods, and compatibility exports.

Focused extraction/lifecycle suite: `10 passed`; full backend suite:
`1257 passed, 11 skipped, 57 warnings` before the following action slice.

### Task 8ay: Extract authenticated terminal-listing dismissal

Status: complete in the current staged checkpoint.

Scope: move `POST /api/user/listings/<item_type>/<item_id>/dismiss` into
`routes/user_listing_actions.py`, preserving ownership checks, terminal-state
policy, idempotency, scoped service-role patching, auth behavior, route methods,
and compatibility exports.

Focused action/index/lifecycle suite: `10 passed`; full backend suite:
`1261 passed, 11 skipped, 57 warnings`; `app.py` is `15,008` lines.

### Task 8az: Extract public contact and missing-model request routes

Status: complete in the current staged checkpoint.

Scope: move `POST /api/contact` and `POST /api/car-model-request` into bounded
runtime-proxy modules, preserving validation order, rate limiting, provider
configuration/error mapping, escaped notification payloads, response envelopes,
route methods, and compatibility exports.

Focused contact/model-request suite: `10 passed`; full backend suite:
`1266 passed, 11 skipped, 57 warnings` before the following upload slice.

### Task 8ba: Extract signed storage-upload URL route

Status: complete in the current staged checkpoint.

Scope: move `POST /api/storage/signed-upload-url` into
`routes/storage_upload.py`, preserving authenticated bucket/path/MIME/size/
extension validation, storage-bucket readiness, signed URL provider mapping,
response/status contracts, and compatibility export.

Focused storage/security suite: `7 passed`; full backend suite:
`1274 passed, 11 skipped, 57 warnings`; compileall passed; `app.py` is
`14,857` lines.

### Task 8bb: Extract featured-listing and placement routes

Status: complete in the current staged checkpoint.

Scope: move featured-listing hydration, admin create/list/update/delete,
public listing reads, and admin/public placement-pattern routes into
`routes/featured_listings.py`, preserving admin gates, public visibility
filtering, upsert/refetch behavior, Redis fallback, response/status contracts,
route methods, and compatibility exports.

Focused featured/audit/manifest suite: `51 passed`; full backend suite:
`1277 passed, 11 skipped, 57 warnings`; compileall passed; `app.py` is
`14,524` lines.

### Task 8bc: Extract admin saved-search analytics route

Status: complete in the current staged checkpoint.

Scope: move `GET /api/admin/saved-searches` into
`routes/admin_saved_searches.py`, preserving the admin gate, date/limit
clamping, service-role reads, owner enrichment, category summary,
missing-table handling, response/status contract, route methods, and
compatibility export.

Focused saved-search suite: `5 passed`; full backend suite:
`1280 passed, 11 skipped, 57 warnings`; compileall passed; `app.py` is
`14,476` lines.

### Task 8bd: Extract authenticated admin-status check

Status: complete in the current staged checkpoint.

Scope: move `GET /api/auth/admin-check` into `routes/admin_check.py`, preserving
token enforcement, service-role lookup, super-admin resolution, fail-closed
missing-user/provider handling, response/status contract, route methods, and
compatibility export.

Focused admin-check/guard suite: `18 passed`; full backend suite:
`1284 passed, 11 skipped, 57 warnings`; compileall passed; `app.py` is
`14,428` lines.

### Task 8be: Complete dealer verification message routes

Status: complete in the current staged checkpoint.

Scope: move dealer verification notification and message-timeline handlers
into `routes/dealer_verification.py`, preserving original unprefixed endpoint
names, dealer-only authorization, audit insert, notification isolation,
provider-error mapping, response/status contracts, and compatibility exports.

Focused dealer verification suite: `82 passed`; full backend suite:
`1288 passed, 11 skipped, 57 warnings`; compileall passed; `app.py` is
`14,345` lines.

### Task 8bf: Extract legacy authenticated user-list route

Status: complete in the current staged checkpoint.

Scope: move `GET /api/users` into `routes/users_legacy.py`, preserving its
admin/super-admin gate, service-role fetch, 206 partial-content envelope,
response/status contract, route methods, and compatibility export.

Focused legacy-user suite: `5 passed`; full backend suite:
`1292 passed, 11 skipped, 57 warnings`; compileall passed; `app.py` is
`14,302` lines.

### Task 8bg: Extract legacy public license-plate read route

Status: complete in the current staged checkpoint.

Scope: move `GET /api/license-plates` into
`routes/license_plates_legacy.py`, preserving approved-only filters, query
parameters, cache behavior, seller enrichment, response/status contract, route
methods, and compatibility export.

Focused plate-read suite: `19 passed`; full backend suite:
`1295 passed, 11 skipped, 57 warnings`; compileall passed; `app.py` is
`14,268` lines.

### Task 8bh: Extract public policy and advertisement routes

Status: complete in commit `5a866abb`.

Scope: move `GET /api/privacy-policy` and `GET /api/advertisements` into a
runtime-bound public-content module, preserving newest-row queries, service-role
advertisement reads, response/status contracts, route methods, and compatibility
exports.

Focused extraction/manifest suite: `14 passed`; compileall passed.

### Task 8bi: Extract deprecated listing-view shims

Status: complete in commit `4d48b7ae`.

Scope: move the four deprecated car, bike, plate, and part `/view` POST shims
into a runtime-bound compatibility module. Preserve the non-mutating 202
canonical-analytics response, route methods, endpoint names, and compatibility
exports.

Focused shim/analytics/manifest suite: `20 passed`; compileall passed.

Ruling: Do not mechanically extract lifecycle/reminder bodies. The next stage
is a pure worker-composition registry with injected callables and contract tests,
followed by one bounded admin/diagnostic route at a time. Credentialed local and
live provider E2E remain release gates.

### Task 8bj: Integrate validated worker composition

Status: complete in commit `pending`.

Scope: make `worker.py` use the validated worker registry for all scheduled
jobs, preserving environment-configured intervals, thread names, adaptive
backoff, and shutdown joins. Correct zero-work mapping for structured results
such as `{processed: 0, sent: 0}`. Lifecycle/reminder implementations remain
compatibility callables in `app.py` until separately contract-tested.

Focused worker registry/integration suite: `21 passed`; worker Docker smoke
passed with health 200 and a Redis heartbeat.

### Task 8bk: Move beta verification into public auth

Status: complete in commit `pending`.

Scope: move `POST /api/auth/beta-verify` into the existing public-auth
blueprint, preserving disabled-gate, missing-password, wrong-password, success
responses, endpoint identity, and compatibility export.

Focused beta/manifest suite: `12 passed`; compileall passed.

### Task 8bl: Extract and order legacy car CORS preflight routes

Status: complete in commit `pending`.

Scope: move the explicit car preflight handlers into a runtime-bound module,
preserving the CORS headers and compatibility exports while registering them
before Flask's automatic OPTIONS rules so configured origins receive the
intended response.

Focused CORS/manifest suite: `13 passed`; compileall passed.

### Task 8bm: Extract Resend webhook route

Status: complete in commit `pending`.

Scope: move `POST /api/webhooks/resend` into a runtime-bound module,
preserving signature validation, event-to-column mapping, service-role updates,
missing-ID behavior, status envelopes, endpoint identity, and compatibility
export.

Focused webhook/manifest suite: `14 passed`; compileall passed.
