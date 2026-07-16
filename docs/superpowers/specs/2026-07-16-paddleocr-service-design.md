# PaddleOCR Microservice — Design

**Date:** 2026-07-16
**Status:** Approved, implementing
**Goal:** Replace the in-process EasyOCR engine with PaddleOCR running as a
separate, horizontally-scalable Railway service, so OCR (slow, CPU-heavy)
can't starve the main API and can scale ~10x independently.

## Problem / motivation

- OCR is ~5–15s of pinned CPU per scan. Running it in-process in the web
  backend ties up a gunicorn worker per scan; at 10x scale a burst of
  mulkiya scans starves normal API traffic (browse/listings/auth).
- EasyOCR loads into every gunicorn worker (2+ model copies); memory-heavy.
- EasyOCR garbles characters on medium-quality photos. PaddleOCR PP-OCRv4
  generally out-recognizes it on real documents. (Neither can read a
  genuinely too-low-res image — that limit is resolution, not engine.)

## Architecture

Two Railway services in project `DPH-Classifieds`, talking over **private
networking** (`*.railway.internal`; OCR service never publicly exposed):

```
client → main backend  /api/ocr/scan-registration  (multipart image)
             │  preprocess → HTTP POST image bytes (X-OCR-Service-Key)
             ▼
        ocr-service (FastAPI + PaddleOCR)  →  { text }
             │
   main backend keeps ALL business logic unchanged:
   extract_registration_fields · extract_plate_fields ·
   VIN validation/repair · NHTSA decode · training-image upload · persist
```

**Boundary:** the OCR service is a *pure image→text engine*. Every piece of
already-tested business logic (VIN checksum-applicability, plate
label-proximity, field parsing) stays in the main backend, so the risky ML
swap does not touch validation.

## New component: `flask-react-supabase-app/ocr-service/`

- **FastAPI** app.
  - `POST /scan` — image bytes (multipart `image` or raw body) → `{ "text": str }`.
  - `GET /health` — `200` only once the PaddleOCR model is loaded (readiness).
- **PaddleOCR PP-OCRv4, `lang='en'`** — every field we extract (VIN, plate
  digits, make/model) is Latin; an English/Latin model typically beats a
  bilingual en+ar model on each script. Arabic on the card is never parsed.
- **Auth:** shared secret header `X-OCR-Service-Key` vs `OCR_SERVICE_KEY` env.
- **Concurrency:** startup model-load; an internal `asyncio.Semaphore` bounds
  in-flight inferences per instance — excess returns `503` fast (never OOM).
  PaddleOCR inference runs in a threadpool (`run_in_executor`) so the event
  loop stays responsive for `/health`.
- **Dockerfile:** installs `paddlepaddle` (CPU) + `paddleocr`, bakes the
  PP-OCRv4 detection+recognition models at build time (mirrors the old
  EasyOCR model-bake) so runtime needs no network.
- **Scale:** stateless; model loads once per instance (vs per gunicorn worker
  today); scale via uvicorn workers + Railway replicas behind readiness.
- **Config:** `gunicorn.conf.py`-equivalent via uvicorn/gunicorn worker count;
  `PORT` from Railway; `OCR_MAX_CONCURRENCY`, `OCR_SERVICE_KEY` envs.

## Main backend changes

- New `PaddleOCRServiceProvider.extract_text(image)` in
  `services/registration_ocr.py` — encodes the PIL image to bytes, HTTP POSTs
  to the OCR service, returns `text`. Mirrors the VIN-decoder remote pattern
  (`requests`, timeout, env base URL, one retry on 503). Env:
  `OCR_SERVICE_URL`, `OCR_SERVICE_KEY`, `OCR_SERVICE_TIMEOUT_SECONDS`.
- `get_default_ocr_provider()` returns `PaddleOCRServiceProvider`.
- **Delete:** `services/local_ocr.py`, `EasyOCRProvider`, the `/hf-extract`
  route (now dead client-side), `easyocr`+`torch`+`pypdfium2?` review from
  `requirements.txt` (keep pypdfium2 — still used for PDF render), the EasyOCR
  model-bake from the backend Dockerfile, `download_ocr_models.py`.
- **PDF handling:** `preprocess_image` still renders PDF page 1 via pypdfium2
  in the main backend, then sends the rendered image to the OCR service. The
  OCR service only ever receives raster images, never PDFs.
- **Preprocessing** becomes PaddleOCR-appropriate: keep upscaling small
  images (resolution always helps); drop the EasyOCR-specific
  grayscale+sharpen (PaddleOCR prefers color). **Calibration knob** — tuned
  empirically against the two real sample docs.

## Web frontend change

- Remove the browser-Tesseract fallback in `PostCar.js` (STEP 2) — the
  garbage-VIN source. On backend OCR failure: show "OCR unavailable, please
  enter details manually." (The client-side VIN validation fix from the prior
  commit stays as defense-in-depth.)

## Data flow

1. Client → `/api/ocr/scan-registration` (multipart image).
2. Main backend: `preprocess_image` (PDF→raster, EXIF, upscale) →
   `PaddleOCRServiceProvider.extract_text(image)` → HTTP POST bytes to
   `ocr-service /scan` → `{text}`.
3. Main backend: `extract_registration_fields` + `extract_plate_fields` +
   VIN validation/repair + NHTSA decode (unchanged, tested).
4. Persist scan + best-effort training-image upload (unchanged).
5. Return structured fields to client.

## Error handling

OCR service unreachable / timeout / 503 / auth-fail → main backend returns the
existing `ocr_unavailable` response (`needs_review: true`, no fabricated data).
One brief retry on 503. Never fabricates a value.

## Testing & exit proof

- OCR service: `/scan` + `/health` unit tests with a mocked predictor;
  Dockerfile builds cleanly.
- Main backend: `PaddleOCRServiceProvider` tested against a mocked HTTP
  response (like the VIN-decoder tests). Existing field-extraction/validation
  tests are unchanged (they feed fake text — still the core correctness gate).
- **Exit proof:** run the *real* PaddleOCR service against `Mulkiyya.JPG` and
  `Vehicle_License_Card.pdf`; confirm extracted text → correct VIN/plate;
  compare head-to-head against the EasyOCR numbers already captured, to have
  evidence PaddleOCR is at least as good *before* cutting over.
- **Live:** deploy `ocr-service` to Railway (project DPH-Classifieds),
  set `OCR_SERVICE_URL`/`OCR_SERVICE_KEY` on both services, redeploy the main
  backend, test on the live website.

## Sequencing (de-risked)

1. Build `ocr-service` + Dockerfile; verify real PaddleOCR reads the two docs
   locally.
2. Add `PaddleOCRServiceProvider` in the main backend behind an env flag,
   keeping EasyOCR until the service is proven.
3. Deploy `ocr-service` to Railway; point the main backend at it; verify live.
4. Only then remove EasyOCR / `local_ocr.py` / `/hf-extract` / model-bake and
   the browser-Tesseract fallback.

## Caveats

- Low-res JPG likely still yields no VIN — resolution, not engine.
- PaddlePaddle on Railway can be finicky (image size, x86 wheels); pin
  versions, verify the build.
- Big change — sequence so the service is proven before EasyOCR is removed.
