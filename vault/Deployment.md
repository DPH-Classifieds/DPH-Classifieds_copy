# Deployment

## Services

| Service | Host | Trigger |
|---------|------|---------|
| Backend API | Railway (`web` service) | Push to GitHub main |
| Background worker | Railway (`worker` service, `SERVICE_ROLE=worker`) | Push to GitHub main |
| Frontend SPA | Vercel | Push to GitHub main (auto-deploy) |
| Database | Supabase | Manual migrations |

> **Redeploying Railway does NOT update the frontend.** Frontend lives on Vercel and redeploys automatically when GitHub is updated. If Vercel isn't showing changes, trigger a manual redeploy from the Vercel dashboard, or hard-refresh the browser (`Cmd+Shift+R`).

## Railway

Two services share the same repo:
- `web` — runs `gunicorn app:app` from `flask-react-supabase-app/backend/`
- `worker` — runs `python worker.py`, controlled by `SERVICE_ROLE=worker` env var

Start command in `nixpacks.toml` branches on `SERVICE_ROLE`:
```bash
if [ "${SERVICE_ROLE:-web}" = "worker" ]; then python worker.py; else gunicorn ...; fi
```

## Vercel

Config: `flask-react-supabase-app/frontend/vercel.json`  
Build: `npm run build` (CRA + craco)  
Output: `build/`  
SPA routing: all paths rewrite to `/index.html`

## Supabase migrations

Run SQL migrations manually in the Supabase dashboard SQL editor.  
Pending as of last check:
- `push_tokens` table (mobile push notifications)
- 48h reminder jobs schema

## Environment variables to set on Railway

```
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
REDIS_URL
AUTO_REVIEW_WORKER_ENABLED=true
EASYOCR_MODEL_DIR=/app/easyocr_models
JWT_SECRET_KEY
SENDGRID_API_KEY   (or email provider key)
```

## Deployment checklist

- [ ] All migrations run in Supabase
- [ ] `EASYOCR_MODEL_DIR=/app/easyocr_models` set in Railway
- [ ] `AUTO_REVIEW_WORKER_ENABLED=true` (or use Redis toggle from Admin Tools)
- [ ] `AUTO_REVIEW_DRY_RUN` not set (or set to `false`)
- [ ] Redis URL configured so the Admin Tools toggle persists
- [ ] Vercel env vars set (`REACT_APP_SUPABASE_URL`, `REACT_APP_SUPABASE_KEY`, `REACT_APP_API_URL`)

## Reddit imported listings (worker only)

Imports eligible for-sale posts from r/DubaiPetrolHeads every 4h as DPH
Classifieds–owned, clearly-attributed listings. Backend worker only — the
frontend/Vercel must never receive Reddit credentials, and the DPH account
password is **not** a worker credential (service-role writes perform the import).

Runbook:

1. Apply both migrations in the Supabase SQL editor **before** enabling:
   - `backend/migrations/2026_07_23_reddit_imported_listings.sql` (source columns, `reddit_import_runs`, status allowlist + `source_removed`).
   - `supabase/migrations/20260723000001_reddit_post_open_analytics.sql` (adds `reddit_post_open` to `record_analytics_event`).
2. Resolve the owner UUID for `admin@dphclassifieds.com` in `public.users`; confirm it is not deleted and displays as `DPH Classifieds`. Record only the UUID as `REDDIT_IMPORT_OWNER_ID`.
3. Add the server-only variables to Railway's **worker** service (see `backend/.env.example`): `REDDIT_IMPORT_ENABLED`, `REDDIT_IMPORT_INTERVAL_SECONDS=14400`, `REDDIT_IMPORT_SUBREDDIT`, `REDDIT_IMPORT_MAX_POSTS`, `REDDIT_IMPORT_OWNER_ID`, `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USER_AGENT`. Leave `REDDIT_IMPORT_ENABLED=false` for the first deploy.
4. Deploy the worker; confirm the log line `Reddit import worker registered ... enabled=false — no fetch while disabled` (job registered, zero Reddit calls).
5. Set `REDDIT_IMPORT_ENABLED=true`. After one 4h tick verify: a `succeeded` `reddit_import_runs` row with non-zero `fetched_count`; a public card with the Reddit badge, source disclaimer, Reddit preview image, and a canonical `www.reddit.com` original link; a `listing_view` and (after clicking the CTA) a `reddit_post_open` counter in the admin Reddit panel.
6. Rollback: set `REDDIT_IMPORT_ENABLED=false`. Existing imported rows stay visible until an explicit admin lifecycle action; removed-source rows are unpublished (`status='source_removed'`, `is_approved=false`) but retained for audit. Removal is confirmed per-post via `/api/info`, never inferred from falling out of the newest-100 window.

Checklist additions:

- [ ] Both Reddit migrations run in Supabase
- [ ] `REDDIT_IMPORT_OWNER_ID` verified against `admin@dphclassifieds.com`
- [ ] Reddit vars set on the **worker** service only (never Vercel)
- [ ] Worker log shows the import job registered while disabled
