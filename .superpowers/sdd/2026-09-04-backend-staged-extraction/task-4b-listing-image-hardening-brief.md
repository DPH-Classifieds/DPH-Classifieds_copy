# Task 4b listing-image hardening brief

## Goal

Close the source-confirmed bike-create JSON image validation gap without
breaking legitimate listing-image posting. Client-supplied image entries must
be server-issued public listing uploads scoped to the authenticated user, or
the request must be rejected before listing/image persistence.

## Own only

- `flask-react-supabase-app/backend/application/bike_create_routes.py`
- `flask-react-supabase-app/backend/test_bike_create_route_parity.py`
- existing shared image-validation helper only if a minimal compatible fix is
  required
- the Task 4 bike-create report and this SDD ledger

Do not alter unrelated routes, frontend/mobile files, migrations, workers,
deployment, or the legacy contract beyond rejecting unsafe image references.

## Requirements

- Reject arbitrary external URLs, non-string/scalar entries, malformed image
  objects, paths owned by another user, and untrusted buckets/prefixes.
- Preserve valid server-issued listing uploads, image ordering, response shape,
  and rollback behavior.
- Add focused red/green tests for safe/unsafe paths and ensure no listing or
  image insert happens on rejection.
- Run focused, full backend, Docker API E2E, diff/import checks and document
  exact results. Commit with `fix(listings): harden bike image references`.

## Completion ledger

- RED: focused parity test run exited 1 with `7 failed, 23 passed`; every unsafe
  fixture incorrectly reached 201 before the fix.
- GREEN: focused bike-create parity passed `30 passed`; the combined bike-read,
  bike-create, media-security, and route-manifest run passed `91 passed`.
- Unsafe requests now return 400 before listing or image persistence. Valid
  server-issued string/object references preserve ordering, response shape,
  and existing valid-reference image-failure behavior.
- Full backend pytest: `1 failed, 974 passed, 11 skipped, 65 warnings, 10
  subtests passed`. The sole failure is the out-of-scope shared smoke fixture
  `test_admin_stats_and_posts.py::PostListingSmokeTests::test_post_bike_payload_succeeds`,
  which still expects arbitrary `example.com` image URLs to return 201; the
  hardened route returns 400.
- Docker API E2E passed all liveness/readiness/404/auth assertions and ended
  with `E2E PASSED`.
- `git diff --check`, module compilation, and the forbidden-import/direct-config
  static boundary checks all passed.
