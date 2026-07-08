# Known Issues & Fixes

## Sell pages crash — `Cannot access 'Cr' before initialization`

**Root cause:** `imageModeration.js` imported TensorFlow.js packages (`nsfwjs`, `blazeface`, `@tensorflow/tfjs-backend-webgl`) at module top level. TF.js has internal circular references in its module graph. When webpack bundled all sell-page components into the same chunk, the circular dep caused a temporal dead zone error on every page load.

**Fix:** Changed all four TF.js imports to dynamic `import()` calls inside `loadModels()`. TF.js now loads lazily when `moderateImage()` is first called, not at module init time.

**File:** `frontend/src/utils/imageModeration.js`

---

## Auto-review doing nothing (dry_run default)

**Root cause:** `process_once()` `dry_run` parameter defaulted to `True`. Worker evaluated every listing but skipped all approve/reject calls.

**Fix:** Changed default to `False`.

---

## Auto-review blocking every listing with images (NullVisionProvider)

**Root cause:** `NullVisionProvider.analyze()` returned `available=False`. The rules engine added `vision_unavailable` for every image, setting `image_analysis.ok = False`, blocking all listings.

**Fix:** `NullVisionProvider` now returns `available=True` — no vision API = skip image checks.

**File:** `backend/services/auto_review/vision.py`

---

## Auto-review blocking all cars without VIN

**Root cause:** `evaluate_vin("")` failed the 17-char regex immediately, returning `vin_format_invalid`. Every car posted without a VIN (majority of listings) was auto-queued.

**Fix:** `evaluate_vin()` returns `VinGateResult(ok=True)` when VIN is empty — VIN is optional for the worker. (VIN is still required in the PostCar HTML form.)

**File:** `backend/services/auto_review/vin_gate.py`

---

## Auto-review image FK wrong (listing_id doesn't exist)

**Root cause:** `_fetch_image_urls()` hardcoded `listing_id` as the FK column. None of the image tables have that column.

**Fix:** Added `ITEM_TYPE_TO_IMAGE_FK` map: `car_id`, `bike_id`, `part_id`, `plate_id`.

---

## Auto-review wrong image table names

**Root cause:** Code used `car_part_images` and `license_plate_images`. Actual tables are `part_images` and `plate_images`.

**Fix:** `ITEM_TYPE_TO_IMAGES_TABLE` corrected.

---

## Auto-review VIN always empty for cars

**Root cause:** Worker read `row.get("vin")` but cars table column is `vin_number`. Make/model also wrong (`make` → `car_manufacturer`, `model` → `car_model`).

**Fix:** Conditional field reads based on `listing_kind`.

---

## PostgREST users embed → 400 in prod

**Root cause:** Inline `users(...)` join in listing GETs returns HTTP 400 in production PostgREST.

**Fix:** Use `_batch_fetch_seller_map` pattern instead of inline join. **Never** inline `users(...)` in listing GET queries.

---

## move_to_draft silently failing

**Root cause:** Code was PATCHing `listing_state` column, which is a computed view column, not a writable DB column. All move-to-draft operations silently did nothing.

**Fix:** Use `status` column for writes. (Fixed 2026-06-19)

---

## AutoReviewPanel never showing "Awaiting" state

**Root cause:** Logic checked `if (!state) return null` before `const isPending = !state`, making the "Awaiting Auto-Review" branch unreachable dead code.

**Fix:** Check `listing.status === 'pending_auto_review'` to detect unprocessed listings, independent of `auto_review_state`.

**File:** `frontend/src/components/AdminListingDetail.jsx`

---

## OCR 524 Railway timeout

**Root cause:** EasyOCR initialisation blocked the first request thread for 60+ seconds downloading models at runtime. Railway kills connections at 100s.

**Fix:** Init in background daemon thread, non-blocking. `_get_reader()` returns `None` while loading; endpoint returns 503 for retry. Models baked at build time; `download_enabled=True` as self-healing fallback.

---

## Tesseract not found on Railway

**Root cause:** `tesseract` binary lives in Nix store at runtime but `/nix/store/*/bin` isn't on PATH. `which tesseract` and the old glob returned nothing.

**Fix:** nixpacks.toml start command prepends `/root/.nix-profile/bin` and `/nix/var/nix/profiles/default/bin` to PATH. `_auto_configure_tesseract()` also checks those profile paths before the glob.

---

## EasyOCR models at wrong path

**Root cause:** Download script resolved paths relative to `__file__`, writing to `/app/flask-react-supabase-app/backend/easyocr_models`. Runtime expected `/app/easyocr_models`.

**Fix:** Set `EASYOCR_MODEL_DIR=/app/easyocr_models` explicitly in both the nixpacks install command and in `local_ocr.py`'s background init.
