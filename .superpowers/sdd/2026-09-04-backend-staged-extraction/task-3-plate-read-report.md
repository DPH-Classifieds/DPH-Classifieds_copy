# Task 3 plate-read implementation report

## Status

Implemented the bounded public `GET /api/plates` collection extraction. The
route now lives in `backend/application/plate_read_routes.py`, receives runtime
collaborators from the compatibility root, and remains registered as endpoint
`get_plates` with `GET`, `HEAD`, and automatic `OPTIONS` methods.

The existing `POST /api/plates` registration remains separate with its own
automatic `OPTIONS`, preserving the legacy duplicate-`OPTIONS` inventory. The
plate detail/write routes and the root `_fetch_plate_image_map` helper were not
moved or duplicated.

No car, bike, part, identity, admin, dealer, worker, migration, frontend,
mobile, route-manifest baseline, or deployment code changed.

## Implementation

- Added `PlateReadDependencies` and `register_plate_read_route()` without
  importing `app` or `app.py` and without direct `app.config` or `os.getenv`
  access.
- Injected lazy configuration, direct requests, cache operations, pagination,
  search/filter/cursor helpers, Reddit visibility helpers, public-record
  filtering, image-map lookup, seller enrichment, pagination headers, and the
  logger from `app.py`.
- Preserved the exact PostgREST table, default `created_at.desc` order, selected
  fields, service-role headers, timeout, filters, encoded search group, cursor,
  and Reddit visibility clauses.
- Preserved cache-hit short-circuiting, successful-result cache writes,
  provider-failure and exception empty-array caching, the public HTTP 200
  fallback, image-map enrichment, main-image fallback, seller fields, and page
  headers.
- Kept `_fetch_plate_image_map` in `app.py`; both the extracted collection
  adapter and the unchanged plate detail route resolve that root helper at
  request time.

## TDD evidence

Working directory for pytest commands:
`flask-react-supabase-app/backend` in the isolated worktree. The existing
backend virtualenv executable from the primary checkout was used; it already
included `defusedxml`, so no temporary virtualenv was needed.

### RED

Command:

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q test_plate_read_route_parity.py
```

Result before production implementation: exit 2 during collection with
`ModuleNotFoundError: No module named 'application.plate_read_routes'`. This was
the expected failure because the extracted production module did not exist.

### GREEN focused

Command:

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q test_plate_read_route_parity.py
```

Result: exit 0; `16 passed in 0.40s`.

The focused suite covers route registration, cache hits and lazy configuration,
the exact default query, filters/search/cursor, Reddit visibility, image-map and
main-image fallback, seller enrichment, response fields, malformed payloads,
provider failure and exception behavior, pagination headers, and the existing
detail route's `_fetch_plate_image_map` seam.

### Existing plate-adjacent focused checks

Command:

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q test_listing_filters_extended.py test_listing_search_and_cursor_helpers.py
```

Result: exit 0; `25 passed in 0.16s`.

## Required verification

### Route manifest

Command:

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q test_route_manifest.py
```

Result: exit 0; `6 passed in 1.04s`. The immutable route count, hash, endpoint
names, methods, and collision baseline are unchanged.

An additional runtime inventory inspection showed:

```text
RouteContract(rule='/api/plates', methods=('GET', 'HEAD', 'OPTIONS'), endpoint='get_plates', classification='api')
RouteContract(rule='/api/plates', methods=('OPTIONS', 'POST'), endpoint='create_plate', classification='api')
plate OPTIONS registrations: 2
```

### Full backend pytest

Command:

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q
```

Result from the final staged-tree run: exit 0; `904 passed, 11 skipped, 65
warnings, 10 subtests passed in 12.70s`.

### Docker API E2E

Command from `flask-react-supabase-app/backend`:

```text
./e2e/run.sh
```

Result: exit 0; the production image built, the container became ready, and all
four assertions passed: liveness 200, readiness 200, unknown route 404, and
auth-gated route 401. The script ended with `E2E PASSED` and cleaned up its
container.

### Diff integrity and ownership

Command from the isolated worktree root:

```text
git diff --check
```

Result before report creation: exit 0 with no output. After staging exactly the
four owned files, `git diff --cached --check` also returned exit 0 with no
output.

The pre-report scope inspection showed only:

```text
flask-react-supabase-app/backend/app.py
flask-react-supabase-app/backend/application/plate_read_routes.py
flask-react-supabase-app/backend/test_plate_read_route_parity.py
```

This report is the fourth and final owned file.

### Static import boundary

Command from the isolated worktree root:

```text
if rg -n '(^|[[:space:]])(from[[:space:]]+app|import[[:space:]]+app)|app\.config|os\.getenv' flask-react-supabase-app/backend/application/plate_read_routes.py; then exit 1; else echo 'plate read import boundary clean'; fi
```

Result: exit 0; `plate read import boundary clean`.

## Concerns

- The full backend suite reports 65 existing warnings, primarily datetime
  deprecations, pytest tests returning values, and matplotlib parsing
  deprecations. This bounded task did not add or suppress them.
- Docker API E2E verifies the credential-free production image boundary and
  health/auth behavior; it does not call external Supabase or Redis services.
