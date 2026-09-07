# Task 8af report — report create/list routes

## Scope

Extracted authenticated report creation and user/admin-scoped report listing
into `backend/routes/reports.py`:

- `POST /api/reports`
- `GET /api/reports`

Admin report status patching and report/contact analytics remain root-owned.

## Compatibility and security checks

- Preserved the intentional GET/POST path collision, endpoint names, automatic
  `HEAD`/`OPTIONS`, token authentication, input validation, reporter payload,
  admin-versus-user query scoping, best-effort admin notification, response
  envelopes, and upstream error statuses.
- Registration occurs after the runtime dependency table is initialized.
- The module uses `current_app` and has no static `app.py` import.
- Shared notification and identity helpers remain root-owned and patchable.

## Verification

- Focused reports and route-manifest suite: `16 passed`.
- Backend syntax compilation and `git diff --check`: passed.
- Full backend suite: `1182 passed, 11 skipped, 54 warnings`.
- `app.py` after extraction: `17,270` lines.

The skips and warnings are existing environment-gated/deprecation and legacy
test-return cases; no new failures were introduced.
