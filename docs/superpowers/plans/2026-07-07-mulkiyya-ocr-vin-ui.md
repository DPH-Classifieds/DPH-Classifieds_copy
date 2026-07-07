# Mulkiyya Upload + OCR + VIN UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development

**Goal:** Add registration document (mulkiyya) upload + HuggingFace OCR scanning to bike and plate listing forms, fix VIN validation feedback text in car forms, and ensure document URLs never leak to public API responses.

**Architecture:** The existing `registration-documents` Storage bucket and `uploadRegistrationDocument` util are reused for bikes (zero new infra); plates get a parallel `registrationDocUrl` state uploaded to the same bucket. A new `/api/ocr/hf-extract` route is appended to the existing `routes/ocr.py` blueprint (one file, no new blueprint). Public field stripping is centralised in `_preview_listing_record` (one function, covers every list endpoint) plus explicit pops in the three detail endpoints for non-owner responses.

**Tech Stack:** Flask blueprint route (HF proxy via `requests`), React state + `uploadRegistrationDocument` util, Supabase `ALTER TABLE` migration, `AdminListingDetail.jsx` JSX additions.

---

## Context: What Already Exists

Before touching any code, understand the existing landscape:

| Capability | PostCar.js | PostBike.js | PostPlate.js |
|---|---|---|---|
| Registration doc upload | **YES** — full flow in `runRegistrationOcr`, state `registrationDocumentUrl` | NO | NO (has `proofDocumentUrl` only) |
| OCR scan button | **YES** — Tesseract via `/api/ocr/scan-registration`, pre-fills VIN | NO | NO |
| VIN field | YES — `formData.vin_number` | YES — `formData.vin_number` | NO |
| DB column | `cars.registration_document_url` (exists) | needs `bikes.registration_doc_url` | needs `license_plates.registration_doc_url` |

Cars backend already accepts `registration_document_url` in create. The car UPDATE endpoint (line 6783) does **not** include it — that is a latent bug fixed in Task 3.

---

## Task 1 — DB Migration: add `registration_doc_url` to bikes and plates

**File to create:** `flask-react-supabase-app/supabase/migrations/20260707000001_registration_doc_url.sql`

```sql
-- Add registration document URL to bikes and license_plates.
-- Cars already have registration_document_url (added by add_registration_document_url.sql).
-- Naming is intentionally kept shorter for new tables; a future cleanup can align them.

ALTER TABLE public.bikes
  ADD COLUMN IF NOT EXISTS registration_doc_url TEXT;

ALTER TABLE public.license_plates
  ADD COLUMN IF NOT EXISTS registration_doc_url TEXT;

-- Never expose these via RLS SELECT to anon/authenticated roles on public endpoints.
-- The backend service role is used for all reads; public-facing serialisers strip the field.
-- No RLS policy change needed — existing service-role bypass covers admin reads.

COMMENT ON COLUMN public.bikes.registration_doc_url
  IS 'Private mulkiyya/ownership document URL for admin review. Deleted after approval.';

COMMENT ON COLUMN public.license_plates.registration_doc_url
  IS 'Private ownership document URL for admin review. Deleted after approval.';
```

**Run in Supabase dashboard:** paste and execute. Verify with:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name IN ('bikes','license_plates') AND column_name = 'registration_doc_url';
```
Expect 2 rows.

**Commit:**
```bash
git add flask-react-supabase-app/supabase/migrations/20260707000001_registration_doc_url.sql
git commit -m "db: add registration_doc_url column to bikes and license_plates"
```

---

## Task 2 — Backend: New `/api/ocr/hf-extract` endpoint

**File to modify:** `flask-react-supabase-app/backend/routes/ocr.py`

This is the only file changed. Append the new route after the existing `scan_registration` route at line 172. The endpoint:
- Accepts JSON `{ "image_b64": "<base64 string>", "filename": "optional" }`
- Proxies to HuggingFace Spaces `akhaliq/unlimited-ocr` Gradio API
- Returns `{ "text": "<raw extracted text>" }` on success
- Auth-required (reuses `@ocr_auth_required`)

**Add to end of `flask-react-supabase-app/backend/routes/ocr.py`:**

```python
import base64
import re as _re


@ocr_bp.route("/hf-extract", methods=["POST"])
@ocr_auth_required
def hf_extract(current_user):
    """Proxy image OCR to HuggingFace akhaliq/unlimited-ocr Spaces API.

    Accepts JSON { image_b64: str, filename?: str }.
    Returns { text: str }.
    The caller is responsible for parsing VIN/plate from the returned text.
    """
    import requests as _req

    data = request.get_json(silent=True) or {}
    image_b64 = data.get("image_b64", "")
    if not image_b64:
        return jsonify({"error": "image_b64 is required"}), 400

    # Strip data-URL prefix if present: "data:image/jpeg;base64,..."
    if "," in image_b64:
        image_b64 = image_b64.split(",", 1)[1]

    # Basic length sanity: reject obviously-too-large payloads (20 MB base64 ≈ 27 MB raw)
    if len(image_b64) > 27 * 1024 * 1024:
        return jsonify({"error": "image_b64 exceeds 20 MB limit"}), 413

    hf_url = "https://akhaliq-unlimited-ocr.hf.space/run/predict"
    try:
        hf_resp = _req.post(
            hf_url,
            json={"data": [f"data:image/jpeg;base64,{image_b64}"]},
            timeout=30,
        )
    except _req.exceptions.Timeout:
        logger.warning("HF OCR timed out for user %s", current_user)
        return jsonify({"error": "OCR service timed out"}), 504
    except Exception as exc:
        logger.exception("HF OCR request failed: %s", exc)
        return jsonify({"error": "OCR service unavailable"}), 502

    if hf_resp.status_code != 200:
        logger.warning(
            "HF OCR returned %s: %s", hf_resp.status_code, hf_resp.text[:200]
        )
        return jsonify({"error": "OCR service error"}), 502

    try:
        payload = hf_resp.json()
        # Gradio /run/predict returns { data: [ <result> ] }
        text = payload.get("data", [None])[0] or ""
    except Exception:
        text = hf_resp.text or ""

    return jsonify({"text": str(text)}), 200
```

**Verify locally:**
```bash
# In backend venv:
python -c "
import json, base64
# A tiny 1x1 white JPEG base64
b64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AJQAB/9k='
print('b64 len:', len(b64))
"
```

**Commit:**
```bash
git add flask-react-supabase-app/backend/routes/ocr.py
git commit -m "feat(ocr): add /api/ocr/hf-extract route proxying to HuggingFace unlimited-ocr"
```

---

## Task 3 — Backend: accept `registration_doc_url` in bike + plate endpoints; fix car update gap

**File to modify:** `flask-react-supabase-app/backend/app.py`

Four whitelist sets need updating. Make each change independently so diffs stay small.

### 3a. Bike CREATE allowed_fields (line ~13642)

In `bike_allowed_fields` at line 13606, add after `"is_archived"`:

```python
            "registration_doc_url",
```

### 3b. Bike UPDATE allowed_fields (line ~13833)

In the second `bike_allowed_fields` at line 13805, add after `"is_dealer"`:

```python
            "registration_doc_url",
```

### 3c. Plate UPDATE allowed_fields (line ~14199)

In `allowed_fields` at line 14199 (update_plate function), add after `"proof_document_url"`:

```python
            "registration_doc_url",
```

### 3d. Plate CREATE — `_create_plate_with_image_impl` (line ~15481)

Find the plate creation function. Locate where `proof_document_url` is extracted from payload (line ~15536). Add alongside it:

```python
        proof_document_url = payload.get("proof_document_url") or None
        registration_doc_url = payload.get("registration_doc_url") or None  # new
```

And where the plate dict is built (line ~15557, after `proof_document_url` conditional):
```python
            **({"proof_document_url": proof_document_url} if proof_document_url else {}),
            **({"registration_doc_url": registration_doc_url} if registration_doc_url else {}),
```

### 3e. Car UPDATE — fix latent bug: `registration_document_url` missing from update whitelist

The car UPDATE `allowed_fields` at line 6783 does **not** include `registration_document_url`, meaning edits to a car cannot update the doc URL. Add it after `"extras"`:

```python
            "registration_document_url",
```

**Commit:**
```bash
git add flask-react-supabase-app/backend/app.py
git commit -m "feat(backend): accept registration_doc_url in bike/plate endpoints; fix car update whitelist"
```

---

## Task 4 — VIN UI text fix (PostCar.js + CreateListing.jsx)

Two files, two lines each.

### 4a. PostCar.js — lines 3132–3137

**File:** `flask-react-supabase-app/frontend/src/components/PostCar.js`

**Old** (line 3133):
```
Invalid VIN — check for typos (common mix-ups: O/0, I/1, Q/0). The 17-character code is on your registration document or driver's side dashboard.
```

**New:**
```
This VIN appears invalid. You can still post your listing.
```

**Old** (line 3137):
```
VIN format looks good.
```

**New:**
```
VIN verified ✓
```

Full replacement block (lines 3131–3138):
```jsx
              {formData.vin_number.length === 17 && !isVinValid(formData.vin_number) && (
                <div className="invalid-feedback">
                  This VIN appears invalid. You can still post your listing.
                </div>
              )}
              {formData.vin_number.length === 17 && isVinValid(formData.vin_number) && (
                <div className="valid-feedback">VIN verified ✓</div>
              )}
```

### 4b. CreateListing.jsx — lines 457–461

**File:** `flask-react-supabase-app/frontend/src/components/CreateListing.jsx`

**Old** (line 458):
```jsx
                <small className="text-danger">Invalid VIN — check for typos (common mix-ups: O/0, I/1, Q/0).</small>
```

**New:**
```jsx
                <small className="text-danger">This VIN appears invalid. You can still post your listing.</small>
```

**Old** (line 461):
```jsx
                <small className="text-success">VIN format looks good.</small>
```

**New:**
```jsx
                <small className="text-success">VIN verified ✓</small>
```

**Commit:**
```bash
git add flask-react-supabase-app/frontend/src/components/PostCar.js \
        flask-react-supabase-app/frontend/src/components/CreateListing.jsx
git commit -m "fix(vin-ui): soften invalid-VIN text; change valid text to 'VIN verified ✓'"
```

---

## Task 5 — PostCar.js: No Document Upload Changes Needed

PostCar.js already has the complete mulkiyya upload and OCR flow:
- `registrationOcrFile` state, `uploadRegistrationDocument` util, `runRegistrationOcr` function
- Uploads to `registration-documents` bucket in parallel with Tesseract OCR
- "Scan document for VIN" button already wired at the existing registration doc input section

**Only change in Task 4** (VIN text). No further PostCar.js modifications.

---

## Task 6 — PostBike.js: Add Mulkiyya Upload + HF OCR "Scan for VIN"

**File to modify:** `flask-react-supabase-app/frontend/src/components/PostBike.js`

### 6a. Add import at top (after line 17, alongside existing directUpload import)

```js
import { LISTING_IMAGE_MAX_BYTES, uploadListingImagesDirect, uploadRegistrationDocument } from '../utils/directUpload';
```

(Replace existing line 17 which only imports `LISTING_IMAGE_MAX_BYTES, uploadListingImagesDirect`.)

### 6b. Add state after existing state declarations (after line ~93, before `formData`)

```js
  const [regDocFile, setRegDocFile] = useState(null);
  const [regDocUrl, setRegDocUrl] = useState('');
  const [uploadingRegDoc, setUploadingRegDoc] = useState(false);
  const [regDocOcrStatus, setRegDocOcrStatus] = useState(''); // '', 'scanning', 'done', 'error'
  const regDocInputRef = useRef(null);
```

### 6c. Add handler functions before `handleSaveDraft` (around line 408)

```js
  const handleRegDocChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRegDocFile(file);
    setRegDocUrl('');
    setRegDocOcrStatus('');
    if (!user?.id) return;
    setUploadingRegDoc(true);
    try {
      const url = await uploadRegistrationDocument(file, { userId: user.id });
      setRegDocUrl(url);
    } catch (err) {
      console.warn('Failed to upload registration doc:', err);
    } finally {
      setUploadingRegDoc(false);
    }
  };

  const runBikeOcr = async () => {
    if (!regDocFile) return;
    setRegDocOcrStatus('scanning');
    try {
      const reader = new FileReader();
      const b64 = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(regDocFile);
      });
      const resp = await apiClient.post('/api/ocr/hf-extract', { image_b64: b64 });
      const text = resp?.text || '';
      // Extract first 17-char uppercase alphanumeric sequence (VIN pattern)
      const vinMatch = text.match(/\b[A-HJ-NPR-Z0-9]{17}\b/);
      if (vinMatch) {
        handleChange({ target: { name: 'vin_number', value: vinMatch[0] } });
        setRegDocOcrStatus('done');
      } else {
        setRegDocOcrStatus('error');
      }
    } catch (err) {
      console.warn('Bike OCR failed:', err);
      setRegDocOcrStatus('error');
    }
  };
```

### 6d. Add `registration_doc_url` to submit payload (inside `handleSubmit`, after existing payload fields ~line 511)

```js
        registration_doc_url: regDocUrl || undefined,
```

### 6e. Add `registration_doc_url` to edit load (inside `fetchListing` useEffect, where `setFormData` is called — around line 149). This field is NOT in formData state (it's separate state), so load it separately:

After the `setFormData((prev) => ({...}))` call in `fetchListing`:
```js
        if (data.registration_doc_url) {
          setRegDocUrl(data.registration_doc_url);
        }
```

### 6f. Add UI section in the form — insert after the VIN field block (after the closing `</div>` of the VIN form-row, around line 841)

Place this immediately after the VIN `</div>` closing tag:

```jsx
                {/* Registration document upload + OCR */}
                <div className="form-row">
                  <div className="form-group full-width">
                    <label>Registration Document (optional)</label>
                    <div className="registration-doc-upload">
                      <input
                        ref={regDocInputRef}
                        type="file"
                        accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
                        className="file-input"
                        onChange={handleRegDocChange}
                        id="bike_registration_doc"
                      />
                      <label htmlFor="bike_registration_doc" className="upload-doc-label">
                        {regDocFile ? regDocFile.name : 'Upload mulkiyya / registration card'}
                      </label>
                      {uploadingRegDoc && <span className="form-text">Uploading…</span>}
                      {regDocUrl && !uploadingRegDoc && (
                        <span className="form-text text-success">Document uploaded.</span>
                      )}
                    </div>
                    {regDocFile && regDocUrl && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm mt-1"
                        onClick={runBikeOcr}
                        disabled={regDocOcrStatus === 'scanning'}
                      >
                        {regDocOcrStatus === 'scanning' ? 'Scanning…' : 'Scan document for VIN'}
                      </button>
                    )}
                    {regDocOcrStatus === 'done' && (
                      <p className="form-text text-success">VIN pre-filled from document.</p>
                    )}
                    {regDocOcrStatus === 'error' && (
                      <p className="form-text text-muted">No VIN found — enter manually above.</p>
                    )}
                    <div className="form-text">
                      Used for admin verification only. Never shown to buyers.
                    </div>
                  </div>
                </div>
```

**Commit:**
```bash
git add flask-react-supabase-app/frontend/src/components/PostBike.js
git commit -m "feat(post-bike): add optional mulkiyya upload + HF OCR scan-for-VIN"
```

---

## Task 7 — PostPlate.js: Add Mulkiyya Upload + HF OCR "Scan for Plate Number"

**Context:** PostPlate.js already has `proofDocumentUrl` / `proofFile` for ownership proof (uploaded to `listing-images` public bucket). The new `registrationDocUrl` is a SEPARATE optional upload to the private `registration-documents` bucket, used for admin OCR of the plate number.

**File to modify:** `flask-react-supabase-app/frontend/src/components/PostPlate.js`

### 7a. Add import at top (line ~14)

```js
import { uploadRegistrationDocument } from '../utils/directUpload';
```

(Add after existing imports.)

### 7b. Add state (after `moderating` state, around line 106)

```js
  const [regDocFile, setRegDocFile] = useState(null);
  const [regDocUrl, setRegDocUrl] = useState('');
  const [uploadingRegDoc, setUploadingRegDoc] = useState(false);
  const [plateOcrStatus, setPlateOcrStatus] = useState(''); // '', 'scanning', 'done', 'error'
  const regDocInputRef = useRef(null);
```

### 7c. Add handler functions (before `handleSaveDraft`, around line 408)

```js
  const handleRegDocChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRegDocFile(file);
    setRegDocUrl('');
    setPlateOcrStatus('');
    if (!user?.id) return;
    setUploadingRegDoc(true);
    try {
      const url = await uploadRegistrationDocument(file, { userId: user.id });
      setRegDocUrl(url);
    } catch (err) {
      console.warn('Failed to upload registration doc:', err);
    } finally {
      setUploadingRegDoc(false);
    }
  };

  const runPlateOcr = async () => {
    if (!regDocFile) return;
    setPlateOcrStatus('scanning');
    try {
      const reader = new FileReader();
      const b64 = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(regDocFile);
      });
      const resp = await apiClient.post('/api/ocr/hf-extract', { image_b64: b64 });
      const text = resp?.text || '';
      // UAE plate numbers: 1–5 digits. Extract first standalone digit sequence (1–5 chars).
      const plateMatch = text.match(/\b(\d{1,5})\b/);
      if (plateMatch) {
        setFormData((prev) => ({ ...prev, number: plateMatch[1] }));
        setPlateOcrStatus('done');
      } else {
        setPlateOcrStatus('error');
      }
    } catch (err) {
      console.warn('Plate OCR failed:', err);
      setPlateOcrStatus('error');
    }
  };
```

### 7d. Add to submit payload (inside `handleSubmit`, after `proofDocumentUrl` spread ~line 476)

```js
        ...(regDocUrl && { registration_doc_url: regDocUrl }),
```

### 7e. Add edit load (in `fetchListing` useEffect, after the data fetch):

```js
        if (data.registration_doc_url) {
          setRegDocUrl(data.registration_doc_url);
        }
```

### 7f. Add UI section — place after the proof-document upload block (after that section's closing `</div>`, around line 1085 — search for "Upload proof of ownership" label)

```jsx
              {/* Optional registration document for plate OCR */}
              <div className="form-group">
                <label>Registration Document for Plate Scan (optional)</label>
                <div className="registration-doc-upload">
                  <input
                    ref={regDocInputRef}
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
                    className="file-input"
                    onChange={handleRegDocChange}
                    id="plate_registration_doc"
                  />
                  <label htmlFor="plate_registration_doc" className="upload-doc-label">
                    {regDocFile ? regDocFile.name : 'Upload vehicle registration (optional)'}
                  </label>
                  {uploadingRegDoc && <span className="form-text">Uploading…</span>}
                  {regDocUrl && !uploadingRegDoc && (
                    <span className="form-text text-success">Document uploaded.</span>
                  )}
                </div>
                {regDocFile && regDocUrl && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm mt-1"
                    onClick={runPlateOcr}
                    disabled={plateOcrStatus === 'scanning'}
                  >
                    {plateOcrStatus === 'scanning' ? 'Scanning…' : 'Scan for plate number'}
                  </button>
                )}
                {plateOcrStatus === 'done' && (
                  <p className="form-text text-success">Plate number pre-filled.</p>
                )}
                {plateOcrStatus === 'error' && (
                  <p className="form-text text-muted">No plate number found — enter manually.</p>
                )}
                <div className="form-text">Admin review only. Never shown to buyers.</div>
              </div>
```

**Commit:**
```bash
git add flask-react-supabase-app/frontend/src/components/PostPlate.js
git commit -m "feat(post-plate): add optional registration doc upload + HF OCR scan-for-plate"
```

---

## Task 8 — Admin Panel: Show `registration_doc_url` for bikes and plates

**File to modify:** `flask-react-supabase-app/frontend/src/components/AdminListingDetail.jsx`

Cars already display `listing.registration_document_url` in the sidebar at lines 649–666. Bikes and plates need the same treatment.

### 8a. Locate the sidebar document block (lines 649–685)

The existing pattern for cars is:
```jsx
{listing.registration_document_url && (
  <div>
    <SectionLabel>Mulkiya (Reg. doc)</SectionLabel>
    <a href={listing.registration_document_url} ...>
      <img src={listing.registration_document_url} ... />
    </a>
  </div>
)}
```

### 8b. Add bike registration_doc_url display

Immediately after the existing `{listing.registration_document_url && ...}` block (after its closing `)}` at line 666), add:

```jsx
              {/* Bike registration document */}
              {listing.registration_doc_url && (
                <div>
                  <SectionLabel>Reg. doc (Bike)</SectionLabel>
                  <a href={listing.registration_doc_url} target="_blank" rel="noopener noreferrer">
                    <img
                      src={listing.registration_doc_url}
                      alt="Bike registration document"
                      className="w-full rounded-xl border border-emerald-500/20 hover:border-emerald-500/40 transition cursor-zoom-in"
                      style={{ maxHeight: '180px', objectFit: 'cover' }}
                      onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; }}
                    />
                  </a>
                  <p className="text-[10px] text-amber-400 mt-1.5">
                    Auto-deleted after approval.
                  </p>
                </div>
              )}
```

### 8c. Add plate registration_doc_url display

After the `{listing.proof_document_url && ...}` block (after line 684), add:

```jsx
              {/* Plate registration document (separate from ownership proof) */}
              {listing.registration_doc_url && (
                <div>
                  <SectionLabel>Reg. doc (Plate)</SectionLabel>
                  <a href={listing.registration_doc_url} target="_blank" rel="noopener noreferrer">
                    <img
                      src={listing.registration_doc_url}
                      alt="Plate registration document"
                      className="w-full rounded-xl border border-blue-500/20 hover:border-blue-500/40 transition cursor-zoom-in"
                      style={{ maxHeight: '180px', objectFit: 'cover' }}
                      onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; }}
                    />
                  </a>
                  <p className="text-[10px] text-amber-400 mt-1.5">
                    Admin-only. Verify before approving.
                  </p>
                </div>
              )}
```

**Note:** Both blocks use the same `listing.registration_doc_url` field name. Since the sidebar renders the same component regardless of listing type, both blocks will safely be `null` when the field is absent — only the matching type will render.

**Commit:**
```bash
git add flask-react-supabase-app/frontend/src/components/AdminListingDetail.jsx
git commit -m "feat(admin): show registration_doc_url for bikes and plates in listing detail sidebar"
```

---

## Task 9 — Strip `registration_doc_url` / `registration_document_url` from ALL public API responses

**File to modify:** `flask-react-supabase-app/backend/app.py`

Two changes needed:

### 9a. Strip in `_preview_listing_record` (covers all list endpoints)

`_preview_listing_record` is at line 1002:

```python
def _preview_listing_record(record):
    if not isinstance(record, dict):
        return None
    preview = dict(record)
    _apply_listing_lifecycle_metadata(preview)
    return preview
```

Change to:

```python
# ponytail: stripped here once — covers every _filter_public_listing_records call site
_PUBLIC_STRIP_FIELDS = frozenset({
    "registration_document_url",
    "registration_doc_url",
    "proof_document_url",
})

def _preview_listing_record(record):
    if not isinstance(record, dict):
        return None
    preview = dict(record)
    _apply_listing_lifecycle_metadata(preview)
    for field in _PUBLIC_STRIP_FIELDS:
        preview.pop(field, None)
    return preview
```

**Important:** `_PUBLIC_STRIP_FIELDS` must be defined BEFORE `_preview_listing_record`. Define it as a module-level constant just above the function at line 1002.

### 9b. Strip in single-detail endpoints for non-owner responses

Three detail endpoints return the raw DB dict. Each needs a pop before jsonify for non-owner viewers.

**`get_car_by_id` (line ~6088):**

The existing code at line 6088 is:
```python
        if cache_key:
            _api_cache_set(cache_key, car)
            return _cached_json_response(car)
        return jsonify(car), 200
```

Replace the final return block with:

```python
        # Strip private document URLs for non-owner public responses.
        # Owner views (is_owner=True) retain the URL so they can review their upload.
        if not is_owner:
            for _f in _PUBLIC_STRIP_FIELDS:
                car.pop(_f, None)
        if cache_key:
            _api_cache_set(cache_key, car)
            return _cached_json_response(car)
        return jsonify(car), 200
```

**`get_bike_by_id` (line ~12495):**

Bikes do not have an `is_owner` check currently (the detail endpoint returns data to anyone for active listings). Add stripping before the cache/jsonify block. Find the return block (search for `_api_cache_set(cache_key, bike)`) and add before it:

```python
        # ponytail: bikes detail is public-only (no owner-view path), safe to always strip
        for _f in _PUBLIC_STRIP_FIELDS:
            bike.pop(_f, None)
```

**`get_plate_details` (line ~14179):**

Find the `_api_cache_set(cache_key, plate)` call and add before it:

```python
        for _f in _PUBLIC_STRIP_FIELDS:
            plate.pop(_f, None)
```

### 9c. Verify Redis cache does not hold stale URLs

The cache is keyed by `request.path`. Since stripping happens BEFORE `_api_cache_set`, newly cached responses will not contain document URLs. Existing cached entries (if any) will expire within the cache TTL (check `_API_CACHE_TTL_SECONDS` in app.py — typically 300s). If immediate fix is needed, flush Redis: `redis-cli FLUSHDB` (dev) or via the Redis provider dashboard (prod).

**Commit:**
```bash
git add flask-react-supabase-app/backend/app.py
git commit -m "security: strip registration_doc_url and proof_document_url from all public API responses"
```

---

## Task 10 — End-to-End Verification + Push

### Manual verification checklist

**VIN text (Task 4):**
1. Open PostCar.js form in browser
2. Type a 17-char invalid VIN (e.g. `1HGCM82633A000000`) → red feedback reads "This VIN appears invalid. You can still post your listing."
3. Type a valid VIN (e.g. `1HGCM82633A004352`) → green feedback reads "VIN verified ✓"
4. Repeat in CreateListing.jsx form

**Bike mulkiyya (Task 6):**
1. Open PostBike form, scroll to VIN section
2. "Registration Document (optional)" upload field is present
3. Upload a JPEG → "Document uploaded." appears
4. "Scan document for VIN" button appears
5. Click → either VIN pre-fills (if found) or "No VIN found" message
6. Submit bike listing → check Supabase `bikes` table row has `registration_doc_url` set

**Plate OCR (Task 7):**
1. Open PostPlate form
2. "Registration Document for Plate Scan (optional)" upload field present
3. Upload doc → "Scan for plate number" button appears
4. Click → plate number pre-fills or "No plate number found"
5. Submit → `license_plates` row has `registration_doc_url`

**Admin panel (Task 8):**
1. Open AdminListingDetail for a bike with `registration_doc_url` set
2. Sidebar shows "Reg. doc (Bike)" thumbnail
3. Repeat for plate listing

**Public API stripping (Task 9):**
```bash
# Hit the public car detail endpoint (unauthenticated)
curl -s "https://<your-domain>/api/cars/<car-id-with-reg-doc>" | python3 -c "import sys,json; d=json.load(sys.stdin); print('LEAK' if 'registration_document_url' in d else 'OK')"
# Expected: OK

# Hit public bike detail
curl -s "https://<your-domain>/api/bikes/<bike-id-with-reg-doc>" | python3 -c "import sys,json; d=json.load(sys.stdin); print('LEAK' if 'registration_doc_url' in d else 'OK')"
# Expected: OK
```

### Push

```bash
git push origin main
```

---

## Implementation Notes

### Naming inconsistency: `registration_document_url` (cars) vs `registration_doc_url` (bikes/plates)
The cars table uses the longer name from a pre-existing migration. Bikes/plates use the shorter name requested in the spec. The admin panel sidebar renders both field names — both will be null-safe. A future cleanup migration can `ALTER TABLE cars RENAME COLUMN registration_document_url TO registration_doc_url` and update the car backend whitelist + PostCar.js state variable names. Intentionally deferred — not worth the scope.

### HF OCR endpoint reliability
The `akhaliq-unlimited-ocr` HuggingFace Space is a community space that may be cold-started (first request takes ~30s) or unavailable. The 30-second timeout in the proxy handles this. The frontend handles the `504`/`502` error with a "No VIN found — enter manually" fallback. No retry logic added — user can click again.

### Why `proof_document_url` is stripped from public responses
Plates already store `proof_document_url`. Including it in `_PUBLIC_STRIP_FIELDS` ensures it never leaks from list/detail endpoints. Admin access uses the service-role path in `AdminListingDetail.jsx` which fetches directly from Supabase via the admin API, bypassing this stripping.

### PostCar.js OCR unchanged
PostCar.js already has a production-grade Tesseract OCR flow that's more accurate than the simple HF regex extraction used for bikes/plates. No changes were made to PostCar.js beyond the VIN text fix. If the HF endpoint is desired as a fallback for cars (e.g. when Tesseract is unavailable), add it inside the `catch` block in `runRegistrationOcr` at line ~682 — out of scope for this plan.
