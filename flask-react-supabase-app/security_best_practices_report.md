# Security Audit Report

Date: 2026-04-09

Project: `flask-react-supabase-app`

Live Supabase project reviewed: `DPH_Classifieds` (`ltjatsyhpmvewancqdjw`)

## Scope

- Flask backend auth, data access, and security headers
- React frontend auth client and deployed frontend headers
- Live Supabase table RLS, views, functions, storage buckets, and security advisors

## Executive Summary

The current posture is materially better after the live Supabase hardening applied during this review, but it is not yet fully locked down.

The main architectural issue was that the backend validated the caller's Supabase JWT, then dropped it and made user-scoped PostgREST requests with the anon key instead. That design forced some live RLS policies to remain broader than they should be. I fixed that behavior locally in the backend, but that code change still needs to be deployed before the remaining permissive live policies can be safely tightened.

## Changes Applied During This Review

- Applied live Supabase migration `security_hardening_safe_20260409`.
- Set `public.dealer_users` to `security_invoker=true`.
- Hardened `search_path` on the `enqueue_*` trigger functions flagged by Supabase.
- Restricted the `profile-photos` storage bucket to image MIME types and a 5 MB size limit.
- Patched the backend to preserve the validated caller JWT on the request and reuse it for user-scoped Supabase REST calls.
- Added a pending follow-up migration at `backend/migrations/tighten_rls_after_jwt_forwarding.sql`.

## Findings

### SEC-001 Critical

The backend validated the caller's Supabase token and then replaced it with the anon key for user-scoped PostgREST calls.

Impact:
- RLS based on `auth.uid()` could not reliably protect user-scoped reads and writes performed through Flask.
- This is the direct reason some live policies were left broader than necessary.

Evidence:
- `backend/app.py:773`
- `backend/app.py:877`
- `backend/app.py:894`
- `backend/app.py:903`

Status:
- Fixed locally in `backend/app.py`.
- Not yet deployed.

### SEC-002 Critical

`public.plate_images` is still materially over-permissive in the live database.

Current live policies:
- `DELETE USING (true)`
- `INSERT WITH CHECK (true)`
- `UPDATE USING (true)`

Impact:
- Any caller reaching the table through PostgREST can modify or delete plate images without ownership checks.

Live evidence:
- Supabase policy snapshot on 2026-04-09 showed the above policies on `public.plate_images`.

Required action:
- Deploy the backend JWT-forwarding fix first.
- Then apply `backend/migrations/tighten_rls_after_jwt_forwarding.sql`.

### SEC-003 High

`public.users` and `public.reports` still use broad self-service `FOR ALL` policies in the live database.

Current live patterns:
- `public.users`: self policy grants `ALL` on own row
- `public.reports`: self policy grants `ALL` on own reports

Impact:
- The app grants broader rights than needed.
- Principle of least privilege is not satisfied.

Live evidence:
- `public.users` policy `Users can view and update their own data` currently uses `cmd = ALL`
- `public.reports` policy `Users can view and create their own reports` currently uses `cmd = ALL`

Required action:
- Apply the pending migration after backend deployment so these become operation-specific `SELECT` and `UPDATE` or `INSERT` rules.

### SEC-004 High

CAPTCHA verification fails open when `TURNSTILE_SECRET_KEY` is missing.

Impact:
- If the secret is absent in production, bot protection silently becomes optional.

Evidence:
- `backend/app.py:620`
- `backend/app.py:622`
- `backend/app.py:624`
- `backend/app.py:657`

Required action:
- Change the production behavior to fail closed.
- Treat missing Turnstile configuration as a deployment error.

### SEC-005 High

The backend still contains startup logic that attempts to create and patch database tables and RLS policies at runtime with the service role key.

Impact:
- Runtime schema mutation makes production state harder to reason about.
- A startup path should not be responsible for authoring security policy.

Evidence:
- `backend/app.py:677`
- `backend/app.py:700`
- `backend/app.py:716`
- `backend/app.py:755`

Required action:
- Remove or permanently disable `ensure_tables_exist()` in production.
- Manage schema and RLS only through migrations.

### SEC-006 Medium

Supabase Auth leaked-password protection is disabled.

Impact:
- Users can set known-compromised passwords.

Status:
- Could not be changed through the currently available connector surface.

Required action:
- Enable leaked-password protection in Supabase Auth settings.

### SEC-007 Medium

The live Postgres version has pending security patches available.

Impact:
- The database is behind the current patched release.

Status:
- Could not be upgraded through the current connector surface.

Required action:
- Upgrade the Supabase Postgres instance through the Supabase platform workflow.

### SEC-008 Medium

The Flask CSP still allows both `'unsafe-inline'` and `'unsafe-eval'` in `script-src`.

Impact:
- This weakens XSS containment.

Evidence:
- `backend/app.py:539`
- `backend/app.py:548`

Notes:
- The frontend already ships useful browser security headers in `frontend/vercel.json:13`.

Required action:
- Remove `'unsafe-eval'` first if possible.
- Replace inline script dependencies with nonces or hashed sources where practical.

### SEC-009 Medium

The `pg_net` extension is still reported by Supabase as installed in the `public` schema.

Impact:
- Supabase continues to flag it as an external security warning.

What I checked:
- There are no repo references to `pg_net`, `net.http_get`, `net.http_post`, or related calls.
- The extension could not be moved with `ALTER EXTENSION ... SET SCHEMA`; this project rejects that operation.

Required action:
- Decide whether `pg_net` is needed at all.
- If it is not needed, remove it.
- If it is needed, keep it under review and restrict usage to controlled server-side workflows.

### SEC-010 Low

The frontend and backend already include a useful baseline of hardening headers.

Evidence:
- `frontend/vercel.json:13`
- `backend/app.py:539`

Notes:
- This is a positive finding, not a blocker.

## Supabase Live State After Changes

- `public.dealer_users` now has `security_invoker=true`.
- All reviewed `enqueue_*` trigger functions now have `search_path=public, pg_temp`.
- `profile-photos` bucket now has:
  - `public = true`
  - `file_size_limit = 5242880`
  - `allowed_mime_types = [image/jpeg, image/jpg, image/png, image/gif, image/webp]`
- `listing-images` bucket is also capped at 5 MB and image-only MIME types.
- No live `storage.objects` policies are currently exposed. In the present app architecture, uploads go through the backend using the service role key, so this is not currently a direct anonymous-write exposure.

## Supabase RLS Inventory

Tables that are already materially owner-scoped or admin-scoped:
- `cars`
- `bikes`
- `car_parts`
- `license_plates`
- `car_images`
- `bike_images`
- `part_images`
- `advertisements`
- `privacy_policies`

Tables that are admin-only or service-role-only in the current live state:
- `clients`
- `documents`
- `requests`
- `email_events`

Tables still needing follow-up tightening:
- `plate_images`
- `reports`
- `users`

Why `plate_images` was not tightened live during this review:
- The current plate-creation backend path still writes `public.plate_images` through `supabase_request(..., user_id=current_user)`.
- On the deployed backend, that helper still falls back to the anon key instead of the validated caller JWT.
- Tightening `plate_images` to authenticated ownership live before deploying the backend JWT-forwarding fix would risk breaking plate creation for users.

Remaining Supabase advisor warnings:
- `plate_images` permissive RLS
- leaked password protection disabled
- Postgres patch level
- `pg_net` extension reported in `public`

## Website Color Palette

Canonical palette sources:
- `frontend/src/index.css:39`
- `frontend/public/manifest.json:23`

Primary colors:
- `#01351c`
- `#014d2a`
- `#012513`
- `#4CAF50`
- `#00c853`
- `#000000`
- `#ffffff`
- `#f5f5f7`
- `#272729`
- `#1d1d1f`

Frequently used secondary UI colors across the frontend:
- `#eef7ef`
- `#f8f9fa`
- `#0b6b4c`
- `#004e37`
- `#dc3545`
- `#0066cc`
- `#ffb4ab`

## Finalise Checklist For Devs

1. Deploy the local backend change in `backend/app.py` so Flask keeps and forwards the caller JWT to Supabase.
2. Apply `backend/migrations/tighten_rls_after_jwt_forwarding.sql`.
3. Remove or disable runtime schema mutation from `ensure_tables_exist()`.
4. Enable Supabase leaked-password protection.
5. Upgrade the Supabase Postgres instance to the current patched release.
6. Decide whether `pg_net` is required; remove it if unused.
7. Tighten the CSP to remove `'unsafe-eval'` and reduce inline-script reliance.
8. Remove the login page only after auth-dependent routes and redirects are cleaned up, then run timing tests without the admin page in the path.

## Dev Cleanup And Finalization Request

Ask the devs to clean and finalise the following before performance testing:

1. Deploy the `backend/app.py` JWT-forwarding fix first.
2. Run `backend/migrations/tighten_rls_after_jwt_forwarding.sql` immediately after deploy.
3. Remove dead or legacy plate-image flows if the current product no longer uploads plate images from the client.
4. Remove runtime schema/RLS mutation from app startup and make migrations the only source of truth.
5. Review every route still using the service role for user profile reads or writes and downgrade to caller-JWT access wherever possible.
6. Confirm Supabase Auth hardening in the dashboard:
   leaked-password protection on, production email delivery configured, and only intended providers enabled.
7. Confirm platform hardening outside the repo:
   Vercel env vars, Railway env vars, and secret rotation for any exposed admin or service credentials.
