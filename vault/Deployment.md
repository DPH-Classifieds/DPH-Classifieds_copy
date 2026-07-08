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
