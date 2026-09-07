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
