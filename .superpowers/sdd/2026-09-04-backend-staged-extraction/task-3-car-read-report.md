# Task 3 car-read implementation report

## Status

Implemented the bounded public `GET /api/cars` extraction. The route now lives
in `backend/application/car_read_routes.py`, receives its runtime collaborators
from the compatibility root, and remains registered as endpoint `get_cars`.
No car detail/write, image upload, VIN, other listing type, identity, admin,
dealer, worker, migration, frontend, or route-manifest baseline code changed.

## Implementation

- Added `CarReadDependencies` and `register_car_read_route()` without importing
  `app` or `app.py`.
- Moved collection-read query construction, filter mapping, Reddit visibility,
  image normalization, seller enrichment, error handling, cache behavior, and
  pagination-response orchestration out of `app.py`.
- Kept root helpers dynamically supplied through `_car_read_dependencies()` so
  the legacy `get_cars` callable and existing patch seams remain intact.
- Added parity coverage for cache hits, default and filtered PostgREST queries,
  Reddit preview behavior, invalid numeric filters, Supabase errors, empty and
  non-list payloads, image normalization, seller enrichment, page headers, and
  unexpected exceptions.

## TDD evidence

Working directory for pytest commands:
`flask-react-supabase-app/backend` in this isolated worktree. The worktree has no
local `.venv`, so the existing backend virtualenv executable from the primary
checkout was used without modifying that checkout.

### RED

Command:

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q test_listing_read_route_parity.py
```

Result: exit 2 during collection, with
`ModuleNotFoundError: No module named 'application.car_read_routes'`. This was
the expected failure because the extracted production module did not exist.

### GREEN focused

Command:

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q test_listing_read_route_parity.py
```

Result: exit 0; `15 passed in 0.08s`.

## Required verification

### Route manifest

Command:

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q test_route_manifest.py
```

Result: exit 0; `6 passed in 1.33s`. The immutable route inventory, endpoint
name, methods, and legacy collision baseline are unchanged.

### Full backend pytest

Command:

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q
```

Result: exit 0; `831 passed, 11 skipped, 40 warnings, 10 subtests passed in
12.80s`.

### Docker API E2E

Command:

```text
./e2e/run.sh
```

Result: exit 0; production image built, container became ready, and all four
assertions passed: liveness 200, readiness 200, unknown route 404, and
auth-gated route 401. Script ended with `E2E PASSED` and cleaned up its
container.

### Diff integrity

Command from the isolated worktree root:

```text
git diff --check
```

Result: exit 0 with no output.

After staging the four owned Task 3 files, `git diff --cached --check` also
returned exit 0 with no output, so the newly added files were included in the
whitespace check.

### Static import boundary

Command from `flask-react-supabase-app/backend`:

```text
if rg -n 'from app|import app' application/car_read_routes.py; then exit 1; else print 'no forbidden app imports'; fi
```

Result: exit 0; `no forbidden app imports`.

## Concerns

- The full backend suite still reports 40 pre-existing warnings, primarily
  datetime deprecations, pytest tests returning values, and matplotlib parsing
  deprecations. This task did not add or suppress them.
- Docker API E2E intentionally verifies the credential-free production image
  boundary and health/auth behavior; it does not call external Supabase or
  Redis services.
