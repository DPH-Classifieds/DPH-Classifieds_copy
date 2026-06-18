# Auto-Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace manual admin approval for cars/bikes/parts/plates with a deterministic rule engine + worker that auto-approves clean listings and routes the rest to the existing human queue with labeled reasons.

**Architecture:** Pure-logic rule engine (`services/auto_review/`) with all I/O injected (supabase, vision, VIN decoder). A new worker (`workers/auto_review_worker.py`) is the only glue code that touches I/O. The admin's manual approval path is refactored into a shared `_perform_approval()` helper so worker and admin call the same code (and the same Redis-cache + lifecycle side effects). Vision is behind a `VisionProvider` protocol with a `NullVisionProvider` default so dev/tests run with zero external credentials — and `available=False` is a hard "needs human" signal.

**Tech Stack:** Python 3.11, Flask, Supabase Postgres REST, Redis (existing helpers), `unittest` (existing repo convention), `pytesseract`+`pypdfium2` (existing), Google Vision REST (optional, opt-in).

**Spec:** `docs/superpowers/specs/2026-06-18-auto-approval-design.md`

---

## Phase 1 — Pure logic foundation

### Task 1: Decision/Signals dataclasses

**Files:**
- Create: `flask-react-supabase-app/backend/services/auto_review/__init__.py`
- Create: `flask-react-supabase-app/backend/services/auto_review/decision.py`
- Create: `flask-react-supabase-app/backend/test_auto_review_decision.py`

- [ ] **Step 1: Failing test for Decision construction**

```python
import unittest
from services.auto_review.decision import Decision, FailReason

class DecisionTests(unittest.TestCase):
    def test_pass_decision_has_no_reasons(self):
        d = Decision.approve(tier_matched="dealer_verified")
        self.assertTrue(d.approved)
        self.assertEqual(d.reasons, [])
        self.assertEqual(d.tier_matched, "dealer_verified")

    def test_queued_decision_carries_reasons(self):
        d = Decision.queue([FailReason("vin_year_mismatch", {"form": 2024, "decoded": 2020})])
        self.assertFalse(d.approved)
        self.assertEqual(d.reasons[0].label, "vin_year_mismatch")
        self.assertEqual(d.as_label_list(), ["vin_year_mismatch"])

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test, confirm FAIL**

`cd flask-react-supabase-app/backend && python -m unittest test_auto_review_decision -v`
Expected: `ModuleNotFoundError: No module named 'services.auto_review'`.

- [ ] **Step 3: Write decision.py**

```python
# services/auto_review/decision.py
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any

@dataclass(frozen=True)
class FailReason:
    label: str
    details: dict[str, Any] = field(default_factory=dict)

@dataclass(frozen=True)
class Decision:
    approved: bool
    reasons: list[FailReason] = field(default_factory=list)
    tier_matched: str | None = None
    signals: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def approve(cls, *, tier_matched: str, signals: dict | None = None) -> "Decision":
        return cls(approved=True, reasons=[], tier_matched=tier_matched, signals=signals or {})

    @classmethod
    def queue(cls, reasons: list[FailReason], *, signals: dict | None = None) -> "Decision":
        return cls(approved=False, reasons=list(reasons), tier_matched=None, signals=signals or {})

    def as_label_list(self) -> list[str]:
        return [r.label for r in self.reasons]
```

Also create empty `services/auto_review/__init__.py`.

- [ ] **Step 4: Run tests, confirm PASS**

`python -m unittest test_auto_review_decision -v` → PASS.

- [ ] **Step 5: Commit**

```bash
git add flask-react-supabase-app/backend/services/auto_review/__init__.py \
        flask-react-supabase-app/backend/services/auto_review/decision.py \
        flask-react-supabase-app/backend/test_auto_review_decision.py
git commit -m "feat(auto-review): Decision/FailReason dataclasses"
```

---

### Task 2: VisionProvider protocol + NullVisionProvider

**Files:**
- Create: `flask-react-supabase-app/backend/services/auto_review/vision.py`
- Create: `flask-react-supabase-app/backend/test_auto_review_vision.py`

- [ ] **Step 1: Failing tests**

```python
import unittest
from services.auto_review.vision import (
    VisionResult,
    NullVisionProvider,
    select_vision_provider,
)

class NullVisionProviderTests(unittest.TestCase):
    def test_analyze_returns_unavailable_result(self):
        provider = NullVisionProvider()
        result = provider.analyze(b"\x89PNG_fake_bytes")
        self.assertFalse(result.available)
        self.assertEqual(result.face_count, 0)
        self.assertFalse(result.nsfw_likely)
        self.assertFalse(result.contains_vehicle)
        self.assertEqual(result.contact_text, [])

    def test_select_provider_defaults_to_null(self):
        provider = select_vision_provider(env={"AUTO_REVIEW_VISION_PROVIDER": ""})
        self.assertIsInstance(provider, NullVisionProvider)

    def test_select_provider_explicit_null(self):
        provider = select_vision_provider(env={"AUTO_REVIEW_VISION_PROVIDER": "null"})
        self.assertIsInstance(provider, NullVisionProvider)

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Confirm FAIL**

`python -m unittest test_auto_review_vision -v` → `ModuleNotFoundError`.

- [ ] **Step 3: Implement vision.py**

```python
# services/auto_review/vision.py
from __future__ import annotations
import os
from dataclasses import dataclass, field
from typing import Protocol

@dataclass(frozen=True)
class VisionResult:
    available: bool
    nsfw_likely: bool = False
    face_count: int = 0
    contains_vehicle: bool = False
    contact_text: list[str] = field(default_factory=list)

class VisionProvider(Protocol):
    def analyze(self, image_bytes: bytes) -> VisionResult: ...

class NullVisionProvider:
    def analyze(self, image_bytes: bytes) -> VisionResult:
        return VisionResult(available=False)

class GoogleVisionProvider:
    """Stub. Real impl posts to Vision API with FACE_DETECTION + SAFE_SEARCH_DETECTION
    + OBJECT_LOCALIZATION + TEXT_DETECTION features, then maps response to VisionResult."""
    def __init__(self, api_key: str):
        if not api_key:
            raise ValueError("GoogleVisionProvider requires api_key")
        self._api_key = api_key

    def analyze(self, image_bytes: bytes) -> VisionResult:
        raise NotImplementedError("GoogleVisionProvider HTTP call not yet wired")

def select_vision_provider(env: dict | None = None) -> VisionProvider:
    env = env if env is not None else os.environ
    name = (env.get("AUTO_REVIEW_VISION_PROVIDER") or "null").strip().lower()
    if name in ("", "null", "none"):
        return NullVisionProvider()
    if name == "google":
        return GoogleVisionProvider(api_key=env.get("GOOGLE_VISION_API_KEY", ""))
    raise ValueError(f"Unknown AUTO_REVIEW_VISION_PROVIDER: {name}")
```

- [ ] **Step 4: PASS**

`python -m unittest test_auto_review_vision -v` → PASS.

- [ ] **Step 5: Commit**

```bash
git add flask-react-supabase-app/backend/services/auto_review/vision.py \
        flask-react-supabase-app/backend/test_auto_review_vision.py
git commit -m "feat(auto-review): vision provider protocol + null implementation"
```

---

### Task 3: Sync gate — required-field validation per listing type

**Files:**
- Create: `flask-react-supabase-app/backend/services/auto_review/sync_gate.py`
- Create: `flask-react-supabase-app/backend/test_auto_review_sync_gate.py`

- [ ] **Step 1: Failing tests (one per listing type, plus image-count edge)**

```python
import unittest
from services.auto_review.sync_gate import (
    validate_required_fields,
    SyncGateResult,
)

MIN_YEAR = 1990

VALID_CAR = {
    "make": "Toyota", "model": "Camry", "make_year": 2020,
    "kilometer_driven": 80000, "expected_selling_price": 35000,
    "vin": "1HGBH41JXMN109186", "transmission_type": "Automatic",
    "fuel_type": "Petrol", "regional_spec": "GCC", "body_type": "Sedan",
    "color": "White", "car_city": "Dubai",
    "car_owner_phone_number": "+971501234567",
    "whatsapp_number": "+971501234567",
    "whatsapp_prefill_text": "Hi, interested in your Camry",
    "car_description": "Well maintained family car. Single owner. Service history.",
}

class CarSyncGateTests(unittest.TestCase):
    def test_valid_car_passes(self):
        result = validate_required_fields(
            "car", VALID_CAR, photo_count=5, min_year=MIN_YEAR, max_year=2027,
        )
        self.assertTrue(result.ok, msg=result.missing)

    def test_missing_vin_fails(self):
        listing = {**VALID_CAR}
        listing.pop("vin")
        result = validate_required_fields("car", listing, photo_count=5,
                                          min_year=MIN_YEAR, max_year=2027)
        self.assertFalse(result.ok)
        self.assertIn("vin", result.missing)

    def test_short_vin_fails(self):
        listing = {**VALID_CAR, "vin": "TOO_SHORT"}
        result = validate_required_fields("car", listing, photo_count=5,
                                          min_year=MIN_YEAR, max_year=2027)
        self.assertFalse(result.ok)
        self.assertIn("vin", result.missing)

    def test_too_few_photos_fails(self):
        result = validate_required_fields("car", VALID_CAR, photo_count=3,
                                          min_year=MIN_YEAR, max_year=2027)
        self.assertFalse(result.ok)
        self.assertIn("photos", result.missing)

    def test_bad_transmission_fails(self):
        listing = {**VALID_CAR, "transmission_type": "CVT"}
        result = validate_required_fields("car", listing, photo_count=5,
                                          min_year=MIN_YEAR, max_year=2027)
        self.assertFalse(result.ok)
        self.assertIn("transmission_type", result.missing)

class PartSyncGateTests(unittest.TestCase):
    def test_valid_part_passes(self):
        listing = {
            "name": "Brake pads", "part_type": "Brakes", "price": 200,
            "condition": "New", "area": "Sharjah",
            "contact_number": "+971501234567",
            "description": "OEM brake pads, brand new in box.",
        }
        result = validate_required_fields("part", listing, photo_count=2,
                                          min_year=MIN_YEAR, max_year=2027)
        self.assertTrue(result.ok, msg=result.missing)

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Confirm FAIL**

`python -m unittest test_auto_review_sync_gate -v` → `ModuleNotFoundError`.

- [ ] **Step 3: Implement sync_gate.py**

```python
# services/auto_review/sync_gate.py
from __future__ import annotations
import re
from dataclasses import dataclass, field

VIN_RE = re.compile(r"^[A-HJ-NPR-Z0-9]{17}$")
CAR_TRANSMISSIONS = {"Automatic", "Manual"}
CAR_FUEL_TYPES = {"Petrol", "Diesel", "Hybrid", "Electric"}
PART_CONDITIONS = {"New", "Used"}

PHOTO_MIN = {"car": 4, "bike": 3, "part": 2, "plate": 1}

@dataclass(frozen=True)
class SyncGateResult:
    ok: bool
    missing: list[str] = field(default_factory=list)

def _non_empty(value) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return value.strip() != ""
    return True

def _int_in_range(value, lo: int | None = None, hi: int | None = None) -> bool:
    try:
        v = int(value)
    except (TypeError, ValueError):
        return False
    if lo is not None and v < lo:
        return False
    if hi is not None and v > hi:
        return False
    return True

def _check_text_required(listing, field: str, missing: list[str]) -> None:
    if not _non_empty(listing.get(field)):
        missing.append(field)

def _validate_car(listing, photo_count, min_year, max_year, missing):
    for f in ("make", "model", "body_type", "color", "regional_spec",
              "car_owner_phone_number", "whatsapp_number",
              "whatsapp_prefill_text", "car_description"):
        _check_text_required(listing, f, missing)
    if not (_non_empty(listing.get("car_city")) or _non_empty(listing.get("area"))):
        missing.append("car_city")
    if not _int_in_range(listing.get("make_year"), min_year, max_year):
        missing.append("make_year")
    if not _int_in_range(listing.get("kilometer_driven"), 0):
        missing.append("kilometer_driven")
    if not _int_in_range(listing.get("expected_selling_price"), 0):
        missing.append("expected_selling_price")
    vin = (listing.get("vin") or "").strip().upper()
    if not VIN_RE.match(vin):
        missing.append("vin")
    if listing.get("transmission_type") not in CAR_TRANSMISSIONS:
        missing.append("transmission_type")
    if listing.get("fuel_type") not in CAR_FUEL_TYPES:
        missing.append("fuel_type")
    if photo_count < PHOTO_MIN["car"]:
        missing.append("photos")

def _validate_bike(listing, photo_count, min_year, max_year, missing):
    for f in ("bike_brand", "bike_model", "area", "contact_number",
              "whatsapp_number", "whatsapp_prefill_text", "description"):
        _check_text_required(listing, f, missing)
    if not _int_in_range(listing.get("make_year"), min_year, max_year):
        missing.append("make_year")
    if not _int_in_range(listing.get("kilometer_driven"), 0):
        missing.append("kilometer_driven")
    if not _int_in_range(listing.get("price"), 0):
        missing.append("price")
    if not _int_in_range(listing.get("engine_size"), 1):
        missing.append("engine_size")
    vin = (listing.get("vin") or "").strip().upper()
    if not VIN_RE.match(vin):
        missing.append("vin")
    if photo_count < PHOTO_MIN["bike"]:
        missing.append("photos")

def _validate_part(listing, photo_count, missing):
    for f in ("name", "part_type", "area", "contact_number", "description"):
        _check_text_required(listing, f, missing)
    if not _int_in_range(listing.get("price"), 0):
        missing.append("price")
    if listing.get("condition") not in PART_CONDITIONS:
        missing.append("condition")
    if photo_count < PHOTO_MIN["part"]:
        missing.append("photos")

def _validate_plate(listing, photo_count, missing):
    for f in ("city", "code", "contact_phone", "whatsapp_number", "description"):
        _check_text_required(listing, f, missing)
    if not _int_in_range(listing.get("digits"), 1, 5):
        missing.append("digits")
    if not _int_in_range(listing.get("price"), 0):
        missing.append("price")
    if photo_count < PHOTO_MIN["plate"]:
        missing.append("photos")

def validate_required_fields(
    listing_type: str,
    listing: dict,
    *,
    photo_count: int,
    min_year: int,
    max_year: int,
) -> SyncGateResult:
    missing: list[str] = []
    t = (listing_type or "").lower()
    if t == "car":
        _validate_car(listing, photo_count, min_year, max_year, missing)
    elif t == "bike":
        _validate_bike(listing, photo_count, min_year, max_year, missing)
    elif t == "part":
        _validate_part(listing, photo_count, missing)
    elif t == "plate":
        _validate_plate(listing, photo_count, missing)
    else:
        return SyncGateResult(ok=False, missing=["unsupported_listing_type"])
    return SyncGateResult(ok=not missing, missing=missing)
```

- [ ] **Step 4: PASS**

`python -m unittest test_auto_review_sync_gate -v` → all pass.

- [ ] **Step 5: Commit**

```bash
git add flask-react-supabase-app/backend/services/auto_review/sync_gate.py \
        flask-react-supabase-app/backend/test_auto_review_sync_gate.py
git commit -m "feat(auto-review): sync gate required-field validation"
```

---

### Task 4: Trust tier evaluator

**Files:**
- Create: `flask-react-supabase-app/backend/services/auto_review/trust.py`
- Create: `flask-react-supabase-app/backend/test_auto_review_trust.py`

- [ ] **Step 1: Failing tests**

```python
import unittest
from services.auto_review.trust import evaluate_trust, TrustContext

class TrustTests(unittest.TestCase):
    def test_admin_matches_tier_a(self):
        ctx = TrustContext(is_admin=True, dealer_verified=False,
                           approved_listings_count=0, rejections_last_90d=0,
                           reports_last_90d=0, email_verified=False)
        result = evaluate_trust(ctx)
        self.assertTrue(result.matched)
        self.assertEqual(result.tier, "admin")

    def test_verified_dealer_matches_tier_b(self):
        ctx = TrustContext(is_admin=False, dealer_verified=True,
                           approved_listings_count=0, rejections_last_90d=0,
                           reports_last_90d=0, email_verified=False)
        result = evaluate_trust(ctx)
        self.assertTrue(result.matched)
        self.assertEqual(result.tier, "dealer_verified")

    def test_clean_individual_matches_tier_c(self):
        ctx = TrustContext(is_admin=False, dealer_verified=False,
                           approved_listings_count=5, rejections_last_90d=0,
                           reports_last_90d=0, email_verified=True)
        result = evaluate_trust(ctx)
        self.assertTrue(result.matched)
        # Tier C wins over D when both apply (higher trust)
        self.assertEqual(result.tier, "clean_individual")

    def test_email_only_matches_tier_d(self):
        ctx = TrustContext(is_admin=False, dealer_verified=False,
                           approved_listings_count=0, rejections_last_90d=0,
                           reports_last_90d=0, email_verified=True)
        result = evaluate_trust(ctx)
        self.assertTrue(result.matched)
        self.assertEqual(result.tier, "email_verified")

    def test_unverified_no_match(self):
        ctx = TrustContext(is_admin=False, dealer_verified=False,
                           approved_listings_count=0, rejections_last_90d=0,
                           reports_last_90d=0, email_verified=False)
        result = evaluate_trust(ctx)
        self.assertFalse(result.matched)
        self.assertIsNone(result.tier)

    def test_individual_with_recent_rejection_blocks_tier_c(self):
        ctx = TrustContext(is_admin=False, dealer_verified=False,
                           approved_listings_count=5, rejections_last_90d=1,
                           reports_last_90d=0, email_verified=True)
        result = evaluate_trust(ctx)
        # Falls back to tier D
        self.assertEqual(result.tier, "email_verified")

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Confirm FAIL**

- [ ] **Step 3: Implement trust.py**

```python
# services/auto_review/trust.py
from __future__ import annotations
from dataclasses import dataclass

@dataclass(frozen=True)
class TrustContext:
    is_admin: bool
    dealer_verified: bool
    approved_listings_count: int
    rejections_last_90d: int
    reports_last_90d: int
    email_verified: bool

@dataclass(frozen=True)
class TrustResult:
    matched: bool
    tier: str | None

def evaluate_trust(ctx: TrustContext) -> TrustResult:
    if ctx.is_admin:
        return TrustResult(True, "admin")
    if ctx.dealer_verified:
        return TrustResult(True, "dealer_verified")
    if (ctx.approved_listings_count >= 3
            and ctx.rejections_last_90d == 0
            and ctx.reports_last_90d == 0):
        return TrustResult(True, "clean_individual")
    if ctx.email_verified:
        return TrustResult(True, "email_verified")
    return TrustResult(False, None)
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
git add flask-react-supabase-app/backend/services/auto_review/trust.py \
        flask-react-supabase-app/backend/test_auto_review_trust.py
git commit -m "feat(auto-review): seller trust tier evaluator"
```

---

### Task 5: VIN gate

**Files:**
- Create: `flask-react-supabase-app/backend/services/auto_review/vin_gate.py`
- Create: `flask-react-supabase-app/backend/test_auto_review_vin_gate.py`

- [ ] **Step 1: Failing tests**

```python
import unittest
from services.auto_review.vin_gate import evaluate_vin

GOOD = "1HGBH41JXMN109186"  # valid check digit

class FakeDecoder:
    def __init__(self, payload):
        self.payload = payload
    def is_checksum_valid(self, vin):
        return len(vin) == 17 and vin == GOOD
    @staticmethod
    def is_checksum_valid_static(vin):
        return len(vin) == 17 and vin == GOOD
    def validate_and_decode(self, vin):
        return self.payload

class VinGateTests(unittest.TestCase):
    def test_happy_path(self):
        decoder = FakeDecoder({"decoded": {"make": "Honda", "model": "Accord", "model_year": 1991}})
        r = evaluate_vin(GOOD, form_make="Honda", form_model="Accord", form_year=1991, decoder=decoder)
        self.assertTrue(r.ok, msg=r.reasons)

    def test_bad_format(self):
        decoder = FakeDecoder({"decoded": {}})
        r = evaluate_vin("not_a_vin", form_make="Honda", form_model="Accord", form_year=1991, decoder=decoder)
        self.assertFalse(r.ok)
        self.assertIn("vin_format_invalid", [x.label for x in r.reasons])

    def test_make_mismatch(self):
        decoder = FakeDecoder({"decoded": {"make": "Toyota", "model": "Accord", "model_year": 1991}})
        r = evaluate_vin(GOOD, form_make="Honda", form_model="Accord", form_year=1991, decoder=decoder)
        self.assertFalse(r.ok)
        self.assertIn("vin_make_mismatch", [x.label for x in r.reasons])

    def test_year_within_tolerance(self):
        decoder = FakeDecoder({"decoded": {"make": "Honda", "model": "Accord", "model_year": 1990}})
        r = evaluate_vin(GOOD, form_make="Honda", form_model="Accord", form_year=1991, decoder=decoder)
        self.assertTrue(r.ok)

    def test_year_outside_tolerance(self):
        decoder = FakeDecoder({"decoded": {"make": "Honda", "model": "Accord", "model_year": 1988}})
        r = evaluate_vin(GOOD, form_make="Honda", form_model="Accord", form_year=1991, decoder=decoder)
        self.assertFalse(r.ok)
        self.assertIn("vin_year_mismatch", [x.label for x in r.reasons])

    def test_decoder_unavailable(self):
        decoder = FakeDecoder({"decoded": {}})
        r = evaluate_vin(GOOD, form_make="Honda", form_model="Accord", form_year=1991, decoder=decoder)
        self.assertFalse(r.ok)
        self.assertIn("vin_decoder_unavailable", [x.label for x in r.reasons])

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Confirm FAIL**

- [ ] **Step 3: Implement vin_gate.py**

```python
# services/auto_review/vin_gate.py
from __future__ import annotations
import re
from dataclasses import dataclass
from .decision import FailReason

VIN_ALLOWED = re.compile(r"^[A-HJ-NPR-Z0-9]{17}$")

@dataclass(frozen=True)
class VinGateResult:
    ok: bool
    reasons: list[FailReason]
    decoded: dict

def _norm(s):
    return re.sub(r"[^a-z0-9]", "", str(s or "").lower())

def evaluate_vin(vin: str, *, form_make: str, form_model: str,
                 form_year: int, decoder) -> VinGateResult:
    reasons: list[FailReason] = []
    vin_clean = (vin or "").strip().upper()
    if not VIN_ALLOWED.match(vin_clean):
        return VinGateResult(False, [FailReason("vin_format_invalid", {"vin": vin_clean})], {})

    # Decoder API: some implementations expose is_checksum_valid as classmethod.
    checksum_valid = False
    try:
        checksum_valid = decoder.is_checksum_valid(vin_clean)
    except TypeError:
        # Was a staticmethod; called without self.
        checksum_valid = type(decoder).is_checksum_valid(vin_clean)
    if not checksum_valid:
        reasons.append(FailReason("vin_checksum_invalid", {"vin": vin_clean}))

    decode_result = decoder.validate_and_decode(vin_clean) or {}
    decoded = decode_result.get("decoded") or {}
    if not decoded:
        reasons.append(FailReason("vin_decoder_unavailable", {"vin": vin_clean}))
        return VinGateResult(False, reasons, decoded)

    d_make = _norm(decoded.get("make"))
    f_make = _norm(form_make)
    if d_make and f_make and (d_make not in f_make and f_make not in d_make):
        reasons.append(FailReason("vin_make_mismatch",
                                  {"form": form_make, "decoded": decoded.get("make")}))

    d_model = _norm(decoded.get("model"))
    f_model = _norm(form_model)
    if d_model and f_model and (d_model not in f_model and f_model not in d_model):
        reasons.append(FailReason("vin_model_mismatch",
                                  {"form": form_model, "decoded": decoded.get("model")}))

    try:
        d_year = int(decoded.get("model_year") or decoded.get("year") or 0)
        f_year = int(form_year or 0)
        if d_year and f_year and abs(d_year - f_year) > 1:
            reasons.append(FailReason("vin_year_mismatch",
                                      {"form": f_year, "decoded": d_year}))
    except (TypeError, ValueError):
        reasons.append(FailReason("vin_year_mismatch",
                                  {"form": form_year, "decoded": decoded.get("model_year")}))

    return VinGateResult(ok=not reasons, reasons=reasons, decoded=decoded)
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
git add flask-react-supabase-app/backend/services/auto_review/vin_gate.py \
        flask-react-supabase-app/backend/test_auto_review_vin_gate.py
git commit -m "feat(auto-review): VIN gate (format, checksum, decoder agreement)"
```

---

### Task 6: Hard-blocker checks (profanity / contact-in-image / NSFW / faces)

**Files:**
- Create: `flask-react-supabase-app/backend/services/auto_review/hard_blockers.py`
- Create: `flask-react-supabase-app/backend/test_auto_review_hard_blockers.py`

- [ ] **Step 1: Failing tests** — cover one positive case per fail label.

```python
import unittest
from services.auto_review.vision import VisionResult
from services.auto_review.hard_blockers import (
    evaluate_image_blockers, evaluate_profanity, ImageAnalysis,
)
from services.auto_review.decision import FailReason

class FakeProvider:
    def __init__(self, results):
        self._results = list(results)
    def analyze(self, b):
        return self._results.pop(0)

class HardBlockerTests(unittest.TestCase):
    def test_clean_passes(self):
        clean = VisionResult(available=True)
        an = evaluate_image_blockers([b"img1", b"img2"], FakeProvider([clean, clean]),
                                      face_confidence_threshold=0.6)
        self.assertTrue(an.ok, msg=an.reasons)

    def test_unavailable_provider_is_soft_fail(self):
        unavail = VisionResult(available=False)
        an = evaluate_image_blockers([b"img1"], FakeProvider([unavail]),
                                      face_confidence_threshold=0.6)
        self.assertFalse(an.ok)
        self.assertIn("vision_unavailable", [r.label for r in an.reasons])

    def test_face_blocks(self):
        with_face = VisionResult(available=True, face_count=1)
        clean = VisionResult(available=True)
        an = evaluate_image_blockers([b"a", b"b"], FakeProvider([clean, with_face]),
                                      face_confidence_threshold=0.6)
        self.assertFalse(an.ok)
        self.assertIn("face_detected_in_image", [r.label for r in an.reasons])

    def test_nsfw_blocks(self):
        nsfw = VisionResult(available=True, nsfw_likely=True)
        an = evaluate_image_blockers([b"x"], FakeProvider([nsfw]),
                                      face_confidence_threshold=0.6)
        self.assertIn("nsfw_image", [r.label for r in an.reasons])

    def test_contact_text_blocks(self):
        leaky = VisionResult(available=True, contact_text=["+971501234567"])
        an = evaluate_image_blockers([b"x"], FakeProvider([leaky]),
                                      face_confidence_threshold=0.6)
        self.assertIn("contact_info_in_image", [r.label for r in an.reasons])

    def test_profanity_clean(self):
        r = evaluate_profanity(["Hello, well maintained car"])
        self.assertEqual(r, [])

    def test_profanity_dirty(self):
        r = evaluate_profanity(["sh!t car for sale"])
        labels = [x.label for x in r]
        self.assertIn("profanity_detected", labels)

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Confirm FAIL**

- [ ] **Step 3: Implement hard_blockers.py**

```python
# services/auto_review/hard_blockers.py
from __future__ import annotations
import re
from dataclasses import dataclass, field
from .decision import FailReason
from .vision import VisionProvider, VisionResult

PROFANITY_TOKENS = (
    r"\bf[\W_]*u[\W_]*c[\W_]*k\b",
    r"\bsh[\W_!1]*t\b",
    r"\bb[\W_]*itch\b",
    r"\bcunt\b",
    r"\basshole\b",
)
_PROFANITY_RE = re.compile("|".join(PROFANITY_TOKENS), re.IGNORECASE)

PHONE_RE = re.compile(r"\+?\d[\d\s\-]{7,}")
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
SOCIAL_RE = re.compile(r"\b(?:t\.me|wa\.me|whatsapp|instagram|insta|tiktok|snap)\b", re.IGNORECASE)

@dataclass(frozen=True)
class ImageAnalysis:
    ok: bool
    reasons: list[FailReason] = field(default_factory=list)
    raw: list[VisionResult] = field(default_factory=list)

def evaluate_profanity(texts: list[str]) -> list[FailReason]:
    for t in texts:
        if not t:
            continue
        if _PROFANITY_RE.search(t):
            return [FailReason("profanity_detected", {"sample": t[:80]})]
    return []

def _looks_like_contact_text(text: str) -> bool:
    if not text:
        return False
    if PHONE_RE.search(text):
        return True
    if EMAIL_RE.search(text):
        return True
    if SOCIAL_RE.search(text):
        return True
    return False

def evaluate_image_blockers(
    image_bytes_list: list[bytes],
    provider: VisionProvider,
    *,
    face_confidence_threshold: float,
) -> ImageAnalysis:
    reasons: list[FailReason] = []
    raw: list[VisionResult] = []
    for idx, blob in enumerate(image_bytes_list):
        result = provider.analyze(blob)
        raw.append(result)
        if not result.available:
            reasons.append(FailReason("vision_unavailable", {"image_index": idx}))
            # No point checking the rest of this image; provider gave us nothing
            continue
        if result.face_count and result.face_count >= 1:
            reasons.append(FailReason("face_detected_in_image",
                                      {"image_index": idx, "face_count": result.face_count}))
        if result.nsfw_likely:
            reasons.append(FailReason("nsfw_image", {"image_index": idx}))
        for txt in result.contact_text:
            if _looks_like_contact_text(txt):
                reasons.append(FailReason("contact_info_in_image",
                                          {"image_index": idx, "sample": txt[:80]}))
                break
    return ImageAnalysis(ok=not reasons, reasons=reasons, raw=raw)
```

Note: face_confidence_threshold accepted as a knob but enforcement happens inside the provider implementation when it filters faces it returns. The `Null` provider returns 0 faces anyway; `Google` provider implementations should filter by `detectionConfidence` before populating `face_count`.

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
git add flask-react-supabase-app/backend/services/auto_review/hard_blockers.py \
        flask-react-supabase-app/backend/test_auto_review_hard_blockers.py
git commit -m "feat(auto-review): hard blockers — profanity, faces, NSFW, contact-in-image"
```

---

### Task 7: Decision composer — `evaluate(listing, signals) → Decision`

**Files:**
- Create: `flask-react-supabase-app/backend/services/auto_review/rules.py`
- Create: `flask-react-supabase-app/backend/test_auto_review_rules.py`

- [ ] **Step 1: Failing tests** — verify the ladder shortcuts and the final-decision logic.

```python
import unittest
from services.auto_review.decision import Decision, FailReason
from services.auto_review.trust import TrustContext, TrustResult, evaluate_trust
from services.auto_review.hard_blockers import ImageAnalysis
from services.auto_review.vin_gate import VinGateResult
from services.auto_review.rules import evaluate

class RulesTests(unittest.TestCase):
    def _ok_signals(self):
        return {
            "trust": TrustResult(True, "dealer_verified"),
            "image_analysis": ImageAnalysis(ok=True, reasons=[]),
            "vin": VinGateResult(ok=True, reasons=[], decoded={"make": "Honda"}),
            "profanity": [],
            "duplicate": None,           # None = clean
            "price_outlier": None,
            "user_under_review": False,
        }

    def test_full_pass_returns_approve(self):
        d = evaluate("car", listing={"make": "Honda"}, signals=self._ok_signals())
        self.assertTrue(d.approved)
        self.assertEqual(d.tier_matched, "dealer_verified")

    def test_face_fails_queues(self):
        s = self._ok_signals()
        s["image_analysis"] = ImageAnalysis(ok=False,
            reasons=[FailReason("face_detected_in_image", {"image_index": 0})])
        d = evaluate("car", listing={"make": "Honda"}, signals=s)
        self.assertFalse(d.approved)
        self.assertIn("face_detected_in_image", d.as_label_list())

    def test_vin_skipped_for_parts(self):
        s = self._ok_signals()
        s["vin"] = VinGateResult(ok=False,
            reasons=[FailReason("vin_format_invalid", {})], decoded={})
        d = evaluate("part", listing={}, signals=s)
        # parts don't require VIN
        self.assertTrue(d.approved)

    def test_no_trust_queues(self):
        s = self._ok_signals()
        s["trust"] = TrustResult(False, None)
        d = evaluate("car", listing={}, signals=s)
        self.assertFalse(d.approved)
        self.assertIn("no_trust_tier", d.as_label_list())

    def test_user_under_review_queues(self):
        s = self._ok_signals()
        s["user_under_review"] = True
        d = evaluate("car", listing={}, signals=s)
        self.assertFalse(d.approved)
        self.assertIn("user_under_review", d.as_label_list())

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Confirm FAIL**

- [ ] **Step 3: Implement rules.py**

```python
# services/auto_review/rules.py
from __future__ import annotations
from .decision import Decision, FailReason

VIN_REQUIRED_TYPES = {"car", "bike"}

def evaluate(listing_type: str, *, listing: dict, signals: dict) -> Decision:
    """Pure composer. signals dict carries pre-computed gate results:
        - trust: TrustResult
        - image_analysis: ImageAnalysis
        - vin: VinGateResult (ignored for parts/plates)
        - profanity: list[FailReason]
        - duplicate: FailReason | None
        - price_outlier: FailReason | None
        - user_under_review: bool
    """
    reasons: list[FailReason] = []
    t = (listing_type or "").lower()

    # Step 1 — hard blockers
    reasons.extend(signals.get("profanity") or [])
    image_analysis = signals.get("image_analysis")
    if image_analysis is not None and not image_analysis.ok:
        reasons.extend(image_analysis.reasons)
    if signals.get("duplicate"):
        reasons.append(signals["duplicate"])
    if signals.get("price_outlier"):
        reasons.append(signals["price_outlier"])
    if signals.get("user_under_review"):
        reasons.append(FailReason("user_under_review", {}))

    # Step 2 — VIN gate (cars/bikes only)
    if t in VIN_REQUIRED_TYPES:
        vin = signals.get("vin")
        if vin is None or not vin.ok:
            if vin is not None:
                reasons.extend(vin.reasons)
            else:
                reasons.append(FailReason("vin_decoder_unavailable", {}))

    # Step 4 — trust tier
    trust = signals.get("trust")
    if trust is None or not trust.matched:
        reasons.append(FailReason("no_trust_tier", {}))

    if reasons:
        return Decision.queue(reasons, signals={"raw": _summarize(signals)})
    return Decision.approve(
        tier_matched=trust.tier,
        signals={"raw": _summarize(signals)},
    )

def _summarize(signals: dict) -> dict:
    # Compact JSON-safe summary for the audit table.
    out = {}
    trust = signals.get("trust")
    if trust is not None:
        out["trust"] = {"matched": trust.matched, "tier": trust.tier}
    vin = signals.get("vin")
    if vin is not None:
        out["vin"] = {"ok": vin.ok, "decoded": vin.decoded}
    image_analysis = signals.get("image_analysis")
    if image_analysis is not None:
        out["image_count"] = len(image_analysis.raw)
    return out
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
git add flask-react-supabase-app/backend/services/auto_review/rules.py \
        flask-react-supabase-app/backend/test_auto_review_rules.py
git commit -m "feat(auto-review): rule composer (the formula)"
```

---

## Phase 2 — Glue: worker + helper refactor

### Task 8: Extract `_perform_approval` helper from `api_approve_item`

**Files:**
- Modify: `flask-react-supabase-app/backend/app.py:13257-13357` (extract body)
- Create: `flask-react-supabase-app/backend/test_perform_approval_helper.py`

- [ ] **Step 1: Failing test** — call `_perform_approval(item_type, item_id, actor='auto', actor_id='x')` with mocked `supabase_request`, expect PATCH with status=approved and `_invalidate_public_inventory_cache` called.

```python
import unittest
from unittest.mock import patch, MagicMock
import app as backend

class PerformApprovalTests(unittest.TestCase):
    def test_auto_actor_skips_admin_check_and_invalidates_cache(self):
        responses = {
            "patch": ([{"id": "abc", "user_id": "u1", "user_email": "u@example.com"}], 200),
            "get":   ([{"id": "abc", "user_id": "u1", "user_email": "u@example.com"}], 200),
        }
        def fake_supabase(method, path, data=None, **kw):
            return responses[method]
        with patch.object(backend, "supabase_request", side_effect=fake_supabase), \
             patch.object(backend, "_invalidate_public_inventory_cache") as inv, \
             patch.object(backend, "_send_listing_status_email", return_value=(True, None)):
            ok, payload, status = backend._perform_approval(
                item_type="cars", item_id="abc",
                actor="auto", actor_id="auto_review_worker",
            )
        self.assertTrue(ok)
        self.assertEqual(status, 200)
        inv.assert_called_once_with("cars")

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Confirm FAIL** — `_perform_approval` doesn't exist yet.

- [ ] **Step 3: Refactor `app.py`**

Extract everything inside `api_approve_item` (lines 13278–13348, after the admin check) into:

```python
def _perform_approval(item_type, item_id, *, actor, actor_id,
                      origin_header=None, signals=None, dry_run=False):
    """Shared approval implementation used by admin route and auto-review worker.
    actor: 'admin' | 'auto'
    Returns (ok: bool, payload: dict, http_status: int).
    """
    valid_item_types = {
        "cars": "cars", "bikes": "bikes",
        "parts": "car_parts", "plates": "license_plates",
        "buying_requests": "buying_requests",
        "buying_request": "buying_requests",
    }
    if item_type not in valid_item_types:
        return False, {"error": f"Invalid item type: {item_type}"}, 400
    table_name = valid_item_types[item_type]

    patch_data = {"status": "approved"}
    if item_type == "cars":
        patch_data["is_approved"] = True
    if actor == "auto":
        patch_data["auto_review_state"] = "auto_approved"
        patch_data["auto_review_decided_at"] = _utc_now().isoformat()

    if dry_run:
        return True, {"success": True, "dry_run": True}, 200

    response, status_code = supabase_request(
        "patch",
        f"/rest/v1/{table_name}?id=eq.{item_id}",
        data=patch_data,
        use_service_role=True,
    )
    if not (200 <= status_code < 300):
        logger.error(f"Error approving {item_type} {item_id}: {status_code} - {response}")
        return False, {"error": f"Failed to approve {item_type}"}, status_code

    listing = None
    if isinstance(response, list) and response:
        listing = response[0]
    elif isinstance(response, dict) and response.get("id"):
        listing = response
    if not listing:
        listing_response, listing_status = supabase_request(
            "get",
            f"/rest/v1/{table_name}?id=eq.{item_id}&select=*",
            use_service_role=True,
        )
        if listing_status < 400 and listing_response:
            listing = listing_response[0]

    email_sent = False
    email_error = None
    if listing:
        user_email = listing.get("user_email") or listing.get("contact_email")
        if not user_email and listing.get("user_id"):
            user_email = get_user_email(listing["user_id"])
        if user_email and EMAIL_REGEX.match(user_email):
            _, email_error = _send_listing_status_email(
                user_email, item_type, listing, "approved", origin_header,
            )
            if email_error:
                logger.error(
                    f"Approval email failed for {item_type} {item_id}: {email_error}"
                )
            else:
                email_sent = True
        else:
            email_error = "Missing or invalid recipient email"
    else:
        email_error = "Listing not found for email notification"

    logger.info(f"{actor.capitalize()} {actor_id} approved {item_type} {item_id}")
    _invalidate_public_inventory_cache(item_type)
    payload = {
        "success": True,
        "message": f"{item_type} approved successfully",
        "email_sent": email_sent,
    }
    if email_error:
        payload["email_error"] = "Approval email was not sent"
    return True, payload, 200
```

And rewrite `api_approve_item` to delegate:

```python
def api_approve_item(current_user, item_type, item_id):
    try:
        user_details = _get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get("is_admin"):
            return jsonify({"error": "Admin access required"}), 403
        ok, payload, status = _perform_approval(
            item_type, item_id,
            actor="admin", actor_id=current_user,
            origin_header=request.headers.get("Origin"),
        )
        return jsonify(payload), status
    except Exception as e:
        logger.error(f"Exception in api_approve_item: {str(e)}")
        return jsonify({"error": str(e)}), 500
```

- [ ] **Step 4: Run new test AND existing test_admin_approve_routes.py** — both pass.

`python -m unittest test_perform_approval_helper test_admin_approve_routes -v`

- [ ] **Step 5: Commit**

```bash
git add flask-react-supabase-app/backend/app.py \
        flask-react-supabase-app/backend/test_perform_approval_helper.py
git commit -m "refactor(approve): extract _perform_approval helper shared by admin + auto"
```

---

### Task 9: Auto-review worker module

**Files:**
- Create: `flask-react-supabase-app/backend/workers/auto_review_worker.py`
- Create: `flask-react-supabase-app/backend/test_auto_review_worker.py`

- [ ] **Step 1: Failing test** — happy path approves, image-fail path queues, dry-run never writes.

```python
import unittest
from unittest.mock import patch, MagicMock
from workers import auto_review_worker as worker
from services.auto_review.decision import Decision, FailReason

class WorkerTests(unittest.TestCase):
    def _row(self, **over):
        base = {"id": "abc", "user_id": "u1", "make": "Honda",
                "model": "Accord", "make_year": 2020, "vin": "1HGBH41JXMN109186"}
        base.update(over)
        return base

    def test_dry_run_never_calls_perform_approval(self):
        evaluator = MagicMock(return_value=Decision.approve(tier_matched="email_verified"))
        approver = MagicMock()
        recorder = MagicMock()
        rows_by_type = {"cars": [self._row()], "bikes": [], "parts": [], "plates": []}
        fetcher = lambda t: rows_by_type[t]
        signals_builder = lambda t, row: {}

        count = worker.process_once(
            fetch_pending=fetcher,
            build_signals=signals_builder,
            evaluate=evaluator,
            approve=approver,
            record_decision=recorder,
            dry_run=True,
        )
        self.assertEqual(count, 1)
        approver.assert_not_called()
        recorder.assert_called_once()

    def test_approve_path(self):
        evaluator = MagicMock(return_value=Decision.approve(tier_matched="dealer_verified"))
        approver = MagicMock(return_value=(True, {}, 200))
        recorder = MagicMock()
        rows = {"cars": [self._row()], "bikes": [], "parts": [], "plates": []}
        worker.process_once(
            fetch_pending=lambda t: rows[t],
            build_signals=lambda t, r: {},
            evaluate=evaluator, approve=approver, record_decision=recorder,
        )
        approver.assert_called_once()

    def test_queue_path_does_not_approve(self):
        evaluator = MagicMock(return_value=Decision.queue(
            [FailReason("face_detected_in_image", {})]))
        approver = MagicMock()
        recorder = MagicMock()
        downgrader = MagicMock()
        rows = {"cars": [self._row()], "bikes": [], "parts": [], "plates": []}
        worker.process_once(
            fetch_pending=lambda t: rows[t],
            build_signals=lambda t, r: {},
            evaluate=evaluator, approve=approver, record_decision=recorder,
            downgrade_to_pending=downgrader,
        )
        approver.assert_not_called()
        downgrader.assert_called_once()

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Confirm FAIL**

- [ ] **Step 3: Implement worker**

```python
# workers/auto_review_worker.py
from __future__ import annotations
import logging
import os
from typing import Callable

from services.auto_review.decision import Decision

logger = logging.getLogger("dph-auto-review")

LISTING_TYPES = ("cars", "bikes", "parts", "plates")
ITEM_TYPE_TO_TABLE = {
    "cars": "cars", "bikes": "bikes",
    "parts": "car_parts", "plates": "license_plates",
}

def process_once(
    *,
    fetch_pending: Callable[[str], list[dict]],
    build_signals: Callable[[str, dict], dict],
    evaluate: Callable[[str, dict, dict], Decision] | Callable[..., Decision],
    approve: Callable[..., tuple[bool, dict, int]] | None = None,
    record_decision: Callable[..., None] | None = None,
    downgrade_to_pending: Callable[..., None] | None = None,
    dry_run: bool = False,
    limit_per_type: int = 20,
) -> int:
    """Single tick. Returns number of rows handled."""
    handled = 0
    for type_label in LISTING_TYPES:
        rows = list(fetch_pending(type_label) or [])[:limit_per_type]
        listing_kind = type_label.rstrip("s")  # "car" | "bike" | "part" | "plate"
        for row in rows:
            try:
                signals = build_signals(listing_kind, row)
                decision = _call_evaluate(evaluate, listing_kind, row, signals)
                if record_decision:
                    record_decision(type_label, row, decision)
                if dry_run:
                    handled += 1
                    continue
                if decision.approved and approve is not None:
                    approve(item_type=type_label, item_id=str(row.get("id")),
                            actor="auto", actor_id="auto_review_worker",
                            signals=decision.signals)
                elif downgrade_to_pending is not None:
                    downgrade_to_pending(type_label, row, decision)
                handled += 1
            except Exception:
                logger.exception("auto-review row failed: type=%s id=%s",
                                 type_label, row.get("id"))
    return handled

def _call_evaluate(evaluate, listing_kind, row, signals):
    # Support both evaluate(listing_kind, listing=row, signals=signals) and
    # MagicMock with arbitrary signature.
    try:
        return evaluate(listing_kind, listing=row, signals=signals)
    except TypeError:
        return evaluate(listing_kind, row, signals)
```

The wiring helpers (`build_signals_for`, `fetch_pending_for_type`, etc.) live in `auto_review_worker.py` too — see Task 10 for the I/O side.

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
git add flask-react-supabase-app/backend/workers/auto_review_worker.py \
        flask-react-supabase-app/backend/test_auto_review_worker.py
git commit -m "feat(auto-review): worker tick orchestration"
```

---

### Task 10: Worker I/O wiring — Supabase fetchers, photo fetcher, decision recorder

**Files:**
- Modify: `flask-react-supabase-app/backend/workers/auto_review_worker.py` (add `run()` entrypoint)
- Create: `flask-react-supabase-app/backend/test_auto_review_worker_io.py`

- [ ] **Step 1: Failing test** — `run()` with `AUTO_REVIEW_WORKER_ENABLED=false` returns 0 and never queries Supabase.

```python
import os
import unittest
from unittest.mock import patch
from workers import auto_review_worker as worker

class RunGateTests(unittest.TestCase):
    def test_disabled_returns_zero(self):
        with patch.dict(os.environ, {"AUTO_REVIEW_WORKER_ENABLED": "false"}, clear=False):
            self.assertEqual(worker.run(), 0)

    def test_default_disabled_for_safety(self):
        env = {k: v for k, v in os.environ.items()
               if k != "AUTO_REVIEW_WORKER_ENABLED"}
        with patch.dict(os.environ, env, clear=True):
            self.assertEqual(worker.run(), 0)

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Confirm FAIL**

- [ ] **Step 3: Add `run()` + I/O helpers**

```python
# Append to workers/auto_review_worker.py

import io
import logging
import requests
from services.auto_review.vision import select_vision_provider
from services.auto_review.rules import evaluate as rules_evaluate
from services.auto_review.sync_gate import VIN_RE
from services.auto_review.vin_gate import evaluate_vin
from services.auto_review.trust import TrustContext, evaluate_trust
from services.auto_review.hard_blockers import evaluate_image_blockers, evaluate_profanity

def _env_bool(name, default):
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")

def _env_float(name, default):
    try:
        return float(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default

def _supabase():
    import app as backend
    return backend.supabase_request

def _approver():
    import app as backend
    return backend._perform_approval

def _fetch_pending_for_type(type_label):
    sb = _supabase()
    table = ITEM_TYPE_TO_TABLE[type_label]
    rows, status = sb(
        "get",
        f"/rest/v1/{table}",
        params={
            "select": "*",
            "status": "eq.pending_auto_review",
            "auto_review_decided_at": "is.null",
            "order": "created_at.asc",
            "limit": "20",
        },
        use_service_role=True,
    )
    if status >= 400:
        logger.warning("auto-review fetch failed: type=%s status=%s body=%s",
                       type_label, status, rows)
        return []
    return rows or []

def _fetch_image_bytes(listing_kind, row):
    table = ITEM_TYPE_TO_TABLE[listing_kind + "s"]
    images_table = {"cars": "car_images", "bikes": "bike_images",
                    "car_parts": "car_part_images",
                    "license_plates": "license_plate_images"}[table]
    sb = _supabase()
    rows, status = sb("get", f"/rest/v1/{images_table}",
                      params={"select": "image_url",
                              "listing_id": f"eq.{row.get('id')}",
                              "limit": "20"},
                      use_service_role=True)
    if status >= 400 or not rows:
        return []
    blobs = []
    for r in rows:
        url = r.get("image_url")
        if not url:
            continue
        try:
            resp = requests.get(url, timeout=8)
            if resp.status_code < 400 and resp.content:
                blobs.append(resp.content)
        except requests.RequestException:
            logger.warning("auto-review image fetch failed: %s", url)
    return blobs

def _trust_for(user_id):
    sb = _supabase()
    if not user_id:
        return TrustContext(False, False, 0, 0, 0, False)
    user_rows, _ = sb("get", "/rest/v1/users",
                      params={"select": "id,is_admin,email_verified,is_banned",
                              "id": f"eq.{user_id}", "limit": "1"},
                      use_service_role=True)
    u = (user_rows or [{}])[0]
    if u.get("is_banned"):
        return TrustContext(False, False, 0, 0, 0, False)
    dealer_verified = _dealer_verified(user_id)
    approved_count = _approved_listing_count(user_id)
    return TrustContext(
        is_admin=bool(u.get("is_admin")),
        dealer_verified=dealer_verified,
        approved_listings_count=approved_count,
        rejections_last_90d=0,  # Hooked up later
        reports_last_90d=0,
        email_verified=bool(u.get("email_verified")),
    )

def _dealer_verified(user_id):
    sb = _supabase()
    rows, _ = sb("get", "/rest/v1/dealer_verification_documents",
                 params={"select": "document_type,status",
                         "user_id": f"eq.{user_id}",
                         "status": "eq.approved"},
                 use_service_role=True)
    approved_types = {r.get("document_type") for r in (rows or [])}
    required = {"trade_license", "vat_certificate", "owner_id"}  # Match app.py:4124
    return required.issubset(approved_types)

def _approved_listing_count(user_id):
    sb = _supabase()
    total = 0
    for table in ("cars", "bikes", "car_parts", "license_plates"):
        rows, _ = sb("get", f"/rest/v1/{table}",
                     params={"select": "id",
                             "user_id": f"eq.{user_id}",
                             "status": "eq.approved"},
                     use_service_role=True)
        total += len(rows or [])
    return total

def _build_signals(listing_kind, row):
    provider = select_vision_provider()
    face_threshold = _env_float("AUTO_REVIEW_FACE_CONFIDENCE_THRESHOLD", 0.6)
    image_bytes = _fetch_image_bytes(listing_kind, row)
    image_analysis = evaluate_image_blockers(
        image_bytes, provider, face_confidence_threshold=face_threshold,
    )

    profanity = evaluate_profanity([
        row.get("description") or row.get("car_description") or "",
        row.get("whatsapp_prefill_text") or "",
    ])

    vin_signal = None
    if listing_kind in ("car", "bike"):
        from services.vin_decoder import VINDecoder
        decoder = VINDecoder()
        form_make = row.get("make") or row.get("bike_brand") or ""
        form_model = row.get("model") or row.get("bike_model") or ""
        form_year = row.get("make_year") or 0
        vin_signal = evaluate_vin(
            row.get("vin") or "",
            form_make=form_make, form_model=form_model, form_year=form_year,
            decoder=decoder,
        )

    trust_ctx = _trust_for(row.get("user_id"))
    trust = evaluate_trust(trust_ctx)

    return {
        "trust": trust,
        "image_analysis": image_analysis,
        "vin": vin_signal,
        "profanity": profanity,
        "duplicate": None,
        "price_outlier": None,
        "user_under_review": False,
    }

def _record_decision(type_label, row, decision):
    sb = _supabase()
    sb("post", "/rest/v1/auto_review_decisions",
       data={
           "listing_type": type_label,
           "listing_id": str(row.get("id")),
           "decision": "approved" if decision.approved else "queued",
           "reasons": decision.as_label_list(),
           "signals": decision.signals or {},
       },
       use_service_role=True)
    # Annotate the listing too
    table = ITEM_TYPE_TO_TABLE[type_label]
    sb("patch", f"/rest/v1/{table}?id=eq.{row.get('id')}",
       data={
           "auto_review_reasons": decision.as_label_list(),
           "auto_review_state": "auto_approved" if decision.approved else "auto_queued",
           "auto_review_decided_at": _now_iso(),
       },
       use_service_role=True)

def _downgrade_to_pending(type_label, row, decision):
    sb = _supabase()
    table = ITEM_TYPE_TO_TABLE[type_label]
    sb("patch", f"/rest/v1/{table}?id=eq.{row.get('id')}",
       data={"status": "pending"},
       use_service_role=True)

def _now_iso():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()

def run() -> int:
    """Worker entrypoint. Returns rows handled this tick (used by scheduled_loop backoff)."""
    if not _env_bool("AUTO_REVIEW_WORKER_ENABLED", False):
        return 0
    dry_run = _env_bool("AUTO_REVIEW_DRY_RUN", True)
    return process_once(
        fetch_pending=_fetch_pending_for_type,
        build_signals=_build_signals,
        evaluate=lambda kind, listing, signals: rules_evaluate(kind, listing=listing, signals=signals),
        approve=_call_approver,
        record_decision=_record_decision,
        downgrade_to_pending=_downgrade_to_pending,
        dry_run=dry_run,
    )

def _call_approver(*, item_type, item_id, actor, actor_id, signals):
    return _approver()(item_type=item_type, item_id=item_id,
                       actor=actor, actor_id=actor_id, signals=signals)
```

- [ ] **Step 4: PASS**

`python -m unittest test_auto_review_worker_io -v`

- [ ] **Step 5: Commit**

```bash
git add flask-react-supabase-app/backend/workers/auto_review_worker.py \
        flask-react-supabase-app/backend/test_auto_review_worker_io.py
git commit -m "feat(auto-review): worker I/O wiring (fetchers, image fetch, recorder, run gate)"
```

---

### Task 11: Wire worker into `worker.py::main()`

**Files:**
- Modify: `flask-react-supabase-app/backend/worker.py` (add import + thread)

- [ ] **Step 1: Add import + thread**

Inside the `try:` block that imports other workers (around line 153), add:

```python
from workers.auto_review_worker import run as _run_auto_review_once
```

Add an env knob:

```python
auto_review_interval_seconds = int(
    os.getenv("AUTO_REVIEW_INTERVAL_SECONDS", "15")
)
```

Add a thread alongside `webhook_delivery_thread`:

```python
auto_review_thread = threading.Thread(
    target=scheduled_loop,
    args=("auto_review_worker", _run_auto_review_once, auto_review_interval_seconds),
    name="auto-review",
    daemon=True,
)
auto_review_thread.start()
```

And join on shutdown.

- [ ] **Step 2: Smoke test import**

`cd flask-react-supabase-app/backend && python -c "import worker; print('ok')"` → prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add flask-react-supabase-app/backend/worker.py
git commit -m "feat(auto-review): register auto_review_worker in worker.py main()"
```

---

## Phase 3 — DB migrations (files only, NOT applied)

### Task 12: Auto-review columns migration

**Files:**
- Create: `flask-react-supabase-app/backend/migrations/add_auto_review_columns.sql`

- [ ] **Step 1: Write migration**

```sql
-- Adds auto-review tracking columns to all four listing tables.
-- Idempotent: safe to re-run.
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['cars', 'bikes', 'car_parts', 'license_plates']
    LOOP
        EXECUTE format('ALTER TABLE public.%I
            ADD COLUMN IF NOT EXISTS auto_review_state text NULL,
            ADD COLUMN IF NOT EXISTS auto_review_reasons jsonb NOT NULL DEFAULT ''[]''::jsonb,
            ADD COLUMN IF NOT EXISTS auto_review_decided_at timestamptz NULL', t);
        EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_pending_auto_review
            ON public.%I (status, auto_review_decided_at)
            WHERE status = ''pending_auto_review''', t, t);
    END LOOP;
END $$;
```

- [ ] **Step 2: Commit (do NOT apply to prod)**

```bash
git add flask-react-supabase-app/backend/migrations/add_auto_review_columns.sql
git commit -m "feat(auto-review): migration — auto_review_* columns on listing tables"
```

---

### Task 13: Auto-review decisions audit table

**Files:**
- Create: `flask-react-supabase-app/backend/migrations/add_auto_review_decisions.sql`

- [ ] **Step 1: Write migration**

```sql
CREATE TABLE IF NOT EXISTS public.auto_review_decisions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_type text NOT NULL,
    listing_id text NOT NULL,
    decision text NOT NULL CHECK (decision IN ('approved', 'queued')),
    reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
    signals jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auto_review_decisions_listing
    ON public.auto_review_decisions (listing_type, listing_id);
CREATE INDEX IF NOT EXISTS idx_auto_review_decisions_decision_time
    ON public.auto_review_decisions (decision, created_at DESC);

ALTER TABLE public.auto_review_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_review_decisions FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.auto_review_decisions IS
    'Append-only audit of automated approval decisions. Service-role writes only.';
```

- [ ] **Step 2: Commit (do NOT apply to prod)**

```bash
git add flask-react-supabase-app/backend/migrations/add_auto_review_decisions.sql
git commit -m "feat(auto-review): migration — auto_review_decisions audit table"
```

---

## Phase 4 — POST handler wiring

### Task 14: Helper to decide insert status

**Files:**
- Modify: `flask-react-supabase-app/backend/app.py` (add helper)
- Create: `flask-react-supabase-app/backend/test_auto_review_initial_status.py`

- [ ] **Step 1: Failing test**

```python
import unittest
from unittest.mock import patch
import app as backend

class InitialStatusTests(unittest.TestCase):
    def test_returns_auto_review_when_enabled(self):
        with patch.dict("os.environ", {"AUTO_REVIEW_WORKER_ENABLED": "true"}):
            self.assertEqual(backend._initial_listing_status(), "pending_auto_review")

    def test_returns_pending_when_disabled(self):
        with patch.dict("os.environ", {"AUTO_REVIEW_WORKER_ENABLED": "false"}):
            self.assertEqual(backend._initial_listing_status(), "pending")

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Confirm FAIL**

- [ ] **Step 3: Add to app.py**

```python
def _initial_listing_status():
    raw = os.getenv("AUTO_REVIEW_WORKER_ENABLED", "false").strip().lower()
    return "pending_auto_review" if raw in ("1", "true", "yes", "on") else "pending"
```

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit**

```bash
git add flask-react-supabase-app/backend/app.py \
        flask-react-supabase-app/backend/test_auto_review_initial_status.py
git commit -m "feat(auto-review): _initial_listing_status() helper gated by env"
```

---

### Task 15: Apply helper in 4 POST endpoints

**Files:**
- Modify: `flask-react-supabase-app/backend/app.py`
  - `create_car` (~line 5244)
  - `create_bike` (~line 10895)
  - `create_part` (~line 11900)
  - `create_plate` (~line 12810)

- [ ] **Step 1: For each endpoint** — find the place that sets `status = "pending"` and replace with `status = _initial_listing_status()`. Two of the four endpoints (`create_bike` line 10913, `create_part` line 11900-ish) already have explicit assignment; for cars+plates check where status defaults and add the call.

- [ ] **Step 2: Smoke test** — `python -c "import app; print('ok')"`.

- [ ] **Step 3: Commit**

```bash
git add flask-react-supabase-app/backend/app.py
git commit -m "feat(auto-review): route POST inserts to pending_auto_review when enabled"
```

---

## Phase 5 — Full test sweep

### Task 16: Run the full backend test suite

- [ ] **Step 1:** `cd flask-react-supabase-app/backend && python -m unittest discover -v 2>&1 | tail -100`
- [ ] **Step 2:** Triage any regressions (tests that relied on hardcoded "pending" status, etc.). Fix.
- [ ] **Step 3:** Re-run until green.
- [ ] **Step 4:** Commit fixes.

---

## Out of scope for this plan (followups)

- Real `GoogleVisionProvider` HTTP implementation (needs API key).
- Image perceptual-hash duplicate check (Step 3d) — currently `duplicate` signal returns `None`. Requires `imagehash` lib + storage decision.
- Price-outlier check (Step 1e) — currently `price_outlier` signal returns `None`. Needs decision on median-cache table.
- Reports / rejection counts feeding into TrustContext — currently hardcoded 0.
- Admin UI surfaces `auto_review_reasons` as a tooltip — frontend change, separate plan.
- Applying migrations to prod Supabase.
- Fixing the **separate** OCR 500 bug — apply the existing `add_listing_verification_scans.sql`.

## Self-review checklist (done)

- **Placeholder scan:** No TBD/TODO in actionable steps.
- **Spec coverage:** Steps 0–4 of the formula are each implemented (sync_gate, hard_blockers + vision, vin_gate, rules composer, trust). Image perceptual hash, price-outlier, and rejection counts noted as out-of-scope followups (still in audit table).
- **Type consistency:** `Decision`, `FailReason`, `VisionResult`, `ImageAnalysis`, `VinGateResult`, `TrustResult`, `TrustContext` defined once, used with matching field names.
- **Idempotency:** Migrations use `IF NOT EXISTS`; `_perform_approval` is safe to call twice (PATCH is idempotent in semantics).
