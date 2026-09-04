# Classifieds Stabilization and End-to-End Verification Design

**Goal:** Make the currently failing mobile, Docker, test, bundle, and deployment gates reliable while incrementally reducing backend coupling and adding a repeatable E2E suite for public, authenticated, dealer, admin, posting, and VIN flows.

**Scope:** This first implementation keeps existing API behavior stable and targets the failures identified in `auditissues.md`. It does not perform a blind rewrite of the Flask monolith or delete historical migrations without schema evidence.

## Architecture

The Flask application remains the composition root while route groups are extracted behind blueprints one bounded surface at a time. Each extraction receives route-parity tests before the old definition is removed. Shared lifecycle work moves to batch-oriented service helpers with an explicit lock boundary so repeated worker processes cannot run the same sweep concurrently.

The frontend will use route-level lazy loading for dealer and other heavy screens. The API client becomes the canonical API-base and token-retry boundary. Bundle budgets will be enforced in CI using the production build output rather than relying on warnings.

Mobile route shims will share a permissive navigation/route prop contract, while optional native integrations remain dynamically loaded. Development-only HTTP access will be explicit and production configuration will use one canonical API origin.

## Implementation units

- `flask-react-supabase-app/backend/Dockerfile`: preserve the virtualenv path when launching gunicorn and worker roles.
- `flask-react-supabase-app/backend/workers/reddit_import_worker.py` plus its tests: make parsed Reddit records tolerate missing optional category data without losing VIN deduplication.
- `flask-react-supabase-app/backend/app.py` and new route/service modules: extract health/auth/public listing boundaries, remove duplicate registrations, add JSON API error responses, and move late route definitions before the development runner.
- `flask-react-supabase-app/backend/workers/`: introduce bounded batch lifecycle operations and a distributed lock adapter with unit coverage.
- `flask-react-supabase-app/backend/migrations/` and `scripts/`: add a migration ledger/pending runner and schema-contract checks; existing migrations remain untouched until their applied state is proven.
- `flask-react-supabase-app/frontend/src/App.js`, `frontend/src/utils/`, and deployment config: lazy-load heavy routes, consolidate API/auth configuration, and repair Vercel/CSP/metadata contracts.
- `flask-react-supabase-app/mobile/app/`, `mobile/src/constants/`, `mobile/src/utils/`, and `mobile/app.json`: resolve TypeScript contracts, safe areas, API ports, Android dev networking, and MSG91 loading.
- `tests/e2e/` or the established backend E2E location: add deterministic Playwright/browser tests for responsive public routes, scroll behavior, auth, dealer sign-up, all four posting flows, VIN reveal, dealer suite, and admin metrics. Credentials and OTP/email test hooks will be environment-driven and never committed.
- `.github/workflows/`: add CI jobs for backend, frontend, mobile, Docker smoke E2E, bundle budgets, and migration/schema checks.

## Test strategy

Every bug fix begins with a focused failing regression test, followed by the smallest implementation and a full relevant-suite run. The E2E suite will use seeded test data and environment variables such as `E2E_BASE_URL`, `E2E_API_URL`, `E2E_USER_EMAIL`, `E2E_USER_PASSWORD`, `E2E_DEALER_EMAIL`, `E2E_DEALER_PASSWORD`, `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`, and an optional mailbox/OTP adapter. Without those values, protected tests fail clearly as skipped prerequisites rather than silently claiming success.

The release gate is:

1. Backend unit/integration tests have zero failures.
2. Frontend tests and production build pass under the bundle budget.
3. Mobile tests and `tsc --noEmit` pass.
4. Docker web and worker smoke containers become ready.
5. Local E2E covers all requested flows at desktop, tablet, and mobile breakpoints.
6. Live E2E is run only after credentials are supplied, and its results are reported separately from local results.

## Explicit non-goals for this pass

- Replacing Flask wholesale with a new framework.
- Deleting or rewriting old migrations without a migration ledger and applied-schema comparison.
- Claiming live RLS, OTP, email delivery, admin metrics, or successful listing creation without valid test credentials and isolated test data.

