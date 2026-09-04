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
- Full backend: from `flask-react-supabase-app/backend`, run
  `./.venv/bin/pytest -q`.
- Docker API E2E: from `flask-react-supabase-app/backend`, run `./e2e/run.sh`.
- Worker Docker smoke: from `flask-react-supabase-app/backend`, run
  `docker build -t dph-backend-worker-smoke .` followed by
  `docker run --rm -e SERVICE_ROLE=worker -e FLASK_SECRET_KEY=worker-smoke-secret dph-backend-worker-smoke` only in a controlled local environment; capture startup and heartbeat evidence without real provider credentials.

## Frontend and mobile gates

- Frontend: from `flask-react-supabase-app/frontend`, run
  `CI=true npm test -- --watchAll=false`, `npm run build`,
  `npm run check:bundle`, and `npm run audit:media`.
- Mobile: from `flask-react-supabase-app/mobile`, run
  `npx tsc --noEmit` and `npm test -- --runInBand`.

## Browser and role gates

- Public Playwright: from `flask-react-supabase-app/frontend`, run the public,
  credential-free Playwright project with `npm run e2e` across all required responsive viewports.
  The public lane includes the React SPA route `/dealer/dashboard` and must keep
  all 48 public checks executable without credentials.
- Dealer-panel feature modes: run route checks with the dealer panel explicitly
  enabled and explicitly disabled. Verify the documented route availability,
  status, and authorization contract in both modes.
- Worker role: start the worker composition independently of the web role,
  smoke its health surface, and require evidence that its heartbeat was written.
- Authenticated release lane: run protected user, dealer, admin, posting, and VIN
  browser checks with disposable credentials supplied only through the
  environment: `E2E_USER_EMAIL=... E2E_USER_PASSWORD=... E2E_DEALER_EMAIL=... E2E_DEALER_PASSWORD=... E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... E2E_CAR_ID=... E2E_ALLOW_MUTATIONS=true E2E_MUTATION_FIXTURE=/absolute/path/fixture.json PLAYWRIGHT_BASE_URL=https://target PLAYWRIGHT_API_URL=https://api.target npm run e2e`. Missing required credentials is a release-blocking failure, not a skip or a successful public-lane result.
- Live E2E: after deployment approval, run the public and authenticated smoke
  suites against the exact live release with the preceding command and record the deployed revision. Local,
  CI, health-only, or provider-pending results do not count as live proof.
