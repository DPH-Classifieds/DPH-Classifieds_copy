# Self-hosted vision and OCR learning foundation

This change is intentionally inert on existing deployments. It adds the code,
schema and observability needed to improve image moderation and PaddleOCR
without replacing the current moderation policy or requiring a new credential.

## What is safe to ship now

- `vision-service/` is a private FastAPI service using NudeNet and OpenCLIP.
  It returns scores and observations only; it does not decide whether a listing
  is accepted or rejected.
- The backend's vision client is fail-closed. `VISION_SERVICE_MODE` accepts
  only `disabled` (the default) and `shadow`; invalid values resolve to
  `disabled`.
- In `shadow` mode the worker writes model observations to
  `moderation_image_checks`. They are never added to auto-review reasons and
  cannot alter a listing's status or delete an image.
- PaddleOCR remains the same recognizer. Its service response now contains
  line order and non-sensitive runtime diagnostics. Diagnostics are stored only
  when `OCR_DIAGNOSTICS_AUDIT_ENABLED=true`, after the SQL migration is applied.

## Later, when Railway and Supabase access is available

1. Apply `backend/migrations/20260812000001_moderation_learning_foundation.sql`
   through the normal Supabase migration process.
2. Create a Railway service from `vision-service/`. Do not add a public domain.
   Set `VISION_SERVICE_KEY` to a long random value and wait for its private
   `/health` endpoint to return `{"status":"ok"}`.
3. In the backend worker service only, set the same key plus:

   ```env
   VISION_SERVICE_URL=http://vision-service.railway.internal:8000
   VISION_SERVICE_MODE=shadow
   VISION_SERVICE_AUDIT_ENABLED=true
   ```

   Keep `AUTO_REVIEW_VISION_PROVIDER` unchanged. Restart the worker and review
   audit rows for at least one normal listing cycle.
4. Set `OCR_DIAGNOSTICS_AUDIT_ENABLED=true` only after confirming the new
   column exists. Deploy the updated `ocr-service` to begin collecting latency,
   language, engine version and line-count diagnostics.
5. Have moderators label a representative sample in `moderation_labels`.
   Evaluate false-positive and false-negative rates weekly. A model may move
   from `candidate` to `shadow` only with recorded metrics in `model_registry`.
   There is intentionally no automatic retraining or promotion.

## Rollback

Set `VISION_SERVICE_MODE=disabled` or `VISION_SERVICE_AUDIT_ENABLED=false`.
This stops new calls immediately and leaves the current moderation system
unchanged. Set `OCR_DIAGNOSTICS_AUDIT_ENABLED=false` to stop the extra OCR
audit field. No data migration rollback is needed for either toggle.

## Acceptance checks

1. `GET /health` from the backend's Railway private network returns `200`.
2. A test listing completes with exactly the same status and auto-review
   reasons as before, while one row per image appears in
   `moderation_image_checks`.
3. A non-image, oversized image and an unavailable vision service each leave
   the listing outcome unchanged and create no user-visible raw error.
4. OCR results retain the same `text` and `lines` contract, with an additive
   `diagnostics` object; registration scans continue if audit persistence is
   disabled or unavailable.
