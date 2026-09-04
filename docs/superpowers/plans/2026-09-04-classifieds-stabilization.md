# Classifieds Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** Remove the known failing gates, reduce frontend initial-load cost, make backend startup and health contracts deterministic, and add repeatable local/live E2E coverage without changing the public API contract.

**Architecture:** Keep Flask as the composition root while extracting only verified route boundaries. Use tests to lock behavior before moving code. Make the API client and environment contract canonical, and make protected E2E tests credential-driven with explicit prerequisite skips.

**Tech Stack:** Flask/Gunicorn/Pytest, React 18/CRA/Jest, Expo Router/TypeScript/Jest, Docker, Playwright, GitHub Actions, Supabase SQL migrations.

---

### Task 1: Fix the Reddit worker regression

**Files:**
- Modify: `flask-react-supabase-app/backend/workers/reddit_import_worker.py:340-355`
- Test: `flask-react-supabase-app/backend/tests/test_reddit_vin_dedup.py`

- [ ] Add a regression assertion that a parsed Reddit object without `category` does not raise `AttributeError`, while VIN deduplication still runs for cars.
- [ ] Run the three previously failing tests and confirm the failure is the missing optional attribute.
- [ ] Implement `getattr(parsed, "category", None)` and apply category filtering only when a category is present.
- [ ] Run the focused file, then the full backend suite.

### Task 2: Make Docker web and worker images runnable

**Files:**
- Modify: `flask-react-supabase-app/backend/Dockerfile:27`
- Test: `flask-react-supabase-app/backend/e2e/run.sh`

- [ ] Reproduce `gunicorn: not found` with `./e2e/run.sh`.
- [ ] Replace the login shell command with a POSIX shell command that invokes `/opt/venv/bin/gunicorn` and `/opt/venv/bin/python` explicitly.
- [ ] Run the Docker E2E script and require liveness, readiness, and public API checks to pass.

### Task 3: Resolve mobile TypeScript and runtime configuration failures

**Files:**
- Modify: `flask-react-supabase-app/mobile/app/(auth)/*.tsx`
- Modify: `flask-react-supabase-app/mobile/app/(tabs)/**/*.tsx`
- Modify: `flask-react-supabase-app/mobile/app/_layout.tsx`
- Modify: `flask-react-supabase-app/mobile/src/constants/config.js`
- Modify: `flask-react-supabase-app/mobile/src/screens/auth/SignupScreen.js`
- Modify: `flask-react-supabase-app/mobile/src/screens/auth/CheckEmailScreen.js`
- Modify: `flask-react-supabase-app/mobile/src/utils/msg91.js`
- Modify: `flask-react-supabase-app/mobile/app.json`
- Test: existing mobile tests plus a new `mobile/src/utils/__tests__/config.test.js` if needed

- [ ] Run `npx tsc --noEmit` and capture the first route-prop and PostHog failures.
- [ ] Define one shared optional prop type for route shims: `navigation?: any; route?: { params?: Record<string, unknown> }`.
- [ ] Change `_layout.tsx` to pass `posthog ?? undefined` and add `SafeAreaProvider`.
- [ ] Import the canonical `API_BASE_URL` in auth screens instead of hardcoded port 5000.
- [ ] Defer MSG91’s native `require` until the enabled initialization path and return a clear unsupported-environment error in Expo Go.
- [ ] Enable development cleartext only through the existing Expo configuration path and keep production HTTPS unchanged.
- [ ] Run mobile Jest and `npx tsc --noEmit`.

### Task 4: Reduce frontend initial bundle cost

**Files:**
- Modify: `flask-react-supabase-app/frontend/src/App.js:1-35`
- Modify: `flask-react-supabase-app/frontend/src/utils/apiClient.js`
- Modify: `flask-react-supabase-app/frontend/src/context/AuthContext.js`
- Modify: `flask-react-supabase-app/frontend/src/components/dealer/*.jsx`
- Modify: `flask-react-supabase-app/frontend/package.json`
- Test: existing frontend Jest tests plus `frontend/scripts/check-bundle-size.js`

- [ ] Capture the current production build’s largest JavaScript files and record a failing budget test for the initial bundle.
- [ ] Replace synchronous dealer imports with `React.lazy(() => import(...))` and render them through the existing suspense boundary.
- [ ] Remove duplicate API-base fallbacks and make `apiClient.js` the only frontend API origin helper.
- [ ] Route auth user refreshes through the canonical auth client while preserving Supabase token semantics.
- [ ] Add a build-size checker that fails only when the main initial JS entry exceeds the agreed budget and reports lazy chunk sizes separately.
- [ ] Run frontend tests, build, bundle checker, and media audit.

### Task 5: Repair backend API, health, and deployment contracts

**Files:**
- Modify: `flask-react-supabase-app/backend/app.py`
- Modify: `scripts/check-api.sh`
- Modify: `nixpacks.toml`
- Modify: `railway.json`
- Modify: `flask-react-supabase-app/frontend/.env.production`
- Modify: `vercel.json`
- Modify: `flask-react-supabase-app/frontend/vercel.json`
- Test: backend API tests and deployment config tests

- [ ] Add tests for JSON 404/405/413 responses on `/api/*` and for canonical liveness/readiness routes.
- [ ] Remove or rename the duplicate `/api/health` handler and place late route declarations before the development runner.
- [ ] Change the health script to test `/healthz/live` and `/healthz`.
- [ ] Make production fail fast when `FLASK_SECRET_KEY` is missing or still a placeholder.
- [ ] Set Railway’s backend root directory explicitly and use one canonical API URL in frontend production configuration.
- [ ] Remove the `/cars/(.*)` API rewrite from the SPA deployment configuration and retain only the SPA fallback plus security headers.
- [ ] Expand CSP `connect-src` for local development through an environment-controlled allow-list, never by weakening production defaults.

### Task 6: Add lifecycle batching and worker coordination

**Files:**
- Create: `flask-react-supabase-app/backend/services/lifecycle_batch.py`
- Modify: `flask-react-supabase-app/backend/app.py`
- Modify: `flask-react-supabase-app/backend/worker.py`
- Test: `flask-react-supabase-app/backend/tests/test_lifecycle_batch.py`

- [ ] Write tests proving expired listing IDs are fetched once, updated in one bounded batch, and skipped when the distributed lock is unavailable.
- [ ] Implement a small batch helper using existing Supabase client/RPC conventions and a lock key scoped to each sweep.
- [ ] Replace serial per-row update loops in the three lifecycle sweeps with the helper while retaining existing status transitions and audit events.
- [ ] Run worker/lifecycle tests and the full backend suite.

### Task 7: Add deterministic migration ledger and schema contracts

**Files:**
- Create: `flask-react-supabase-app/backend/migrations/20260904000001_schema_migrations.sql`
- Create: `flask-react-supabase-app/backend/scripts/migrate_pending.py`
- Modify: `flask-react-supabase-app/backend/apply_migration.py`
- Create: `flask-react-supabase-app/backend/tests/test_migration_runner.py`
- Create: `flask-react-supabase-app/backend/tests/test_schema_contracts.py`

- [ ] Test migration ordering, checksum recording, idempotency, and refusal to silently reapply a changed migration.
- [ ] Add `schema_migrations` with filename, checksum, applied timestamp, and execution metadata.
- [ ] Implement `migrate_pending.py --dry-run` and `--apply` using the existing Supabase SQL execution path; default to dry-run in CI.
- [ ] Add schema-contract tests for the fields consumed by homepage preview and listing detail queries.
- [ ] Do not delete old migrations; report duplicates and drift for a later reviewed cleanup.

### Task 8: Build the requested E2E suite and CI gate

**Files:**
- Create: `flask-react-supabase-app/frontend/e2e/classifieds.spec.js`
- Create: `flask-react-supabase-app/frontend/playwright.config.js`
- Create: `.github/workflows/ci.yml`
- Modify: `flask-react-supabase-app/frontend/package.json`
- Modify: `flask-react-supabase-app/backend/e2e/run.sh`

- [ ] Add unauthenticated tests for every public route at desktop/tablet/mobile viewports, top/down/up scrolling, no horizontal overflow, and no broken images.
- [ ] Add credential-driven tests for login, dealer sign-up, car, bike, plate, part, buying-request posting, VIN reveal, dealer suite, and admin metrics.
- [ ] Use isolated test identities and deterministic cleanup hooks; skip protected tests with an explicit reason when credentials or mailbox/OTP adapters are absent.
- [ ] Add CI jobs for backend, frontend, mobile, Docker E2E, bundle budgets, and migration dry-run.
- [ ] Run the full local E2E suite against a fresh local backend/frontend startup.

### Task 9: Final verification and handoff

- [ ] Run backend pytest, frontend test/build/bundle audit, mobile test/typecheck, Docker E2E, and Playwright E2E from the worktree.
- [ ] Inspect `git diff --check`, `git status`, and the final changed-file list.
- [ ] Report any live-only gates requiring supplied credentials separately; do not claim authenticated or production success without evidence.

