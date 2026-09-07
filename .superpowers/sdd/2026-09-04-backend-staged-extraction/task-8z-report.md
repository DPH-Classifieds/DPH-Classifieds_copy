# Task 8z report

## Status

Implementation complete in the scoped worktree. Admin user profile PATCH and
unverified-account cleanup POST are now owned by `routes/admin_users.py`, with
runtime dependency resolution through
`current_app.extensions["dph_user_backend"]` and no `app.py` import.

## Implementation

- Added `flask-react-supabase-app/backend/routes/admin_users.py` with
  `register_admin_user_routes`, `update_admin_user_profile`, and
  `admin_cleanup_unverified_accounts`.
- Removed the two legacy `@app.route` owners from `app.py` and registered the
  extracted handlers after the runtime registry is initialized.
- Preserved root compatibility exports, `__wrapped__` direct-call behavior,
  token/admin/super-admin gates, supported/protected field filtering, account
  status validation, phone normalization and verification timestamps, dealer
  and DPH notifications, cleanup option forwarding, status codes, envelopes,
  and failure handling.
- Added focused contract coverage in
  `test_admin_user_routes_extraction.py`.
- Updated only source-coupled admin-owner checks in
  `test_dealer_verification.py` and `test_feature_independence.py` to inspect
  the extracted module.

## Validation

The worktree-local backend `.venv` is absent. Commands below used the existing
equivalent environment at
`/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv`.

### RED

```text
pytest -q test_admin_user_routes_extraction.py
7 passed, 3 failed in 0.32s
```

The expected pre-extraction owner/module assertions failed; one protected
response fixture was also corrected before implementation proceeded.

### GREEN and regression checks

```text
pytest -q test_admin_user_routes_extraction.py
12 passed, 1 warning in 0.22s

pytest -q test_feature_independence.py test_admin_user_routes_extraction.py test_dealer_verification.py
92 passed, 1 warning, 2 subtests passed in 0.35s

pytest -q test_admin_user_routes_extraction.py test_route_manifest.py
22 passed, 1 warning in 1.88s

pytest -q
1144 passed, 11 skipped, 69 warnings, 12 subtests passed in 13.67s
```

```text
python3 -m py_compile app.py routes/admin_users.py test_admin_user_routes_extraction.py test_dealer_verification.py test_feature_independence.py
passed

git diff --check
passed
```

Route-manifest inspection found exactly one registration for each target path,
including automatic OPTIONS:

```text
('/api/admin/users/<user_id>/profile', 'PATCH'): 1
('/api/admin/users/<user_id>/profile', 'OPTIONS'): 1
('/api/admin/cleanup-unverified-accounts', 'POST'): 1
('/api/admin/cleanup-unverified-accounts', 'OPTIONS'): 1
```

Static boundary inspection found no `from app` or `import app` in
`routes/admin_users.py`.

## Risks and handoff

- Existing deprecation and unrelated warning output remains in the full suite;
  no new functional failure remains.
- Docker, frontend/mobile, browser, and live-provider lanes were not run for
  this backend-only extraction.
- The parent coordinator owns Git state, so no commit was created by this
  executor. The parent should commit the scoped files and this report as
  `refactor(backend): extract admin user routes`, while leaving the existing
  plan edit untouched.
