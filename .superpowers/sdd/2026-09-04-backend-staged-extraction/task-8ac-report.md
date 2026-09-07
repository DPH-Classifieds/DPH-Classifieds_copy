# Task 8ac report — live-user metrics routes

## Scope

Extracted the two live-user admin handlers into `backend/routes/live_users.py`:

- `GET /api/admin/live-users`
- `GET /api/admin/live-users/history`

Cloudflare, overview/stats aggregation, dealer flows, and workers remain
root-owned.

## Compatibility and security checks

- Preserved endpoint names, automatic `GET`/`HEAD`/`OPTIONS`, admin guard,
  service-role platform-events reads, window/bucket clamps, cache keys/TTLs,
  timestamp formatting, distinct visitor counts, empty buckets, and errors.
- Registration occurs after the runtime dependency table is initialized.
- The module uses `current_app` and has no static `app.py` import.
- Compatibility exports remain available from `app.py` for direct callers and
  source-coupled tests.
- Exactly one live owner remains for each route.

## Verification

- Focused live-user and route-manifest suite: `17 passed`.
- Backend syntax compilation and `git diff --check`: passed.
- Full backend suite: `1165 passed, 11 skipped, 54 warnings`.
- `app.py` after extraction: `17,599` lines.

The skips and warnings are existing environment-gated/deprecation and legacy
test-return cases; no new failures were introduced.
