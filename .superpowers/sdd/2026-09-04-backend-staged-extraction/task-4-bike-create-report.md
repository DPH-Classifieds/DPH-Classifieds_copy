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
- Supplied focal coordinates must be finite JSON numbers in the `0..100` crop
  range. Non-null crop metadata must be a JSON object bounded to 8 KiB, five
  nesting levels, and 64 aggregate members. Omitted and explicit-null optional
  metadata remain valid.
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

At this initial Task 4b checkpoint, the result was exit 1; `1 failed, 974
passed, 11 skipped, 65 warnings, 10 subtests passed in 12.91s`.

The sole failure is
`test_admin_stats_and_posts.py::PostListingSmokeTests::test_post_bike_payload_succeeds`.
Its fixture submitted three `https://example.com/...` image URLs and expected
201; the hardened route correctly returned 400. A fresh isolated rerun
reproduced `AssertionError: 400 != 201` (`1 failed in 0.16s`). Commit `578cb707`
subsequently corrected that stale fixture to use authenticated-user Supabase
listing-image URLs; the full suite then passed `975 passed`. Later fix rounds
raised the then-current committed `d90edb6e` verification to `993 passed, 11
skipped, 65 warnings, 10 subtests passed`, as recorded below.

### Docker API E2E

`./e2e/run.sh` ran from `flask-react-supabase-app/backend` and exited 0. The
production image built, the container became ready, liveness returned 200,
readiness returned 200, the unknown route returned 404, the auth-gated route
returned 401, and the script ended with `E2E PASSED`.

### Diff and import boundaries

`git diff --check` exited 0 with no output. The verified virtualenv interpreter
compiled `application/bike_create_routes.py`. Static scans exited 0 with `no
forbidden app imports` and `no direct environment or app config access`.

## Task 4b fix round 1 evidence

The only code change in this round is the stale compatibility fixture in
`backend/test_admin_stats_and_posts.py`. Its three external `example.com` URLs
were replaced with public `listing-images/user-123/...` references from the
configured Supabase origin, and that origin is patched only within the test.
Production validation was not changed.

### Previously failing compatibility test

Command:

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q test_admin_stats_and_posts.py::PostListingSmokeTests::test_post_bike_payload_succeeds
```

Result: exit 0; `1 passed in 0.21s`. Before this fixture correction, the same
test was the sole full-suite failure with `AssertionError: 400 != 201` because
it submitted arbitrary external image URLs.

### Focused bike, media, and manifest tests

Command:

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q test_bike_create_route_parity.py test_bike_read_route_parity.py test_media_upload_security.py test_route_manifest.py
```

Result: exit 0; `91 passed in 1.10s`.

### Full backend pytest

Command:

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q
```

Result: exit 0; `975 passed, 11 skipped, 65 warnings, 10 subtests passed in
12.59s`.

### Docker API E2E

`./e2e/run.sh` ran from `flask-react-supabase-app/backend` and exited 0. The
production image built, the container became ready, liveness returned 200,
readiness returned 200, the unknown route returned 404, the auth-gated route
returned 401, and the script ended with `E2E PASSED`.

### Diff integrity

`git diff --check` exited 0 with no output after the fixture and report edits.

## Task 4b fix round 2 evidence

The round-two review found one remaining validator gap in
`_validate_listing_image_entry`: dictionary references were selected with a
truthiness filter, so a valid `image_url` combined with supplied malformed
metadata such as `display_url: 0` silently discarded the malformed field and
reached persistence.

The shared helper now selects every supplied `url`, `image_url`, and
`display_url` value except explicit `None`, then applies the existing strict
string, origin, public-bucket, user-scope, and object-path validation to every
selected reference. Omitted and explicit-`None` optional fields remain valid
when another valid image reference is present. Existing valid string/object
entries and ordering are unchanged.

### RED

Command from `flask-react-supabase-app/backend`:

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q test_bike_create_route_parity.py::test_unsafe_image_reference_is_rejected_before_listing_or_image_insert test_media_upload_security.py::test_listing_image_entry_rejects_supplied_falsey_non_string_reference
```

Result before the helper fix: exit 1; `4 failed, 7 passed in 0.33s`. The bike
route returned 201 for a valid `image_url` plus `display_url: 0`, and the shared
validator accepted `0` in each of `url`, `image_url`, and `display_url` when a
second valid reference was present.

### GREEN regression slice

The same command after the helper fix exited 0 with `11 passed in 0.39s`.

### Focused bike, media, and manifest tests

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q test_bike_create_route_parity.py test_bike_read_route_parity.py test_media_upload_security.py test_route_manifest.py
```

Result: exit 0; `96 passed in 1.23s`.

### Full backend pytest

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q
```

Result: exit 0; `980 passed, 11 skipped, 65 warnings, 10 subtests passed in
12.87s`.

### Docker API E2E

`./e2e/run.sh` ran from `flask-react-supabase-app/backend` and exited 0. The
production image built, the container became ready, liveness returned 200,
readiness returned 200, the unknown route returned 404, the auth-gated route
returned 401, and the script ended with `E2E PASSED`.

### Diff integrity

The pre-report code/test diff passed `git diff --check` with no output. The
final diff check after this evidence update also exited 0 with no output.

## Task 4b fix round 3 evidence

The round-three review found that `_validate_listing_image_reference` treated
URL-like values with a scheme but no host, such as one-slash `https:/...`, as
valid object paths. It also inherited PDF support from the shared generated
object-path helper even though public listing images must be image formats.

Only `_validate_listing_image_reference` changed in production code. Any value
parsed with a scheme or host now requires the `https` scheme, a present host, a
non-empty configured Supabase host, and an exact host match. Relative
server-issued public object paths remain valid. After the shared safe-path
check, listing references are limited to `jpg`, `jpeg`, `png`, `gif`, and
`webp`; the shared generated-path and private-document validators retain PDF
support.

### RED

Command from `flask-react-supabase-app/backend`:

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q test_bike_create_route_parity.py::test_unsafe_image_reference_is_rejected_before_listing_or_image_insert test_media_upload_security.py::test_listing_image_reference_rejects_malformed_urls_and_documents test_media_upload_security.py::test_listing_image_reference_preserves_supported_public_urls_and_paths test_media_upload_security.py::test_listing_image_url_requires_configured_supabase_host test_media_upload_security.py::test_private_document_path_retains_pdf_support
```

Result before the helper fix: exit 1; `6 failed, 15 passed in 0.29s`. The bike
route returned 201 for both a one-slash HTTPS listing path and a public
listing-images PDF. The media validator also accepted those references, a
scheme-relative host reference, and a relative public PDF path. The supported
image URL/path matrix, missing-host configuration check, and private PDF
document check passed before the implementation change.

The bike rejection test asserts a 400 response and verifies there are no
listing creates, image inserts, notifications, or review triggers.

### GREEN regression slice

The same command after the helper fix exited 0 with `21 passed in 0.39s`.

### Focused bike, media, and manifest tests

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q test_bike_create_route_parity.py test_bike_read_route_parity.py test_media_upload_security.py test_route_manifest.py
```

Result: exit 0; `109 passed in 1.14s`.

### Full backend pytest

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q
```

Result: exit 0; `993 passed, 11 skipped, 65 warnings, 10 subtests passed in
12.80s`.

### Docker API E2E

`./e2e/run.sh` ran from `flask-react-supabase-app/backend` and exited 0. The
production image built, the container became ready, liveness returned 200,
readiness returned 200, the unknown route returned 404, the auth-gated route
returned 401, and the script ended with `E2E PASSED`.

### Diff integrity

The pre-report and post-evidence `git diff --check` runs both exited 0 with no
output.

## Task 4b fix round 4 evidence

The round-four review found that valid public image objects could still attach
unchecked persistence metadata. `_validate_listing_image_entry` now validates
non-null `focal_x` and `focal_y` as non-boolean finite `int`/`float` values in
the inclusive `0..100` crop range. Non-null `crop_meta` must be a JSON object
with JSON-safe finite values, no more than five nesting levels, 64 aggregate
members, and an 8 KiB compact UTF-8 encoding. Omitted and explicit `None`
metadata retain the prior optional-field behavior.

The bike route still returns the existing 400 image-validation envelope before
listing/image persistence. Valid boundary focal coordinates, realistic nested
crop metadata, submitted image order, row mapping, and the 201 response path
remain unchanged.

### RED and compatibility correction

The initial round-four metadata regression command exited 1 with `22 failed,
11 passed in 0.38s`; the new malformed metadata cases reached the old 201 path
or were accepted directly by the shared validator. That first matrix also
treated three explicit-null optional metadata cases as invalid. After review
corrected that expectation and added positive route/helper coverage, those two
compatibility tests failed against the interim strict validator with `2 failed
in 0.27s`.

### GREEN metadata regression slice

Command from `flask-react-supabase-app/backend`:

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q test_bike_create_route_parity.py::test_server_issued_image_rows_preserve_string_dict_order_and_metadata test_bike_create_route_parity.py::test_unsafe_image_reference_is_rejected_before_listing_or_image_insert test_media_upload_security.py::test_listing_image_entry_rejects_invalid_supplied_focal_metadata test_media_upload_security.py::test_listing_image_entry_rejects_malformed_or_unbounded_crop_metadata test_media_upload_security.py::test_listing_image_entry_allows_explicit_none_optional_metadata
```

Result: exit 0; `31 passed in 0.41s`.

### Focused bike, media, and manifest tests

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q test_bike_create_route_parity.py test_bike_read_route_parity.py test_media_upload_security.py test_route_manifest.py
```

Result: exit 0; `129 passed in 1.11s`.

### Full backend pytest

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q
```

Result: exit 0; `1013 passed, 11 skipped, 65 warnings, 10 subtests passed in
12.55s`.

### Docker API E2E

`./e2e/run.sh` ran from `flask-react-supabase-app/backend` after the explicit
`None` compatibility correction and exited 0. The production image built, the
container became ready, liveness returned 200, readiness returned 200, the
unknown route returned 404, the auth-gated route returned 401, and the script
ended with `E2E PASSED`.

### Diff and import boundaries

The pre-report and final post-evidence `git diff --check` runs exited 0. Module
compilation and the unchanged extracted-route diff check both exited 0. Static
boundary scanning found no forbidden `app` import and no direct environment or
`app.config` access in `application/bike_create_routes.py`.

## Task 4b fix round 5 evidence

The round-five review found that `_validate_listing_image_reference` validated
the path from an otherwise trusted absolute URL but did not reject query or
fragment components. Absolute public listing-image URLs must now be the exact
canonical server-issued object URL; a literal query or fragment delimiter is
rejected. Relative paths continue through the existing path validation without
any contract change.

`_is_valid_listing_crop_meta` now catches `UnicodeEncodeError` explicitly and
returns false. This keeps Unicode surrogate encoding failures on the existing
400 image-validation path rather than allowing a 500. The exception was already
behaviorally covered by the broader `ValueError` catch because
`UnicodeEncodeError` subclasses `ValueError`; the explicit branch documents and
locks the intended boundary without changing valid metadata or explicit-`None`
compatibility.

### RED

Command from `flask-react-supabase-app/backend`:

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q test_media_upload_security.py::test_listing_image_reference_rejects_noncanonical_absolute_url_components test_media_upload_security.py::test_listing_crop_meta_rejects_unicode_surrogate_encoding_failure test_bike_create_route_parity.py::test_unsafe_image_reference_is_rejected_before_listing_or_image_insert
```

Result before implementation: exit 1; `4 failed, 19 passed in 0.34s`. The two
direct helper cases accepted absolute image URLs containing a query or fragment,
and the two matching bike-route cases returned 201 instead of 400. The surrogate
helper and route cases passed before implementation due to the existing
`ValueError` catch described above.

### GREEN regression slice

The same command after the minimal helper changes exited 0 with `23 passed in
0.39s`.

### Focused bike, media, and manifest tests

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q test_bike_create_route_parity.py test_bike_read_route_parity.py test_media_upload_security.py test_route_manifest.py
```

Result: exit 0; `135 passed in 1.20s`. This includes the preserved valid metadata,
explicit-`None`, private PDF document, image ordering, and response-shape
coverage.

### Full backend pytest

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q
```

Result: exit 0; `1019 passed, 11 skipped, 65 warnings, 10 subtests passed in
12.87s`.

### Docker API E2E

`./e2e/run.sh` ran from `flask-react-supabase-app/backend` and exited 0. The
production image built, the container became ready, liveness returned 200,
readiness returned 200, the unknown route returned 404, the auth-gated route
returned 401, and the script ended with `E2E PASSED`.

### Diff and import boundaries

The pre-report `git diff --check` exited 0. Both `app.py` and
`application/bike_create_routes.py` compiled with the verified virtualenv
interpreter. The extracted-route diff against `a12aece2` was empty, and static
scans exited 0 with `no forbidden app imports` and `no direct environment or app
config access`. The final post-evidence `git diff --check` also exited 0 with no
output.

## Task 4b final advisory evidence

The final review found that Python's `urlparse(value)` raises `ValueError` for
malformed bracketed URL authorities. `_validate_listing_image_reference` now
catches that parser exception and returns `False`, keeping the input on the
existing image-validation rejection path. No valid URL/path branch, metadata
validation, image mapping, persistence, or response behavior changed.

### RED

Command from `flask-react-supabase-app/backend`:

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q 'test_media_upload_security.py::test_listing_image_reference_rejects_malformed_urls_and_documents[malformed-bracketed-url]' 'test_bike_create_route_parity.py::test_unsafe_image_reference_is_rejected_before_listing_or_image_insert[malformed-bracketed-url]'
```

Result before implementation: exit 1; `2 failed in 0.58s`. The helper case
raised `ValueError: Invalid IPv6 URL`, and the bike route returned 500 instead
of the required 400. The route regression also asserts that rejection performs
no listing create, image insert, notification, or review trigger.

### GREEN regression slice

The same command after the minimal parser guard exited 0 with `2 passed in
0.38s`.

### Focused bike, media, and manifest tests

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q test_bike_create_route_parity.py test_bike_read_route_parity.py test_media_upload_security.py test_route_manifest.py
```

Result: exit 0; `137 passed in 1.14s`. This includes the existing valid public
image URL/path, metadata, explicit-null, ordering, response-shape, bike-read,
and immutable route-manifest coverage.

### Full backend pytest

```text
/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q
```

Result: exit 0; `1021 passed, 11 skipped, 65 warnings, 10 subtests passed in
12.83s`.

### Docker API E2E

`./e2e/run.sh` ran from `flask-react-supabase-app/backend` and exited 0. The
production image built, the container became ready, liveness returned 200,
readiness returned 200, the unknown route returned 404, the auth-gated route
returned 401, and the script ended with `E2E PASSED`.

### Diff and import boundaries

The pre-report `git diff --check` exited 0. Both `app.py` and
`application/bike_create_routes.py` compiled with the verified virtualenv
interpreter. The extracted bike-create module is unchanged from `b8e914b2`;
its static scans found no forbidden `app` import and no direct environment or
`app.config` access. The final post-evidence `git diff --check` also exited 0
with no output.

## Evidence provenance correction

The commands in the preceding advisory section were copied from the original
Downloads checkout and are historical evidence only. They are not acceptance
proof for this staged worktree. A fresh run from
`/Users/suhayl/.config/superpowers/worktrees/Flask-React-superbase-classified/backend-staged-extraction`
was completed after the final `f013992c` URL guard and the plate compatibility
fixes:

- `python3 -m pytest -q test_bike_create_route_parity.py test_media_upload_security.py test_route_manifest.py --disable-warnings`: **105 passed**.
- `/private/tmp/dph-classified-backend-venv.C3P5gN/bin/python -m pytest -q --disable-warnings` with the declared `defusedxml==0.7.1` dependency available: **1035 passed, 11 skipped, 50 warnings**.

This correction supersedes the stale `1021 passed` total above for current
branch-wide acceptance. The Docker evidence above remains historical until
rerun against the current staged commit.
