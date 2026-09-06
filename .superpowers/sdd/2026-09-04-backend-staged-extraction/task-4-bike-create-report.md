# Task 4 bike-create implementation report

## Status

Implemented the bounded authenticated `POST /api/bikes` extraction and the
Task 4b listing-image hardening. The route now lives in
`backend/application/bike_create_routes.py`, receives its auth, configuration,
validation, persistence, media, notification, and review collaborators from
the compatibility root, and remains registered as endpoint `create_bike`.

No car/plate/part write, bike update/delete, VIN/admin route, worker, migration,
frontend, or mobile file changed.

## Implementation

- Added `BikeCreateDependencies` and `register_bike_create_route()` without
  importing `app`/`app.py`, reading environment variables, or reading
  `app.config`.
- Preserved token handling and the verified-user, listing-limit, and dealer
  gates in their existing order.
- Preserved the JSON-only request contract. Multipart and malformed JSON still
  reach the broad handler and return the existing JSON 500 envelopes.
- Preserved lifecycle/status initialization order, VIN normalization, legacy
  aliases, WhatsApp alignment, numeric bounds, engine parsing, description and
  profanity validation, sync-gate ordering, field whitelisting, database error
  translation, and the 201 response body.
- Task 4b now requires every submitted bike image entry to pass the existing
  shared listing-image validator before listing persistence. Arbitrary hosts,
  non-string scalars, malformed objects, another user's path, the wrong bucket,
  and the wrong public-object prefix return 400 before any listing/image insert.
- Valid server-issued string and object references retain their submitted
  order and existing row mapping. Image persistence failure remains nonfatal
  with `images: []`.
- Preserved notification isolation and asynchronous review triggering. The
  legacy bike-create handler has no create-time public-cache invalidation and
  emits no PostHog event, so the extraction does neither.
- Kept root helper patch seams lazy through `_bike_create_dependencies()` and
  retained the root-visible dealer-check assignment required by the existing
  dealer coverage guard.

## TDD evidence

Pytest commands ran from `flask-react-supabase-app/backend` using the existing
backend virtualenv in the primary checkout because this isolated worktree has
no local `.venv`.

### RED

Initial focused command:

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q test_bike_create_route_parity.py
```

Result: exit 2 during collection with `ModuleNotFoundError: No module named
'application.bike_create_routes'`.

After the minimal registration boundary passed, the expanded parity suite
failed collection because `BikeCreateDependencies` did not yet exist. After
the handler implementation, the composition test failed with `AttributeError:
module 'app' has no attribute '_bike_create_dependencies'` until the root was
wired.

### GREEN focused

Command:

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q test_bike_create_route_parity.py
```

Result: exit 0; `24 passed in 0.40s`.

### Focused plus adjacent compatibility

Command:

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q test_bike_create_route_parity.py test_admin_stats_and_posts.py
```

Result: exit 0; `38 passed, 15 warnings in 0.42s`.

The full suite's first pass exposed the pre-existing source-count dealer guard
at `3` instead of `4`. A lazy root wrapper restored that compatibility seam;
the focused suite plus that exact guard then passed: `25 passed in 0.41s`.

## Required verification

### Route manifest

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q test_route_manifest.py
```

Result: exit 0; `6 passed in 1.14s`.

### Full backend pytest

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q
```

Result: exit 0; `969 passed, 11 skipped, 65 warnings, 10 subtests passed in
12.89s`.

### Docker API E2E

Command from `flask-react-supabase-app/backend`:

```text
./e2e/run.sh
```

Result: exit 0. The production image built, the container became ready, and
liveness 200, readiness 200, unknown-route 404, and auth-gated-route 401 all
passed. The script ended with `E2E PASSED` and cleaned up its container.

### Diff and import boundaries

`git diff --check` passed. The extracted module compiled with the verified
virtualenv interpreter. Static scans found no `app`/`app.py` import and no
`os.getenv`, `environ`, or `app.config` access in
`application/bike_create_routes.py`.

## Concerns

- The task brief, global plan, live legacy handler, existing tests, and
  immediately preceding car-create extraction/report were used as the
  operative contract sources.
- The full backend suite retains 65 pre-existing warnings, chiefly datetime,
  pytest-return-value, and matplotlib parsing deprecations.
- Docker API E2E verifies the credential-free production image boundary; it
  does not create a real Supabase bike listing.
- Current bike-create image persistence semantics are weaker than car-create:
  for a valid image reference, an image insert failure still returns 201, and
  no listing rollback occurs. Task 4b preserves that behavior rather than
  changing it.

## Task 4b listing-image hardening evidence

### RED

Command from `flask-react-supabase-app/backend`:

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q test_bike_create_route_parity.py
```

Result before implementation: exit 1; `7 failed, 23 passed in 0.34s`. Each
external URL, scalar, malformed-object, wrong-user, wrong-bucket, and
wrong-prefix case reached the old 201 path instead of the required 400.

### GREEN focused

Command:

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q test_bike_create_route_parity.py
```

Result: exit 0; `30 passed in 0.32s`.

Fresh focused bike/media/manifest command:

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q test_bike_create_route_parity.py test_bike_read_route_parity.py test_media_upload_security.py test_route_manifest.py
```

Result: exit 0; `91 passed in 1.17s`.

### Full backend pytest

Command:

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q
```

Result: exit 1; `1 failed, 974 passed, 11 skipped, 65 warnings, 10 subtests
passed in 12.91s`.

The sole failure is
`test_admin_stats_and_posts.py::PostListingSmokeTests::test_post_bike_payload_succeeds`.
Its fixture submits three `https://example.com/...` image URLs and expects 201;
the hardened route correctly returns 400. A fresh isolated rerun reproduced
the exact `AssertionError: 400 != 201` (`1 failed in 0.16s`). The Task 4b
ownership boundary permits only the focused bike-create test file, so this
stale shared smoke fixture was not edited and production validation was not
weakened to satisfy it.

### Docker API E2E

`./e2e/run.sh` ran from `flask-react-supabase-app/backend` and exited 0. The
production image built, the container became ready, liveness returned 200,
readiness returned 200, the unknown route returned 404, the auth-gated route
returned 401, and the script ended with `E2E PASSED`.

### Diff and import boundaries

`git diff --check` exited 0 with no output. The verified virtualenv interpreter
compiled `application/bike_create_routes.py`. Static scans exited 0 with `no
forbidden app imports` and `no direct environment or app config access`.
