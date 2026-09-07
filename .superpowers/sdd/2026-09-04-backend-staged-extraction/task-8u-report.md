# Task 8u report

Status: completed

Implementation commit: `5db23315` (`refactor(backend): extract moderation routes`)

Round 1 review fix commit: `1de9e7d5f4686ad8fd0c7ae5dbcf6e577da4d3b6` (`fix(backend): preserve moderation malformed JSON errors`)

Round 1 fix:

- Removed the unused `request.json` access from the root compatibility reject shim in `app.py`, keeping malformed JSON handling inside the moderation error boundary.
- Added direct-call parity coverage for both root reject compatibility shims; malformed `application/json` now returns the established JSON error response instead of raising `BadRequest`.

Files changed:

- `flask-react-supabase-app/backend/routes/moderation.py`
- `flask-react-supabase-app/backend/app.py`
- `flask-react-supabase-app/backend/test_moderation_route_parity.py`
- `flask-react-supabase-app/backend/test_route_manifest.py` (removed the approved canonical-reject collision from the immutable baseline)

Behavior preserved:

- Generic approve, reject, and pending-list API routes now use the moderation runtime boundary.
- `_perform_approval`, direct-call exports, auto-review worker access, auth/validation, envelopes, service-role calls, notifications, and cache behavior remain compatible.
- `routes/admin.py` remains the sole live owner of `/api/admin/approve/<item_type>/<item_id>/reject`.

Validation:

- `/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q test_moderation_route_parity.py test_perform_approval_helper.py test_admin_approve_routes.py test_route_manifest.py test_dealer_verification.py test_auto_review_worker.py` — 121 passed.
- `/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q test_moderation_route_parity.py test_route_manifest.py` — 19 passed.
- `/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q test_moderation_route_parity.py test_route_manifest.py` — 21 passed after the Round 1 fix.
- `/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv/bin/pytest -q` — 1096 passed, 11 skipped, 68 warnings.
- `python3 -m py_compile flask-react-supabase-app/backend/app.py flask-react-supabase-app/backend/routes/moderation.py flask-react-supabase-app/backend/test_moderation_route_parity.py` — passed.
- `python3 -m py_compile app.py routes/moderation.py test_moderation_route_parity.py` — passed after the Round 1 fix.
- `git diff --check` — passed.

The worktree-local backend virtualenv is absent, so the equivalent existing venv at `/Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/backend/.venv` was used. Docker API/worker E2E was not rerun after this bounded extraction. The pre-existing unstaged `docs/superpowers/plans/2026-09-04-backend-staged-extraction.md` edit was preserved and is not part of the implementation commit.
