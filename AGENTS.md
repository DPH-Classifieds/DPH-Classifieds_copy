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
authenticated user-route extraction through commit `34fde531`. The session and
recovery authentication extraction is staged after that commit, and the public
login/signup/username extraction is now verified at the current head. The canonical
saved-listings, saved-searches, and push-token routes live in
`flask-react-supabase-app/backend/routes/user.py`; the module must remain free
of static `app.py` imports and resolve runtime services through
`current_app.extensions["dph_user_backend"]`.

The verified local baseline for the current staged listing-mutation slice is:
`app.py` 20,198 lines; the focused bike-update/manifest suite is `13 passed`; the
full backend suite is `1085 passed, 11 skipped, 53 warnings`; Docker API
liveness/readiness/404/auth-gate
smoke and worker health plus Redis heartbeat smoke passed. Frontend Jest is
`153 passed`, CRA build/bundle/media checks passed, mobile TypeScript and Jest
are `261 passed`, and public Playwright is `48 passed, 27 credential-gated
skips` across desktop/tablet/mobile. Protected browser flows remain
credential-gated and must not be reported as passed when their disposable
credentials and target environment are absent.

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

The authenticated listing extension route is isolated in
`routes/listing_lifecycle.py`; admin bulk lifecycle handlers remain in the
compatibility root until their larger shared block is separately contract-tested.

The authenticated car update route, including JSON/multipart image replacement,
lives in `routes/car_update.py`; its compatibility aliases and existing direct
upload contract are retained.

The authenticated bike update and delete routes live in `routes/bike_update.py`.
They retain JSON aliases, ownership/validation gates, image replacement fallback,
notifications, cache invalidation, and direct-call compatibility. Client-supplied
`status` and `user_id` are explicitly excluded from bike mutation writes.

Any further app.py reduction must be a separately scoped, contract-first
extraction. Account deletion, authentication/signup, drafts, and lifecycle
workers require dedicated parity, failure-mode, and authorization tests before
their shared helpers or routes are moved.
