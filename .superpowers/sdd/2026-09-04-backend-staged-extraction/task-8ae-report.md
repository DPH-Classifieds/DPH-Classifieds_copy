# Task 8ae report — public dealer information-request lookup

## Scope

Extracted the unauthenticated token lookup route into
`backend/routes/public_info_request.py`:

- `GET /api/info-requests/<token>`

The token remains the authorization credential. Multipart upload, storage
writes, document validation, and lifecycle transitions remain root-owned.

## Compatibility and security checks

- Preserved token-length validation, service-role lookup, automatic expiry of
  pending requests, dealer company/first-name display only, upload metadata
  redaction, status/error envelopes, endpoint name, and automatic
  `GET`/`HEAD`/`OPTIONS` behavior.
- Registration occurs after the runtime dependency table is initialized.
- The module uses `current_app` and has no static `app.py` import.
- Existing lifecycle source contracts now inspect the extracted public owner.

## Verification

- Focused public lookup, dealer lifecycle, and route-manifest suite:
  `24 passed`.
- Backend syntax compilation and `git diff --check`: passed.
- Full backend suite: `1176 passed, 11 skipped, 54 warnings`.
- `app.py` after extraction: `17,380` lines.

The skips and warnings are existing environment-gated/deprecation and legacy
test-return cases; no new failures were introduced.
