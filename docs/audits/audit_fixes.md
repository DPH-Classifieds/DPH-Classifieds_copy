# DPH Classifieds audit remediation ledger

Date: 2026-08-28
Sources reviewed: `AUDIT_REPORT.md` and `../../dphdocthing.pdf` (24 pages).

## Completed in this checkout

### Security and correctness

- Added `backend/services/url_safety.py`. Dealer webhooks, webhook delivery, dealer API-source creation/test/polling, and auto-review image downloads now reject loopback, private, link-local, reserved, multicast, metadata, credential-bearing, invalid, and unresolvable destinations.
- Added atomic `pending -> firing` approval claims and `pending -> in_progress` webhook claims, preventing duplicate approval emails and duplicate webhook deliveries across worker replicas.
- Scoped dealer diagnostic listing and market snapshot reads by the caller's `dealership_id`; missing rows return not-found behavior.
- Added the super-admin protection check to the API blueprint's remove-admin route.
- Replaced raw XML parsing with `defusedxml` and pinned it in backend requirements.
- Made OCR and Vision inference endpoints fail closed when their service key is missing.
- Added non-root `appuser` execution to backend, OCR, and Vision Docker images.
- Constrained `apply_migration.py` to `.sql` files inside the approved migrations directories.
- Removed JWT fragments from authentication logs and disabled the request-echo debug endpoint in production.
- Added locking around in-process rate-limit deques and VIN cache access. Configured `ProxyFix` only when an explicit `TRUSTED_PROXY_HOPS` value is set; client-supplied `X-Forwarded-For` is no longer used for contact throttling.
- Added a new Supabase hardening migration covering service-role-only policies for sensitive dealer/listing tables, protected user admin flags, canonical `is_admin()` compatibility, and approved browse indexes.
- Moved mobile auth data to `expo-secure-store` with one-time migration/removal of the legacy AsyncStorage key. Mobile Supabase session persistence also uses SecureStore.
- Removed global Axios request/response interceptors and global bearer-header mutation from the web auth service.
- Made web and mobile 401 refresh retries local to each request instead of mutating caller options.
- Removed the eager web CORS probe on module import and removed the dead user localStorage write from `AuthContext.updateUser`.
- Added submit/draft/OCR mutual exclusion to `PostCar.js`.

### Performance and UX

- Reduced Reddit Explore requests from 250 to 30 per category and mobile Reddit listing requests to 30.
- Fixed Explore's cache option bug: it now passes `{ttlMs}` rather than a number, so the intended TTL is applied.
- Memoized `MarketplaceListingCard`.
- Added a passive header scroll listener.
- Added a global `prefers-reduced-motion` mode.
- Generated optimized homepage assets:
  - `frontend/public/images/optimized/hero-1600.jpg` (~648 KB)
  - `frontend/public/images/optimized/bottom-landing-1600.jpg` (~188 KB)
  and updated the homepage to use them.
- Added `fetchPriority="high"` to the hero image.
- Added `expo-secure-store` to mobile dependencies and lockfile.

### Newly identified findings completed in the follow-up pass

- Added global user session revocation cutoffs for locally validated and
  Supabase-validated JWTs. Member removal calls the Supabase Admin logout
  endpoint; logout and password changes revoke existing sessions. New tokens
  are compared against the cutoff rather than clearing the cutoff and reviving
  old tokens.
- Added tenant-scoped Reddit import/upsert and cleanup protections, bounded
  registration OCR upload bytes/PDF pages/worker concurrency, bounded decoded
  analytics volume, sanitized admin error responses, and fixed API-source and
  webhook malformed-response handling. Added decoded-pixel guards to both
  standalone OCR and Vision services.
- Added safe redirect handling and bounded streaming responses for dealer API
  sources and webhook delivery. Added API-source leases and stale webhook claim
  recovery/tenant checks.
- Pinned FastAPI/Starlette in OCR and Vision services to patched versions and
  pinned the required OpenCV runtime. `opencv-contrib-python` was verified as
  unused/not declared and was deliberately not added, avoiding unnecessary
  duplicate native payloads. Added Docker build-context
  exclusions so local `.env`, credentials, and private keys cannot be copied by
  `COPY .`.
- Verified the nine proposed frontend dead-file candidates and removed only
  those with no live import/reference: `CarPartsRedesigned.css`, `AdminOps.css`,
  `DetailView.css`, `PlatePreview.css`, `tokenDebug.js`, `ui/demo.tsx`,
  `ui/navbar-5.tsx`, `Footer.js`, and `Footer.css`. The active footer is
  `ui/hover-footer.jsx`.
- Corrected VIN reveal authorization so frontend owner state cannot bypass the
  phone-verification requirement, and suppressed invalid third-party contact
  links.
- Reconciled the PDF's broad green indexing assessment with the code-level
  S-DB5/S-DB6 findings: general indexing is reasonable, but approved-browse and
  unanchored model-search access patterns still require targeted indexes.
- Corrected the matplotlib false-positive wording in `AUDIT_REPORT.md`; the PDF
  claim was code injection, not that matplotlib was absent.

### Additional hardening pass

- Unified the auto-review sync gate for cars, bikes, car parts, and license
  plates, and added listing-type regression coverage.
- Bounded Explore rendering and each client-side category buffer, added a
  repeatable `npm run audit:media` check, and paused Three.js when hidden,
  offscreen, or reduced-motion is enabled.
- Added HMAC signing and constant-time verification for the Reddit bridge.
- Hardened parts multipart uploads, signed storage paths, legacy car-image
  insertion, dealer verification failure handling, information-request upload
  quotas, and dealer inventory object names.
- Moved plate proof documents to private registration-document storage and made
  owner/admin reads use short-lived signed URLs; ordinary public listing images
  remain public.
- Applied non-root container execution and safe dependency updates. React
  Router was upgraded to the patched 7.18.3 line; the legacy CRA/Jest test
  runtime now maps its `react-router/dom` entry and supplies TextEncoder APIs.

### Media replacement and user-upload handling

- Replaced the five oversized marketing assets with the supplied AVIF files:
  `hero.avif`, `bottom-landing.avif`, `IMG_3391.avif`, `About-page.avif`, and
  `Our Mission.avif`. References and social metadata now use the AVIF paths.
  The original files were moved to `non-essential/original-marketing-assets/`
  for recovery, outside the shipped public tree.
- The supplied files preserve the source dimensions and pass the 1 MiB media
  budget; `IMG_3391.avif` was additionally resized to 5000px wide and
  recompressed to 619 KB because the supplied version was 1.15 MB.
- Browser listing/profile photos are now bounded to 2400px/1600px respectively
  and encoded as quality-controlled JPEG before direct upload. Registration and
  dealer documents remain unoptimized so document fidelity is preserved.
- Backend-mediated listing uploads already validate MIME plus decoded raster
  content, enforce byte/pixel limits, normalize orientation, strip metadata,
  resize to 1920px, and generate optimized JPEG/display variants. Direct
  uploads remain scoped to server-issued per-user paths and Storage bucket
  limits; a production post-upload content scanner is still recommended for
  hostile clients because a signed Storage upload cannot inspect decoded bytes
  before accepting them.
- Signed-upload issuance now requires a positive bounded size, an allow-listed
  MIME type, and an allowed extension for the target bucket before Supabase
  returns a token. This blocks arbitrary content-types and oversized direct
  upload requests at the issuance boundary; decoded byte/content verification
  still belongs in the post-upload scanner for hostile clients.

## Verification completed

- Backend: `711 passed, 9 skipped, 43 warnings`; Python compilation passed for all changed Python modules.
- Frontend: production build passed; frontend tests passed: 11 suites / 55 tests.
- Mobile: tests passed: 15 suites / 72 tests; Expo lint has 0 errors and 177 pre-existing/non-blocking warnings.
- `git diff --check` passed.
- The dedicated Codex Security Deep Scan could not start because its managed filesystem permission profile was unavailable. TAC status also reported the security connector is not connected. No “no vulnerabilities” claim is made from that tool.

## Not completed / requires external or larger-scope work

- Rotate the live credentials in `backend/.env` and any previously exposed history. This is intentionally the one requested exclusion, requires provider access, and must be done before treating production as secure. The local files remain ignored and were not printed or deleted.
- Applied `supabase/migrations/20260828000001_security_hardening.sql` to the
  linked `DPH_Classifieds` project and confirmed it in remote migration
  history. `supabase db lint --linked --fail-on error` reports no schema errors.
  Authenticated two-tenant RLS/IDOR tests and live Storage policy inspection
  still require project test accounts and runtime requests.
- Redeploy backend, workers, OCR, Vision, and frontend images, then verify the deployed commit and live endpoints. No deployment was performed in this checkout.
- Complete real browser/mobile E2E: signup, email confirmation, dealer document upload, OCR, admin review, auto-approval, listing gate, webhook SSRF rejection, session revocation, and two-tenant access tests.
- Full server-side search/filter/ranking, cursor pagination, minimal list DTOs, and gallery/thumbnail API separation remain larger follow-up changes. Explore now has bounded client rendering and buffering, but it is not a replacement for server-side querying.
- Full admin-statistics aggregation/view rewrite, user-listing N+1 elimination, backend monolith split, PostCar split, and all frontend/mobile hook dependency cleanup remain outstanding.
- Full responsive AVIF/WebP `picture/srcset` matrix, analytics autocapture
  review, and CSS blur profiling remain outstanding. The shipped marketing
  assets now pass the size/duplicate gate. Three.js lifecycle pausing and
  reduced-motion handling are implemented.
- Expo Updates setup, profile-photo progress/compression, persisted listing cache hydration, and full mobile router cleanup remain outstanding. The legacy Expo `App.js`, `index.js`, and `src/navigation/AppNavigator.js` were removed after router-only export verification.
- Dealer-document metadata stripping for raster documents and auto-review trust-history enforcement are implemented; PDF metadata stripping remains intentionally unimplemented because rasterizing PDFs can destroy fidelity. Complete audit-on-GET behavior, live Supabase logout, and multi-worker Redis behavior still require deployment verification.
- Dependency review now pins Flask-CORS 6.0.5, Pillow 12.3.0, and the backend
  cryptography constraint to the maintained 46-50 range. The OCR resolver still
  requires a Python 3.11/3.12 runtime because PaddlePaddle 2.6.2 has no Python
  3.13 wheel; the model stack must be upgraded and regression-tested before
  changing that runtime constraint. Mobile Expo/Metro and other build-tool
  advisories require major upgrades or provider-specific decisions. Docker
  images still need image builds and digest/SBOM scanning. The PDF's false
  positives (CSP absent, `eas.json` secret, HEIC decoding, Torch/Explore SSRF,
  etc.) were not broken or removed.

## Release gate

### Latest local verification

- Backend: `735 passed, 9 skipped, 43 warnings, 10 subtests passed` with
  `uv run --with defusedxml pytest -q`; compilation passed.
- Frontend: `12 suites / 59 tests passed`; production build passed; production
  `npm audit --omit=dev --audit-level=high` reports no findings after the React
  Router upgrade.
- Mobile: `15 suites / 72 tests passed`.
- Reddit bridge: typecheck, build, and HMAC tamper test passed.
- `git diff --check` passed.
- `npm run audit:media` is intentionally failing on the five oversized legacy
  assets listed above (2.1 MB, 5.8 MB, 6.4 MB, 4.3 MB, and 16.5 MB); it reports
  no remaining exact duplicate hashes.
- The managed Codex Security deep scan could not start because its required
  filesystem permission profile was unavailable, and TAC was disconnected.

This checkout is locally patched and test-verified for the newly identified findings, but it is not honestly production-secure or fully end-to-end until the replacement media is supplied, unresolved dependency/container items are closed or documented, external secret rotation, Supabase migration, redeploy, and authenticated live E2E gates above are completed.
