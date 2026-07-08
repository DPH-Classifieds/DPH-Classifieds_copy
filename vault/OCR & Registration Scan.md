# OCR & Registration Scan

Scans UAE vehicle registration cards (mulkiyya) to pre-fill listing fields.

## Endpoint

`POST /api/ocr/scan-registration`  
Accepts multipart image upload. Returns extracted fields (VIN, make, model, year, etc.).

## Pipeline

```
Image upload
    ↓
EasyOCR (primary)  →  extract_text()  →  parse fields
    ↓ (fallback if EasyOCR fails)
Tesseract OCR      →  extract_text_tesseract()  →  parse fields
```

## EasyOCR (`services/local_ocr.py`)

- Models: English (`en`) + Arabic (`ar`)
- Model directory: `/app/easyocr_models` (baked at build time)
- Initialised in a background daemon thread on app start (`download_enabled=True` as self-heal)
- `_get_reader()` returns `None` while initialising — endpoint returns 503, client retries
- Hard timeout in endpoint prevents 524 Railway timeout

### Build-time download (`download_ocr_models.py`)

```bash
EASYOCR_MODEL_DIR=/app/easyocr_models python download_ocr_models.py
```

Run in `nixpacks.toml` install phase. Models persist to runtime at `/app/easyocr_models`.

## Tesseract (`services/registration_ocr.py`)

Fallback when EasyOCR isn't ready. Binary discovery order:

1. `which tesseract`
2. `/root/.nix-profile/bin/tesseract`
3. `/nix/var/nix/profiles/default/bin/tesseract`
4. `/usr/local/bin/tesseract` (symlinked at build time)
5. Glob `/nix/store/*/bin/tesseract`

## Common errors

| Error | Cause | Fix |
|-------|-------|-----|
| EasyOCR not ready (503) | Cold start, models still loading | Client should retry after 3–5s |
| Missing craft_mlt_25k.pth | Models not baked / wrong EASYOCR_MODEL_DIR | Check build logs; env var must be `/app/easyocr_models` |
| Tesseract not found | Binary not on PATH at runtime | nixpacks.toml start cmd adds Nix profile bins to PATH |
| 524 timeout | OCR taking >100s | Hard timeout in endpoint returns partial result |
