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
- Validate supplied focal coordinates as finite numbers in the supported
  `0..100` crop range. Validate non-null `crop_meta` as a bounded JSON object;
  omitted and explicit-null optional metadata remain valid.
- Preserve valid server-issued listing uploads, image ordering, response shape,
  and rollback behavior.
- Add focused red/green tests for safe/unsafe paths and ensure no listing or
  image insert happens on rejection.
- Run focused, full backend, Docker API E2E, diff/import checks and document
  exact results. Commit with `fix(listings): harden bike image references`.

## Completion ledger

- The initial hardening RED exited 1 with `7 failed, 23 passed`; every unsafe
  reference fixture incorrectly reached 201 before the fix.
- Commit `578cb707` later corrected the stale shared bike smoke fixture to use
  authenticated-user Supabase listing-image URLs. The full suite then passed
  `975 passed`; this supersedes the initial `1 failed, 974 passed` checkpoint.
- Fix rounds two and three closed falsey-reference, malformed-URL, and public
  PDF gaps. At committed `d90edb6e`, the then-current final backend verification
  was `993 passed, 11 skipped, 65 warnings, 10 subtests passed`.
- Round-four metadata RED initially produced `22 failed, 11 passed`; review then
  corrected three invalid explicit-null expectations. The explicit-null
  compatibility tests failed `2 failed` against the interim strict validator,
  then the final metadata regression slice passed `31 passed`.
- The final round-four bike-read/create, media-security, and route-manifest run
  passed `129 passed`. Full backend passed `1013 passed, 11 skipped, 65 warnings,
  10 subtests passed`.
- Unsafe requests now return 400 before listing or image persistence. Valid
  server-issued string/object references, boundary focal values, realistic
  nested crop metadata, explicit-null optional metadata, ordering, response
  shape, and existing valid-reference image-failure behavior are preserved.
- Docker API E2E passed all liveness/readiness/404/auth assertions and ended
  with `E2E PASSED`.
- `git diff --check`, module compilation, and the forbidden-import/direct-config
  static boundary checks all passed.
- Round-five canonical-URL RED exited 1 with `4 failed, 19 passed`: absolute
  same-origin public object URLs containing a query or fragment were accepted
  by the helper and reached the bike route's 201 persistence path. The Unicode
  surrogate helper and route regressions already passed because
  `UnicodeEncodeError` is a `ValueError`; the handler now catches it explicitly.
- The round-five regression slice passed `23 passed`; focused bike-read/create,
  media-security, and route-manifest verification passed `135 passed`. Full
  backend verification passed `1019 passed, 11 skipped, 65 warnings, 10
  subtests passed`.
- Round-five Docker API E2E ended with `E2E PASSED`. Diff integrity, root and
  extracted-module compilation, the unchanged extracted-route check, and both
  static dependency-boundary scans passed.
