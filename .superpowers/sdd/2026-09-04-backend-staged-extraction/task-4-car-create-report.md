# Task 4 car-create implementation report

## Status

Implemented the bounded authenticated `POST /api/cars` extraction. The route
now lives in `backend/application/car_create_routes.py`, receives its auth,
configuration, validation, persistence, media, notification, cache, review,
and analytics collaborators from the compatibility root, and remains
registered as endpoint `create_car`.

The existing `/api/cars` `OPTIONS` route remains in `app.py`. No car
update/delete/image route, bike/plate/part write, VIN/admin route, worker,
migration, frontend, or mobile file changed.

## Implementation

- Added `CarCreateDependencies` and `register_car_create_route()` without
  importing `app`/`app.py`, reading environment variables, or reading
  `app.config`.
- Preserved authentication and the verified-user, listing-limit, dealer, and
  sync gates in their existing order.
- Preserved JSON handling, lifecycle/VIN/alias normalization, numeric and enum
  validation, description/profanity checks, extras mapping, field whitelisting,
  initial status, image requirements, crop metadata, bulk-to-row image
  fallback, rollback, friendly database errors, notification isolation, cache
  invalidation, auto-review triggering, PostHog capture, and the 201 response.
- Kept current-year and initial-listing-status resolution lazy. The initial
  status callable is still evaluated once for persistence and again before the
  admin-notification decision, matching the prior handler.
- Kept root helper patch seams dynamic through `_car_create_dependencies()` so
  adjacent compatibility tests continue to call `create_car.__wrapped__`.

## TDD evidence

Working directory for pytest commands:
`flask-react-supabase-app/backend` in the isolated worktree. The worktree has no
local `.venv`, so the existing backend virtualenv executable from the primary
checkout was used without modifying that checkout.

### RED

Command:

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q test_car_create_route_parity.py
```

Result: exit 2 during collection with
`ModuleNotFoundError: No module named 'application.car_create_routes'`. This
was the expected failure because the extracted production module did not yet
exist.

### GREEN focused

Command:

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q test_car_create_route_parity.py
```

Result: exit 0; `22 passed in 0.08s`.

### Focused plus adjacent compatibility

Command:

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q test_car_create_route_parity.py test_user_flow_contracts.py test_seo_routes.py
```

Result: exit 0; `39 passed in 0.44s`.

## Required verification

### Route manifest

Command:

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q test_route_manifest.py
```

Result: exit 0; `6 passed in 1.00s`. The frozen route inventory, endpoint,
method set, explicit OPTIONS route, and collision baseline remain unchanged.

### Full backend pytest

Command:

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q
```

Result: exit 0; `945 passed, 11 skipped, 65 warnings, 10 subtests passed in
12.58s`.

### Docker API E2E

Command from `flask-react-supabase-app/backend`:

```text
./e2e/run.sh
```

Result: exit 0; the production image built, the container became ready, and
all four assertions passed: liveness 200, readiness 200, unknown route 404,
and auth-gated route 401. The script ended with `E2E PASSED` and cleaned up its
container.

### Diff integrity

Commands from the isolated worktree root:

```text
git diff --check
git diff --cached --check
```

Result: exit 0 with no output for both the unstaged and staged owned diff.

### Static import boundary

Commands from `flask-react-supabase-app/backend`:

```text
if rg -n '(^|[[:space:]])(from app|import app)([[:space:]]|$)' application/car_create_routes.py; then exit 1; else echo 'no forbidden app imports'; fi
if rg -n 'os\.getenv|environ|app\.config' application/car_create_routes.py; then exit 1; else echo 'no direct environment or app config access'; fi
```

Result: exit 0 with `no forbidden app imports` and
`no direct environment or app config access`.

## Concerns

- The full backend suite still reports 65 pre-existing warnings, primarily
  datetime deprecations, pytest tests returning values, and matplotlib parsing
  deprecations. This task did not add or suppress them.
- Docker API E2E verifies the credential-free production image boundary and
  health/auth behavior; it does not create a real Supabase car listing.
- The first E2E invocation was made from the outer worktree root and returned
  exit 127 because the script lives under `flask-react-supabase-app/backend`.
  The required command was rerun from that directory and passed.
