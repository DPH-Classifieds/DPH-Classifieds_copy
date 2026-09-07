# Task 8aa report — phone-verification HTTP routes

## Scope

Extracted the three phone-verification HTTP handlers from the compatibility root into `backend/routes/phone_verification.py`:

- `POST /api/phone-verifications/start`
- `POST /api/phone-verifications/verify`
- `POST /api/phone-verifications/verify-token`

Shared normalization, persistence, provider, MSG91, and rate-limit helpers remain in `app.py`.

## Compatibility and security checks

- Legacy endpoint names and route methods remain unchanged.
- Runtime registration occurs after `app.extensions["dph_user_backend"]` is initialized.
- The extracted module resolves dependencies through Flask `current_app`; it does not import `app.py`.
- Auth, resend ownership, purpose/listing binding, provider-safe errors, UAE phone validation, MSG91 token binding, audit persistence, and listing sync behavior remain covered by focused contracts.
- The route manifest contains one owner for each extracted path.

## Verification

- Focused phone, source-coupling, and route-manifest suite: `25 passed`.
- Backend syntax compilation and `git diff --check`: passed.
- Full backend suite: `1151 passed, 11 skipped, 54 warnings`.
- `app.py` after extraction: `17,875` lines.

The skipped tests are the existing environment-gated cases; warnings are existing deprecations and legacy test-return warnings.
