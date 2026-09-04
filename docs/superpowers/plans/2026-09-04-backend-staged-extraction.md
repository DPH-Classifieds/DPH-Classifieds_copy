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
