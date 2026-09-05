# Task 3 bike-read implementation report

## Status

Implemented the bounded public `GET /api/bikes` collection and
`GET /api/bikes/<string:bike_id>` detail extraction. Both routes now live in
`backend/application/bike_read_routes.py`, receive runtime collaborators from
the compatibility root, and remain registered as endpoints `get_bikes` and
`get_bike_by_id`. The committed car-read extraction and the immutable route
manifest baseline were preserved.

No bike write, user-listing, car, plate, part, identity, admin, dealer, worker,
migration, frontend, or route-manifest baseline code changed.

## Implementation

- Added `BikeReadDependencies` and `register_bike_read_routes()` without
  importing `app` or `app.py`.
- Moved the public bike collection query construction, direct-provider fallback,
  filters/search/cursor behavior, Reddit visibility, image normalization,
  seller enrichment, cache behavior, pagination headers, and error envelopes out
  of `app.py`.
- Moved the public bike detail orchestration, requester visibility checks,
  lifecycle synchronization, image alias normalization, seller-photo enrichment,
  private-document stripping, anonymous-public caching, not-found behavior, and
  error envelope out of `app.py`.
- Kept root helpers dynamically supplied through `_bike_read_dependencies()` so
  existing root patch seams remain live at request time.
- Added parity coverage for list/detail registration, defaults, filters, search,
  cursor, Reddit visibility, cache hits and writes, direct/fallback provider
  responses, malformed/empty responses, list and detail errors, image
  normalization, seller enrichment, detail visibility, document stripping, and
  owner-specific cache behavior.

## TDD evidence

Working directory for pytest commands:
`flask-react-supabase-app/backend` in the isolated worktree. The existing backend
virtualenv executable from the primary checkout was used because this worktree
does not carry its own `.venv`.

### RED

Command:

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q test_bike_read_route_parity.py
```

Result: exit 2 during collection with
`ModuleNotFoundError: No module named 'application.bike_read_routes'`. This was
the expected failure because the extracted production module did not exist.

### GREEN focused

Command:

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q test_bike_read_route_parity.py
```

Result: exit 0; `24 passed in 0.10s`.

## Required verification

### Route manifest

Command:

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q test_route_manifest.py
```

Result: exit 0; `6 passed in 1.32s`. The immutable route inventory, endpoint
names, methods, ordering hash, and legacy collision baseline are unchanged.

### Full backend pytest

Command:

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q
```

Result: exit 0; `855 passed, 11 skipped, 40 warnings, 10 subtests passed in
12.84s`.

### Docker API E2E

Command from `flask-react-supabase-app/backend`:

```text
./e2e/run.sh
```

Result: exit 0; the production image built, the container became ready, and all
four assertions passed: liveness 200, readiness 200, unknown route 404, and
auth-gated route 401. The script ended with `E2E PASSED` and cleaned up its
container.

A preliminary invocation from the parent `flask-react-supabase-app` directory
returned exit 127 because the script is rooted under `backend/e2e`; rerunning
from the required backend working directory produced the successful evidence
above.

### Diff integrity

Command from the isolated worktree root:

```text
git diff --check
```

Result after report creation: exit 0 with no output. After staging only the four
owned Task 3 files, `git diff --cached --check` also returned exit 0 with no
output, so the added module, tests, and report were included in the whitespace
check.

### Static import boundary

Command from the isolated worktree root:

```text
! rg -n 'from[[:space:]]+app|import[[:space:]]+app' flask-react-supabase-app/backend/application/bike_read_routes.py
```

Result: exit 0 with no matches. The extracted production module does not import
the compatibility root.

## Concerns

- The full backend suite still reports 40 pre-existing warnings, primarily
  datetime deprecations, pytest tests returning values, and matplotlib parsing
  deprecations. This bounded task did not add or suppress them.
- Docker API E2E verifies the credential-free production image boundary and
  health/auth behavior; it does not call external Supabase or Redis services.
