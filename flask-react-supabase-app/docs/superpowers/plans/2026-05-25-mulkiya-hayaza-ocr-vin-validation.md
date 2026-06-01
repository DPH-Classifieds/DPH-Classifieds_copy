# Mulkiya and Hayaza OCR + VIN Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn registration scanning into a server-side verification pipeline that extracts make, model, year, and VIN from Mulkiya/Hayaza documents, validates the VIN against a decoder, and only auto-fills car forms when the result is trustworthy.

**Architecture:** Add a dedicated Flask OCR blueprint plus a service layer that preprocesses registration images, runs OCR through a provider abstraction, normalizes common registration labels across document variants, and cross-validates VINs through a cached decoder service. Update the mobile and web listing flows to submit registration images to the backend, display confidence and mismatch states, and keep low-confidence scans in review instead of blindly overwriting form fields.

**Tech Stack:** Flask, Pillow, optional OpenCV, OCR engine/provider adapter, Redis/cache helpers already present in the backend, React, React Native, Expo image picker/camera, existing listing forms.

---

### Task 1: Backend registration OCR and VIN validation service

**Files:**
- Create: `../backend/routes/ocr.py`
- Create: `../backend/services/registration_ocr.py`
- Create: `../backend/services/vin_decoder.py`
- Create: `../backend/migrations/add_listing_verification_scans.sql`
- Create: `../backend/testdata/mulkiya-sample.jpg`
- Create: `../backend/testdata/hayaza-sample.jpg`
- Modify: `../backend/app.py:3503-3505,12978-12982` to register the OCR blueprint
- Modify: `../backend/requirements.txt`
- Modify: `../backend/.env.example`
- Modify: `../backend/.env.railway.example`
- Test: `../backend/test_registration_ocr.py`
- Test: `../backend/test_vin_decoder.py`

- [ ] **Step 1: Write the failing tests**

Add one test for the OCR route and one for VIN decoding. The OCR test should prove the endpoint returns a structured result, persists a scan row, and marks low-confidence scans as review-required:

```python
import unittest
from unittest.mock import patch

import app as backend


class RegistrationOcrRouteTests(unittest.TestCase):
    @patch("routes.ocr.extract_registration_fields")
    @patch("routes.ocr.decode_vin")
    @patch("routes.ocr.supabase_request")
    def test_scan_registration_returns_structured_payload(self, mock_supabase_request, mock_decode_vin, mock_extract):
        mock_extract.return_value = {
            "document_type": "mulkiya",
            "raw_text": "TOYOTA CAMRY 2021 VIN JTNB11HK0M1234567",
            "fields": {"make": "Toyota", "model": "Camry", "year": "2021", "vin": "JTNB11HK0M1234567"},
            "confidence": {"make": 0.98, "model": 0.97, "year": 0.99, "vin": 0.99, "overall": 0.98},
            "needs_review": False,
        }
        mock_decode_vin.return_value = {
            "valid": True,
            "vin": "JTNB11HK0M1234567",
            "decoded": {"make": "TOYOTA", "model": "CAMRY", "model_year": 2021},
            "match_score": 1.0,
        }
        mock_supabase_request.return_value = ([], 200)

        with backend.app.test_client() as client:
            response = client.post(
                "/api/ocr/scan-registration",
                data={"image": (open("testdata/mulkiya-sample.jpg", "rb"), "mulkiya-sample.jpg")},
                content_type="multipart/form-data",
            )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertFalse(payload["needs_review"])
        self.assertTrue(payload["vin_validation"]["valid"])
        self.assertEqual(payload["fields"]["make"], "Toyota")
```

Add a VIN decoder test that verifies checksum validation and remote lookup caching:

```python
import unittest
from unittest.mock import patch

from services.vin_decoder import decode_vin


class VinDecoderTests(unittest.TestCase):
    @patch("services.vin_decoder._fetch_vpic_payload")
    def test_decode_vin_caches_and_validates(self, mock_fetch):
        mock_fetch.return_value = {
            "results": [{"Make": "TOYOTA", "Model": "CAMRY", "Model Year": "2021"}]
        }

        first = decode_vin("JTNB11HK0M1234567")
        second = decode_vin("JTNB11HK0M1234567")

        self.assertTrue(first["valid"])
        self.assertEqual(first["decoded"]["make"], "TOYOTA")
        self.assertEqual(second["decoded"]["make"], "TOYOTA")
        self.assertEqual(mock_fetch.call_count, 1)
```

- [ ] **Step 2: Run the tests to confirm they fail for the right reason**

Run:

```bash
cd ../backend
../backend/venv/bin/python -m unittest test_registration_ocr test_vin_decoder -v
```

Expected:
- Fail because `routes.ocr`, `services.registration_ocr`, `services.vin_decoder`, and the `/api/ocr/scan-registration` route do not exist yet.

- [ ] **Step 3: Write the minimal backend implementation**

Create a small service boundary so the route stays thin and the parsing logic is testable:

```python
# backend/services/vin_decoder.py
def decode_vin(vin: str) -> dict:
    vin = normalize_vin(vin)
    if not is_valid_vin(vin):
        return {"valid": False, "vin": vin, "decoded": None, "match_score": 0.0}

    cached = read_cached_vin(vin)
    if cached:
        return cached

    decoded = fetch_vpic_payload(vin)
    result = build_vin_result(vin, decoded)
    write_cached_vin(vin, result)
    return result
```

```python
# backend/services/registration_ocr.py
def extract_registration_fields(file_stream, *, filename=None, document_type_hint=None) -> dict:
    variants = build_document_variants(file_stream, document_type_hint=document_type_hint)
    candidates = [parse_variant(variant) for variant in variants]
    best = select_best_candidate(candidates)
    return normalize_registration_result(best)
```

```python
# backend/routes/ocr.py
@ocr_bp.route("/scan-registration", methods=["POST"])
def scan_registration():
    image = request.files.get("image")
    document_type = (request.form.get("document_type") or "").strip().lower() or None
    if not image:
        return jsonify({"error": "No image provided"}), 400

    scan = extract_registration_fields(image.stream, filename=image.filename, document_type_hint=document_type)
    vin_result = decode_vin(scan["fields"].get("vin") or "")
    response = merge_scan_and_vin(scan, vin_result)
    persist_registration_scan(response)
    return jsonify(response), 200
```

Implement these backend behaviors in the route and service layer:
- Normalize these label variants into the same fields: `make`, `manufacturer`, `brand`; `model`, `type`; `year`, `model year`; `vin`, `chassis`, `frame number`.
- Produce a `confidence` object with per-field scores and an `overall` score.
- Return `needs_review: true` whenever VIN validation fails, the decoder disagrees with OCR make/model/year, or the confidence score is below the acceptance threshold.
- Store a row in `listing_verification_scans` with `listing_type`, `listing_id`, `user_id`, `document_type`, `raw_text`, `fields`, `vin_validation`, `confidence`, `needs_review`, and `created_at`.
- Add `pytesseract` and image-preprocessing dependencies in `requirements.txt` if they are not already available in the deployment environment.
- Add env var examples for `OCR_PROVIDER=local_tesseract`, `OCR_CONFIDENCE_THRESHOLD=0.90`, `OCR_REVIEW_THRESHOLD=0.75`, `VIN_DECODER_BASE_URL=https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvaluesextended`, `VIN_DECODER_CACHE_TTL_SECONDS=86400`, and `TESSERACT_CMD=/usr/bin/tesseract` if the deployment needs an explicit path.

- [ ] **Step 4: Run the backend tests again**

Run:

```bash
cd ../backend
../backend/venv/bin/python -m unittest test_registration_ocr test_vin_decoder -v
../backend/venv/bin/python -m py_compile app.py routes/ocr.py services/registration_ocr.py services/vin_decoder.py
```

Expected:
- Tests pass.
- Python compilation passes.

- [ ] **Step 5: Commit the backend service layer**

```bash
git add backend/app.py backend/routes/ocr.py backend/services/registration_ocr.py backend/services/vin_decoder.py backend/migrations/add_listing_verification_scans.sql backend/requirements.txt backend/.env.example backend/.env.railway.example backend/test_registration_ocr.py backend/test_vin_decoder.py
git commit -m "feat: add registration OCR and VIN validation backend"
```

### Task 2: Mobile and web registration scan integration

**Files:**
- Modify: `../mobile/src/utils/ocrScanner.js`
- Modify: `../mobile/src/screens/listing/PostListingScreen.js:1080-1115,2066-2166`
- Create: `../mobile/src/utils/registrationScan.js`
- Modify: `../frontend/src/components/PostCar.js:350-630,2066-2166`
- Create: `../frontend/src/utils/registrationScan.js`
- Create: `../frontend/scripts/test-registration-scan.mjs`

- [ ] **Step 1: Write the failing normalization test**

Add a tiny shared normalizer so both mobile and web can consume the backend response consistently:

```javascript
// frontend/scripts/test-registration-scan.mjs
import assert from 'node:assert/strict';
import { normalizeRegistrationScanResponse } from '../src/utils/registrationScan.js';

const payload = normalizeRegistrationScanResponse({
  fields: { make: 'Toyota', model: 'Camry', year: '2021', vin: 'JTNB11HK0M1234567' },
  confidence: { overall: 0.98 },
  vin_validation: { valid: true },
  needs_review: false,
});

assert.equal(payload.shouldAutoFill, true);
assert.equal(payload.fields.make, 'Toyota');
assert.equal(payload.fields.vin, 'JTNB11HK0M1234567');
```

- [ ] **Step 2: Run the test to confirm it fails**

Run:

```bash
cd ../frontend
node scripts/test-registration-scan.mjs
```

Expected:
- Fail because `src/utils/registrationScan.js` does not exist yet.

- [ ] **Step 3: Write the minimal shared integration helpers**

Create a single response-shaping helper for both clients:

```javascript
export const normalizeRegistrationScanResponse = (payload) => {
  const fields = payload?.fields || {};
  const vinValidation = payload?.vin_validation || {};
  const confidence = payload?.confidence || {};
  const shouldAutoFill = Boolean(
    !payload?.needs_review
    && vinValidation?.valid
    && Number(confidence?.overall || 0) >= 0.9
  );

  return {
    shouldAutoFill,
    needsReview: Boolean(payload?.needs_review),
    fields,
    vinValidation,
    confidence,
    rawText: payload?.raw_text || '',
    documentType: payload?.document_type || 'unknown',
  };
};
```

Update the mobile scanner so it can use camera capture as the default path:

```javascript
export const scanCarRegistration = async ({ source = 'camera' } = {}) => {
  const picker =
    source === 'camera'
      ? ImagePicker.launchCameraAsync
      : ImagePicker.launchImageLibraryAsync;

  const result = await picker({
    mediaTypes: ['images'],
    quality: 1,
    allowsEditing: true,
    exif: true,
  });

  const formData = new FormData();
  formData.append('image', {
    uri: result.assets[0].uri,
    type: 'image/jpeg',
    name: 'registration.jpg',
  });
  formData.append('document_type', 'mulkiya');

  const headers = { ...(apiClient.getHeaders ? apiClient.getHeaders() : {}) };
  delete headers['Content-Type'];
  delete headers['content-type'];

  const response = await fetch(`${apiClient.baseUrl}/api/ocr/scan-registration`, {
    method: 'POST',
    body: formData,
    headers,
  });
  return normalizeRegistrationScanResponse(await response.json());
};
```

Update the web post form so it no longer treats local Tesseract output as the only source of truth:

```javascript
const scan = normalizeRegistrationScanResponse(await apiClient.request('/api/ocr/scan-registration', {
  method: 'POST',
  body: formData,
}));

if (scan.shouldAutoFill) {
  setFormData((prev) => ({
    ...prev,
    car_manufacturer: scan.fields.make || prev.car_manufacturer,
    car_model: scan.fields.model || prev.car_model,
    make_year: scan.fields.year || prev.make_year,
    vin_number: scan.fields.vin || prev.vin_number,
  }));
} else {
  setRegistrationNotice('Scan needs review because VIN or field confidence is too low.');
}
```

In both clients:
- Prefer camera capture over gallery upload for scanning the document.
- Show the extracted fields, confidence score, and VIN validation result before applying values.
- Do not overwrite form fields automatically when `needsReview` is true.
- Keep the existing manual override path so users can correct mistakes without re-scanning.
- Keep the local preprocessing UI only as a fallback if the backend scan is unavailable.
- Do not set the `Content-Type: multipart/form-data` header manually on `FormData` uploads; attach only the auth headers and let the runtime set the boundary.

- [ ] **Step 4: Run the client checks again**

Run:

```bash
cd ../mobile
node --check src/utils/ocrScanner.js
node --check src/screens/listing/PostListingScreen.js
node --check src/utils/registrationScan.js
cd ../frontend
node --check src/components/PostCar.js
node --check src/utils/registrationScan.js
node scripts/test-registration-scan.mjs
```

Expected:
- Parse checks pass.
- The shared normalization script passes.

- [ ] **Step 5: Commit the client integration**

```bash
git add mobile/src/utils/ocrScanner.js mobile/src/screens/listing/PostListingScreen.js mobile/src/utils/registrationScan.js frontend/src/components/PostCar.js frontend/src/utils/registrationScan.js frontend/scripts/test-registration-scan.mjs
git commit -m "feat: wire registration scan clients to backend verification"
```

### Task 3: Admin review, verification visibility, and rollout hardening

**Files:**
- Modify: `../backend/app.py` to include scan verification data in listing detail/admin responses
- Modify: `../frontend/src/components/AdminListingDetail.jsx`
- Modify: `../frontend/src/components/AdminListings.js`
- Modify: `../frontend/src/components/AdminDashboard.js` if you want a KPI for rejected scans
- Modify: `../mobile/src/screens/admin/AdminListingDetailScreen.js` if you want the same visibility in the mobile admin app
- Test: `../backend/test_registration_ocr.py`

- [ ] **Step 1: Write the failing admin visibility test**

Add a backend test that proves the latest scan record is attached to the listing detail payload and that mismatches are surfaced:

```python
class RegistrationScanAdminTests(unittest.TestCase):
    @patch.object(backend, "supabase_request")
    def test_admin_listing_detail_includes_verification_scan(self, mock_supabase_request):
        mock_supabase_request.side_effect = [
            ([{"id": "car-1", "vin_number": "JTNB11HK0M1234567"}], 200),
            ([{
                "id": "scan-1",
                "fields": {"make": "Toyota", "model": "Camry", "year": "2021", "vin": "JTNB11HK0M1234567"},
                "vin_validation": {"valid": True},
                "confidence": {"overall": 0.98},
                "needs_review": False,
            }], 200),
        ]

        with backend.app.test_request_context("/api/admin/listings/cars/car-1"):
            response = backend.get_car_details("car-1")

        payload = response.get_json()
        self.assertIn("latest_verification_scan", payload)
        self.assertFalse(payload["latest_verification_scan"]["needs_review"])
```

- [ ] **Step 2: Run the test to confirm it fails**

Run:

```bash
cd ../backend
../backend/venv/bin/python -m unittest test_registration_ocr -v
```

Expected:
- Fail because the admin/detail response does not yet surface verification scan metadata.

- [ ] **Step 3: Add the verification state to admin and detail surfaces**

In the backend, include the latest scan object in the listing detail payload:

```python
listing["latest_verification_scan"] = latest_scan
listing["verification_status"] = {
    "needs_review": latest_scan.get("needs_review", False),
    "vin_valid": latest_scan.get("vin_validation", {}).get("valid", False),
    "confidence": latest_scan.get("confidence", {}).get("overall", 0),
}
```

In the admin detail page:

```jsx
<InfoRow label="OCR confidence" value={`${Math.round((listing.verification_status?.confidence || 0) * 100)}%`} />
<InfoRow label="VIN valid" value={listing.verification_status?.vin_valid ? 'Yes' : 'No'} />
<InfoRow label="Needs review" value={listing.verification_status?.needs_review ? 'Yes' : 'No'} />
<pre className="scan-raw-text">{listing.latest_verification_scan?.raw_text || 'No scan captured'}</pre>
```

In the admin listings table and card detail view:
- Add a badge for `Scan verified`, `Review required`, or `VIN mismatch`.
- Surface the extracted VIN, make, model, and year next to the listing VIN so moderators can spot conflicts quickly.
- Add a `Retry scan` or `Re-evaluate` action if you want to re-run the backend normalization against the stored image.

In the mobile admin detail screen, mirror the same fields if that app is part of the admin workflow.

Hardening rules:
- If VIN decoder and OCR disagree on make/model/year, do not show a green verified state.
- If the scan was below threshold but the user manually proceeds, keep the listing in a review-needed state.
- Cache decoder results by VIN so repeated scans do not keep hitting the external decoder service.
- Keep the stored raw scan payload so support can audit why a listing auto-filled or was blocked.

- [ ] **Step 4: Run the verification checks again**

Run:

```bash
cd ../backend
../backend/venv/bin/python -m unittest test_registration_ocr test_vin_decoder -v
cd ../frontend
node --check src/components/AdminListingDetail.jsx
node --check src/components/AdminListings.js
node --check src/components/PostCar.js
cd ../mobile
node --check src/screens/admin/AdminListingDetailScreen.js
```

Expected:
- Backend tests pass.
- All updated UI files parse cleanly.

- [ ] **Step 5: Commit the admin visibility and rollout hardening**

```bash
git add backend/app.py backend/test_registration_ocr.py frontend/src/components/AdminListingDetail.jsx frontend/src/components/AdminListings.js frontend/src/components/AdminDashboard.js mobile/src/screens/admin/AdminListingDetailScreen.js
git commit -m "feat: surface registration verification in admin review"
```

---

### Coverage Check

- Mulkiya/Hayaza OCR accuracy improvements: Task 1, Task 2
- Server-side OCR route and parsing: Task 1
- VIN decoding and checksum validation: Task 1
- Confidence gating and review fallback: Task 1, Task 2
- Mobile scan capture flow: Task 2
- Web post flow integration: Task 2
- Admin verification visibility: Task 3
- Audit trail and stored scan metadata: Task 1, Task 3

### Notes for Implementation

- Keep the OCR route thin. All parsing, normalization, and scoring logic should live in service files so the route remains easy to test.
- Do not auto-fill form fields unless VIN validation passes and overall confidence clears the threshold.
- Favor explicit review states over silent failure. If the pipeline is uncertain, show the uncertainty instead of guessing.
- Use the VIN decoder as the integrity anchor. OCR can help fill fields, but the VIN should decide whether the data is internally consistent.
