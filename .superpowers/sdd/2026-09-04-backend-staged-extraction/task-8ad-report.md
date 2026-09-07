# Task 8ad report — admin dealer information-request controls

## Scope

Extracted only the authenticated admin create/list/cancel controls into
`backend/routes/dealer_info_requests.py`:

- `POST /api/admin/dealers/<dealer_id>/info-requests`
- `GET /api/admin/dealers/<dealer_id>/info-requests`
- `POST /api/admin/info-requests/<request_id>/cancel`

Public token lookup/upload, shared document-label mapping, and provider email
helpers remain root-owned.

## Compatibility and security checks

- Preserved the shared GET/POST path collision, endpoint names, methods,
  automatic `HEAD`/`OPTIONS`, admin authorization, document de-duplication and
  limits, pending cancellation, action-required state update, email_sent and
  email_error feedback, private attachment signing, and response/error
  envelopes.
- Registration occurs after the runtime dependency table is initialized.
- The module uses `current_app` and has no static `app.py` import.
- Existing lifecycle source contracts were migrated to inspect the extracted
  admin owner while public upload privacy contracts remain root-backed.

## Verification

- Focused dealer info-request, dealer lifecycle, and route-manifest suite:
  `25 passed`.
- Backend syntax compilation and `git diff --check`: passed.
- Full backend suite: `1171 passed, 11 skipped, 54 warnings`.
- `app.py` after extraction: `17,438` lines.

The skips and warnings are existing environment-gated/deprecation and legacy
test-return cases; no new failures were introduced.
