# Architecture

## Stack

| Layer | Tech | Host |
|-------|------|------|
| Frontend | React (CRA + craco) | Vercel |
| Backend API | Flask + Gunicorn | Railway |
| Database | PostgreSQL via Supabase | Supabase |
| Auth | Supabase Auth + JWT | Supabase |
| Storage | Supabase Storage (S3-compatible) | Supabase |
| Cache | Redis | Railway (or Upstash) |
| Background jobs | Python threads + `worker.py` | Railway (SERVICE_ROLE=worker) |
| Mobile | Expo / EAS | App Store / Play Store |

## Request flow

```
Browser → Vercel (React SPA)
               ↓ API calls
         Railway (Flask)
               ↓
         Supabase REST (PostgREST) + Auth
               ↓
         PostgreSQL
```

## Key env vars (backend)

| Var | Purpose |
|-----|---------|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_ANON_KEY` | Public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin DB access |
| `REDIS_URL` | Cache + toggle storage |
| `AUTO_REVIEW_WORKER_ENABLED` | Fallback when Redis unavailable |
| `AUTO_REVIEW_DRY_RUN` | Evaluate but never approve (default false) |
| `EASYOCR_MODEL_DIR` | Path to baked OCR models (set to `/app/easyocr_models`) |
| `SERVICE_ROLE` | `web` (default) or `worker` — controls start command |

## PostgREST rules

- Never inline `users(...)` in listing GETs — causes 400 in prod. Use `_batch_fetch_seller_map` instead.
- Service role key bypasses RLS.

## Nixpacks build (Railway)

Install phase:
1. Create venv, install pip/wheel
2. Install PyTorch (CPU)
3. Install `requirements.txt`
4. Symlink Tesseract binary to `/usr/local/bin/tesseract`
5. Download EasyOCR models to `/app/easyocr_models`

Start command adds `/root/.nix-profile/bin` and `/nix/var/nix/profiles/default/bin` to PATH so Tesseract is found at runtime.
