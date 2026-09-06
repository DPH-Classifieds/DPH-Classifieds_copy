# Task 3 part-read implementation report

## Status

Implemented the bounded public `GET /api/parts` collection extraction. The
route now lives in `backend/application/part_read_routes.py`, receives runtime
collaborators from the compatibility root, and remains registered as endpoint
`get_parts` with `GET`, `HEAD`, and automatic `OPTIONS` methods.

The existing `POST /api/parts` registration remains separate with its own
automatic `OPTIONS`, preserving the legacy duplicate-`OPTIONS` inventory. Part
detail and mutation routes were not moved.

No car, bike, plate, identity, admin, dealer, worker, migration, frontend,
mobile, route-manifest baseline, push, merge, or deployment code changed.

## Implementation

- Added `PartReadDependencies` and `register_part_read_route()` without
  importing `app` or `app.py` and without direct `app.config` or `os.getenv`
  access.
- Injected lazy Supabase configuration, direct requests, cache operations,
  pagination, search/filter/cursor helpers, Reddit visibility helpers,
  Supabase fallback, public-record filtering, seller enrichment, pagination
  headers, and the logger from `app.py`.
- Preserved the exact `car_parts` query, default `created_at` order, selected
  fields, service-role headers, filters, cursor, and separately encoded direct
  and fallback search groups.
- Preserved cache-hit short-circuiting, direct success, fallback success and
  empty/error behavior, joined-image aliases, main-image fallback, primary
  image selection, seller fields, error envelopes, and page headers.
- Preserved existing quirks rather than correcting them: fallback range pairs
  are collapsed through `dict(filter_pairs)` so the last price bound wins; the
  fallback select omits `source_platform` and `source_url`; a null direct image
  join enters fallback while fallback null joins coerce to an empty list; a
  malformed fallback image mapping still returns the existing 500 envelope.

## TDD evidence

Working directory for pytest commands:
`flask-react-supabase-app/backend` in the isolated worktree. The existing
backend virtualenv executable from the primary checkout was used because this
worktree does not carry its own `.venv`.

### Baseline

The worktree-local `./.venv/bin/pytest -q` command first returned exit 127
because this linked worktree has no `.venv`. The host `python3 -m pytest -q`
then stopped during collection because `defusedxml` was absent. Running through
the existing backend dependency venv established a clean pre-change baseline:
exit 0; `904 passed, 11 skipped, 65 warnings, 10 subtests passed in 13.02s`.

### RED

Command:

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q test_part_read_route_parity.py
```

Result before production implementation: exit 2 during collection with
`ModuleNotFoundError: No module named 'application.part_read_routes'`. This was
the expected failure because the extracted production module did not exist.

### GREEN focused

Command:

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q test_part_read_route_parity.py
```

Result: exit 0; `19 passed in 0.39s`.

The suite covers route registration and duplicate collection `OPTIONS`, cache
hits and lazy configuration, exact default and filtered direct queries,
separate direct/fallback search encoding, the existing fallback price-range
collapse, cursor and Reddit visibility, direct and fallback success/error
behavior, null and malformed image joins, image and seller normalization,
pagination headers, and the public 500 envelope.

### Focused, adjacent, and route-manifest checks

Command:

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q test_part_read_route_parity.py test_listing_filters_extended.py test_listing_search_and_cursor_helpers.py test_route_manifest.py
```

Result: exit 0; `50 passed in 1.04s`. This includes all six immutable route
manifest tests. The route count, hash, endpoint names, methods, ordering, and
legacy collision baseline remain unchanged, including two automatic `OPTIONS`
registrations on `/api/parts`.

## Required verification

### Full backend pytest

Command:

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q
```

Final pre-commit result: exit 0; `923 passed, 11 skipped, 65 warnings, 10
subtests passed in 12.64s`. Immediately before it, the part parity and route
manifest files passed together: `25 passed in 1.31s`.

### Docker API E2E

Command from `flask-react-supabase-app/backend`:

```text
./e2e/run.sh
```

Result: exit 0; the production image built, the container became ready, and all
four assertions passed: liveness 200, readiness 200, unknown route 404, and
auth-gated route 401. The script ended with `E2E PASSED`.

### Diff integrity and ownership

Command from the isolated worktree root:

```text
git diff --check
```

Result before report creation: exit 0 with no output. The pre-report status
contained only the three owned production/test files; this report is the fourth
owned file. A final unstaged and staged whitespace check is recorded before the
commit.

### Static import boundary

Command from the isolated worktree root:

```text
rg -n '(^|[[:space:]])(from app|import app)|app\.config|os\.getenv' flask-react-supabase-app/backend/application/part_read_routes.py
```

Result: no matches. The extracted module has no compatibility-root import and
does not read root configuration or environment variables directly.

## Concerns

- The deliberately preserved fallback range collapse means `price_from` and
  `price_to` do not both survive when the direct request falls back; the final
  pair wins. This should be corrected only in a separately approved behavior
  change with updated contract tests.
- The deliberately preserved fallback select omits Reddit source fields, and
  malformed fallback `part_images` mappings still produce a 500 response.
- The full backend suite retains 65 existing warnings, primarily datetime
  deprecations, pytest tests returning values, and matplotlib parsing
  deprecations. This bounded task did not add or suppress them.
- Docker API E2E verifies the credential-free production image boundary and
  health/auth behavior; it does not call external Supabase or Redis services.
