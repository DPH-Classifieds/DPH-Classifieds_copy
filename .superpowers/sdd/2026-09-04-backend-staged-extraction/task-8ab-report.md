# Task 8ab report — email and error admin metrics routes

## Scope

Extracted the two low-coupling read-only admin metrics handlers into
`backend/routes/admin_metrics.py`:

- `GET /api/admin/metrics/email`
- `GET /api/admin/metrics/errors`

Overview, live-user, Cloudflare, and lifecycle analytics remain root-owned.

## Compatibility and security checks

- Legacy endpoint names and automatic `GET`/`HEAD`/`OPTIONS` behavior remain
  unchanged.
- Registration occurs after `app.extensions["dph_user_backend"]` is initialized.
- The extracted module uses the Flask runtime boundary and does not import
  `app.py`.
- Existing route-specific admin lookup, days clamping, cache keys/TTL, service
  role reads, missing-table 200 envelopes, upstream error statuses, and
  aggregation response shapes are preserved.
- Exactly one live owner remains for each path.

## Verification

- Focused metrics and route-manifest suite: `17 passed`.
- Backend syntax compilation and `git diff --check`: passed.
- Full backend suite: `1158 passed, 11 skipped, 54 warnings`.
- `app.py` after extraction: `17,741` lines.

The skips and warnings are the existing environment-gated/deprecation and
legacy test-return cases; no new failures were introduced.
