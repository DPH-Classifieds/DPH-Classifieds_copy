# DPH Classifieds

UAE classifieds platform for cars, bikes, plates, and parts.

## Quick links

- [[Architecture]] — stack, services, deployment
- [[Listing Types]] — cars, bikes, plates, parts schema & flow
- [[Auto-Review System]] — how listings get approved automatically
- [[OCR & Registration Scan]] — mulkiyya scanning pipeline
- [[Admin Panel]] — moderation tools, metrics, ops
- [[Email & Notifications]] — approval emails, 48h reminders, price drop alerts
- [[Known Issues & Fixes]] — bugs found and fixed, root causes
- [[Deployment]] — Railway (backend) + Vercel (frontend) + Supabase

## Listing status lifecycle

```
draft  →  pending  →  approved  →  expired / sold / deleted
               ↑
    pending_auto_review  (when AUTO_REVIEW_WORKER_ENABLED)
               ↓
    auto_approved  or  auto_queued → pending (manual review)
```

## Repo layout

```
flask-react-supabase-app/
├── backend/          Flask API (Railway)
│   ├── app.py        Main routes + helpers (~22k lines)
│   ├── workers/      auto_review_worker.py, worker.py
│   └── services/     auto_review/, local_ocr.py, registration_ocr.py
└── frontend/         React SPA (Vercel)
    └── src/
        ├── components/   Pages + UI
        └── utils/        apiClient, directUpload, imageModeration, …
```
