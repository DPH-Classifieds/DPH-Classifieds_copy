# Task 4d: Extract authenticated car-part creation

## Ownership

The worker owns the new application module and route-isolated parity tests. The
compatibility root owns only dependency wiring and registration after parity is
proven. Do not edit dealer/admin, VIN, worker, frontend, or unrelated read routes.

## Required behavior

- Preserve authenticated `POST /api/parts`, endpoint name, decorator, status codes,
  JSON response shape, validation order, and legacy direct-call compatibility.
- Preserve verified-user, dealer-verification, image count/size, multipart upload,
  JSON image ownership/host/path validation, lifecycle fallback, allowed-field
  filtering, compatible-year coercion, WhatsApp alignment, profanity/description
  checks, notifications, image persistence, and auto-review triggering.
- Use explicit root-supplied dependencies. The extracted module must not import
  `app.py`, read process environment directly, or reach into Flask config.
- Preserve the current non-fatal image persistence and notification behavior. Do
  not broaden accepted public image references or silently alter upload limits.

## Verification contract

1. Add route-isolated parity tests before implementation and record RED/GREEN.
2. Run focused part-create/read/media/manifest tests, then the full backend suite
   with declared dependencies available.
3. Run Docker API/E2E smoke at the current commit if Docker is available.
4. Report exact counts, skipped tests, warnings, changed files, and any live
   Supabase/email gates.

## Review risks

- Multipart and JSON paths have different image handling; both must remain intact.
- The route mutates the JSON payload by removing `images`; parity tests must cover
  that response/persistence behavior without allowing unsafe URLs.
- Keep the route's current lifecycle fallback and image insert semantics unchanged.
