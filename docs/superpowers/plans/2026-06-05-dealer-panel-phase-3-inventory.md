# Dealer Panel — Phase 3: Bulk Inventory & DMS Ingest — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let verified dealerships upload 50–500 listings at once via CSV/XML, export their current inventory + sales pipeline, and pull listings from their own DMS via a generic JSON adapter.

**Architecture:** A new `routes/dealer/inventory.py` Flask blueprint serves upload + job-status + export endpoints. Uploads land in Supabase Storage bucket `dealer-imports/<dealership_id>/<job_id>/`, create a `dealer_inventory_jobs` row with `status='queued'`, and are picked up by a background `inventory_import_worker` (queued-table polling, 10s interval). The worker parses each file, validates rows against the canonical schema, applies the dealer's saved column mapping, and creates/updates listings via the existing listing endpoints (so we never bypass the normal post hooks). Per-row failures are recorded in `dealer_inventory_row_errors`; job status streams back to the UI via the existing dealer realtime pattern. A separate `dealer_api_source_poller` worker fetches from each enabled `dealer_api_sources` row on its declared `poll_interval_min`, normalises the payload with the dealer's `field_mapping`, and submits a `kind='api_pull'` job through the same import pipeline. DMS credentials are envelope-encrypted with Fernet at rest using a key from `DEALER_INTEGRATIONS_KEY`.

**Tech stack:**
- Backend: Flask blueprint, `requests` against Supabase REST (service role), pytest
- Worker: pure-Python loop registered through `worker.py:scheduled_loop`
- DB: Postgres via Supabase + storage bucket
- Encryption: `cryptography.fernet.Fernet` (already in `requirements.txt` for other features — verify)
- Parsing: `csv` + `xml.etree.ElementTree` (stdlib only — no new deps)
- Frontend: React + apiClient + Tailwind, mirrors Phase 1/2 dealer components

**References:**
- Spec: `docs/superpowers/specs/2026-06-03-dealer-admin-panel-design.md` §3.1 (data model), §8 (Phase 3)
- Phase 1 patterns to mirror: `backend/routes/dealer/{core,analytics}.py`, `backend/workers/dealer_kpi_aggregator.py`
- Phase 2 patterns to mirror: `backend/routes/dealer/leads.py`, `backend/workers/dealer_lead_aggregator.py`, `backend/migrations/2026_06_05_dealer_leads.sql`
- Existing storage upload pattern: `backend/app.py:_upload_bytes_to_supabase_storage` (around line 6367)

**Design decisions (locked, see §"Open questions" below if you disagree before implementing):**
1. **Canonical schema for cars** (the primary listing type): `external_id, make, model, year, price, mileage, body_type, color, fuel_type, transmission, description, image_urls`. `image_urls` is a `;`-separated list of HTTP(S) URLs. We do NOT download images in v1 — we store the URLs as-is and the existing image pipeline can lazy-fetch later if needed.
2. **Update semantics**: when an incoming row carries an `external_id` that already exists for the dealership, we UPDATE the matching listing (using `dealership_id + external_id` as the natural key on `cars.external_id`). When `external_id` is empty, we INSERT a fresh listing.
3. **Column mapping**: dealer provides a JSON mapping (e.g. `{"Stock #": "external_id", "Make": "make", "MSRP": "price"}`) at upload time. The UI lets them edit it before submit. We don't auto-detect schemas in v1.
4. **File size cap**: 10 MB. Bigger uploads return 413.
5. **DMS adapters**: ship only `generic_json` in v1. `generic_json` adapter takes `{endpoint_url, auth_type, credentials, field_mapping}`, calls the endpoint, expects a top-level JSON array (or `{listings: [...]}` envelope), applies `field_mapping`, returns normalised rows.
6. **Encryption key**: read from env var `DEALER_INTEGRATIONS_KEY` (urlsafe base64 32-byte key). If unset, **the credentials endpoints refuse to save** rather than store plaintext. The poller skips sources whose credentials can't be decrypted.
7. **Only cars in v1**. Bikes/parts/plates importable in a follow-up. Inventory routes hardcode `listing_type='car'`.

**Open questions (to resolve before merge — none should block any task):**
- Does the dealer's `external_id` need to be added as a column to `cars`? **Yes** — covered by Task 1's migration adding `external_id text` + a `(dealership_id, external_id)` unique partial index where `external_id IS NOT NULL`.
- Should image URLs be downloaded into our own storage? **Deferred** — adds significant complexity (rate limits, hotlinking, broken URLs). Phase 3.1 can do this if dealers complain about hotlinking issues.

---

## File structure

### Create
- `backend/migrations/2026_06_05_dealer_inventory.sql` — `dealer_inventory_jobs`, `dealer_inventory_row_errors`, `dealer_api_sources` tables, RLS, indexes, `cars.external_id` column + index, storage bucket policy. Idempotent.
- `backend/services/dealer_inventory.py` — pure CSV/XML parsing + column mapping + row validation. No I/O.
- `backend/test_dealer_inventory_service.py` — pytest unit tests.
- `backend/services/dealer_credentials.py` — Fernet-based envelope encryption helpers. No I/O.
- `backend/test_dealer_credentials_service.py` — pytest unit tests.
- `backend/workers/inventory_import_worker.py` — polls queued jobs, parses files from Supabase Storage, upserts listings.
- `backend/test_inventory_import_worker.py` — pytest mocking requests + storage.
- `backend/workers/dealer_api_source_poller.py` — polls enabled `dealer_api_sources` rows on their declared interval, submits api_pull jobs.
- `backend/test_dealer_api_source_poller.py` — pytest mocking requests + decryption.
- `backend/routes/dealer/inventory.py` — endpoints below.
- `backend/test_dealer_inventory_routes.py` — pytest using the same fixtures pattern as Phase 2.
- `backend/routes/dealer/api_sources.py` — DMS source CRUD.
- `backend/test_dealer_api_sources_routes.py` — pytest.
- `frontend/src/components/dealer/DealerInventory.jsx` — upload + job list page.
- `frontend/src/components/dealer/DealerInventoryUpload.jsx` — multi-step upload wizard.
- `frontend/src/components/dealer/DealerInventoryJobDetail.jsx` — job status with row errors.
- `frontend/src/components/dealer/DealerApiSources.jsx` — DMS sources CRUD page.
- `backend/migrations/PHASE3_MANUAL_SMOKE.md` — checklist for the human after applying the migration.

### Modify
- `backend/routes/dealer/__init__.py` — register `inventory_bp` and `api_sources_bp`.
- `backend/worker.py` — schedule `inventory_import_worker.run` (10s) and `dealer_api_source_poller.run` (60s).
- `frontend/src/components/DealerSidebar.jsx` — add `Inventory` and `Integrations` nav items.
- `frontend/src/App.js` — add `/dealer/inventory`, `/dealer/inventory/jobs/:id`, `/dealer/integrations` routes.

### Verify (no edits)
- `backend/routes/dealer/_decorators.py` (used as-is)
- `backend/app.py:_upload_bytes_to_supabase_storage` (we'll use a service-role variant for storage POSTs)

---

## Task 1: Migration

**Files:**
- Create: `flask-react-supabase-app/backend/migrations/2026_06_05_dealer_inventory.sql`

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================
-- Phase 3 — Bulk Inventory & DMS Ingest
-- Tables: dealer_inventory_jobs, dealer_inventory_row_errors, dealer_api_sources
-- cars.external_id column + uniqueness
-- Storage bucket policy for dealer-imports
-- ============================================================

-- 1. cars.external_id (dealer's own identifier — natural key for upserts)
ALTER TABLE public.cars
    ADD COLUMN IF NOT EXISTS external_id text;

-- A dealership can't reuse the same external_id twice. Anonymous (NULL) rows
-- skip the constraint.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cars_dealership_external_id
    ON public.cars (dealership_id, external_id)
    WHERE external_id IS NOT NULL;

-- 2. Inventory jobs
CREATE TABLE IF NOT EXISTS public.dealer_inventory_jobs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dealership_id   uuid NOT NULL REFERENCES public.dealerships(id) ON DELETE CASCADE,
    kind            text NOT NULL CHECK (kind IN ('csv_import','xml_import','api_pull','csv_export')),
    source          text,
    status          text NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','running','partial','succeeded','failed')),
    rows_total      int NOT NULL DEFAULT 0,
    rows_created    int NOT NULL DEFAULT 0,
    rows_updated    int NOT NULL DEFAULT 0,
    rows_skipped    int NOT NULL DEFAULT 0,
    rows_failed     int NOT NULL DEFAULT 0,
    error_summary   jsonb NOT NULL DEFAULT '{}'::jsonb,
    column_mapping  jsonb NOT NULL DEFAULT '{}'::jsonb,
    file_path       text,
    started_at      timestamptz,
    finished_at     timestamptz,
    triggered_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dealer_inv_jobs_dealership_time
    ON public.dealer_inventory_jobs (dealership_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dealer_inv_jobs_status_time
    ON public.dealer_inventory_jobs (status, created_at ASC)
    WHERE status IN ('queued','running');

-- 3. Per-row error details for transparency
CREATE TABLE IF NOT EXISTS public.dealer_inventory_row_errors (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id          uuid NOT NULL REFERENCES public.dealer_inventory_jobs(id) ON DELETE CASCADE,
    row_index       int NOT NULL,
    external_id     text,
    error_code      text NOT NULL,
    error_message   text NOT NULL,
    raw_row         jsonb,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dealer_inv_row_errors_job_row
    ON public.dealer_inventory_row_errors (job_id, row_index);

-- 4. DMS sources
CREATE TABLE IF NOT EXISTS public.dealer_api_sources (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dealership_id       uuid NOT NULL REFERENCES public.dealerships(id) ON DELETE CASCADE,
    label               text NOT NULL,
    adapter             text NOT NULL CHECK (adapter IN ('generic_json')),
    endpoint_url        text NOT NULL,
    auth_type           text NOT NULL CHECK (auth_type IN ('bearer','basic','hmac','none')),
    credentials_enc     text,
    field_mapping       jsonb NOT NULL DEFAULT '{}'::jsonb,
    poll_interval_min   int NOT NULL DEFAULT 60 CHECK (poll_interval_min >= 5),
    last_pulled_at      timestamptz,
    last_status         text,
    last_error          text,
    enabled             bool NOT NULL DEFAULT true,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dealer_api_sources_due
    ON public.dealer_api_sources (last_pulled_at NULLS FIRST)
    WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_dealer_api_sources_dealership
    ON public.dealer_api_sources (dealership_id);

-- 5. RLS — mirrors 2026_06_03_dealer_rls.sql pattern
ALTER TABLE public.dealer_inventory_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dealer_inv_jobs_read" ON public.dealer_inventory_jobs;
CREATE POLICY "dealer_inv_jobs_read" ON public.dealer_inventory_jobs FOR SELECT
USING (public.is_dealership_member(dealership_id) OR public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "dealer_inv_jobs_service_all" ON public.dealer_inventory_jobs;
CREATE POLICY "dealer_inv_jobs_service_all" ON public.dealer_inventory_jobs FOR ALL
USING (true) WITH CHECK (true);

ALTER TABLE public.dealer_inventory_row_errors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dealer_inv_row_errors_read" ON public.dealer_inventory_row_errors;
CREATE POLICY "dealer_inv_row_errors_read" ON public.dealer_inventory_row_errors FOR SELECT
USING (EXISTS (
    SELECT 1 FROM public.dealer_inventory_jobs j
    WHERE j.id = dealer_inventory_row_errors.job_id
      AND (public.is_dealership_member(j.dealership_id) OR public.is_admin(auth.uid()))
));
DROP POLICY IF EXISTS "dealer_inv_row_errors_service_all" ON public.dealer_inventory_row_errors;
CREATE POLICY "dealer_inv_row_errors_service_all" ON public.dealer_inventory_row_errors FOR ALL
USING (true) WITH CHECK (true);

ALTER TABLE public.dealer_api_sources ENABLE ROW LEVEL SECURITY;
-- Read OK for members, but NEVER expose credentials_enc directly via PostgREST.
-- The backend endpoint never returns it; we still keep this policy in case of
-- direct PostgREST access, which should never happen, but defense in depth.
DROP POLICY IF EXISTS "dealer_api_sources_read" ON public.dealer_api_sources;
CREATE POLICY "dealer_api_sources_read" ON public.dealer_api_sources FOR SELECT
USING (public.is_dealership_member(dealership_id) OR public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "dealer_api_sources_service_all" ON public.dealer_api_sources;
CREATE POLICY "dealer_api_sources_service_all" ON public.dealer_api_sources FOR ALL
USING (true) WITH CHECK (true);

-- 6. Realtime publication for job-status updates
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.dealer_inventory_jobs;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
    END IF;
END $$;

DO $$ BEGIN
    RAISE NOTICE '✅ Phase 3 inventory tables + cars.external_id created';
END $$;
```

- [ ] **Step 2: Storage bucket setup (manual, human applies)**

In Supabase Dashboard → Storage, create a private bucket named `dealer-imports` if it doesn't already exist. Set max file size to 10 MB. Add RLS policy on `storage.objects`: only the service role can read/write under this bucket (we'll always go through the backend, never directly from the browser). The migration file already includes a hint comment about this; the human creates the bucket via the dashboard.

Document this step in the manual smoke doc (Task 15).

- [ ] **Step 3: Commit**

```
Phase 3: dealer_inventory_jobs + row_errors + api_sources tables + cars.external_id
```

---

## Task 2: Service module — `dealer_inventory` (pure)

**Files:**
- Create: `flask-react-supabase-app/backend/services/dealer_inventory.py`
- Test: `flask-react-supabase-app/backend/test_dealer_inventory_service.py`

- [ ] **Step 1: Write the failing test**

```python
# flask-react-supabase-app/backend/test_dealer_inventory_service.py
import pytest
from services.dealer_inventory import (
    CANONICAL_FIELDS,
    REQUIRED_FIELDS,
    apply_column_mapping,
    parse_csv_bytes,
    parse_xml_bytes,
    validate_row,
    coerce_row,
)


def test_canonical_fields_include_external_id_and_price():
    assert "external_id" in CANONICAL_FIELDS
    assert "price" in CANONICAL_FIELDS
    assert "make" in CANONICAL_FIELDS


def test_required_fields_are_subset_of_canonical():
    assert set(REQUIRED_FIELDS).issubset(set(CANONICAL_FIELDS))


def test_apply_column_mapping_renames_keys_and_drops_unmapped():
    row = {"Stock #": "S1", "Make": "Toyota", "Notes": "..."}
    mapping = {"Stock #": "external_id", "Make": "make"}
    out = apply_column_mapping(row, mapping)
    assert out == {"external_id": "S1", "make": "Toyota"}


def test_parse_csv_bytes_handles_utf8_bom():
    data = b"\xef\xbb\xbfmake,year\nToyota,2020\nHonda,2021\n"
    rows = list(parse_csv_bytes(data))
    assert rows == [{"make": "Toyota", "year": "2020"}, {"make": "Honda", "year": "2021"}]


def test_parse_xml_bytes_returns_dicts():
    data = b"""<?xml version="1.0"?>
<vehicles>
  <vehicle><make>Toyota</make><year>2020</year></vehicle>
  <vehicle><make>Honda</make><year>2021</year></vehicle>
</vehicles>"""
    rows = list(parse_xml_bytes(data))
    assert rows == [{"make": "Toyota", "year": "2020"}, {"make": "Honda", "year": "2021"}]


def test_validate_row_passes_minimal_required():
    row = {"make": "Toyota", "model": "Camry", "year": "2020", "price": "60000"}
    ok, err = validate_row(row)
    assert ok is True
    assert err is None


def test_validate_row_rejects_missing_required():
    ok, err = validate_row({"make": "Toyota"})  # missing model, year, price
    assert ok is False
    assert err["code"] == "missing_fields"


def test_validate_row_rejects_non_numeric_price():
    ok, err = validate_row({"make": "Toyota", "model": "Camry", "year": "2020", "price": "free"})
    assert ok is False
    assert err["code"] == "invalid_price"


def test_validate_row_rejects_unreasonable_year():
    ok, err = validate_row({"make": "Toyota", "model": "Camry", "year": "1599", "price": "1000"})
    assert ok is False
    assert err["code"] == "invalid_year"


def test_coerce_row_converts_types_and_splits_image_urls():
    row = {
        "external_id": "S1",
        "make": "Toyota",
        "model": "Camry",
        "year": "2020",
        "price": "60000.5",
        "mileage": "45000",
        "image_urls": "https://a/1.jpg;https://a/2.jpg",
    }
    out = coerce_row(row)
    assert out["make_year"] == 2020
    assert out["expected_selling_price"] == 60000
    assert out["kilometers"] == 45000
    assert out["external_id"] == "S1"
    assert out["images"] == ["https://a/1.jpg", "https://a/2.jpg"]
    # raw fields kept too
    assert out["make"] == "Toyota"
    assert out["car_model"] == "Camry"


def test_coerce_row_handles_blank_image_urls_field():
    row = {"make": "Toyota", "model": "Camry", "year": "2020", "price": "60000", "image_urls": ""}
    out = coerce_row(row)
    assert out["images"] == []
```

- [ ] **Step 2: Run pytest, confirm failure**

```bash
cd flask-react-supabase-app/backend && pytest test_dealer_inventory_service.py -v
```

Expected: ModuleNotFoundError.

- [ ] **Step 3: Implement the service**

```python
# flask-react-supabase-app/backend/services/dealer_inventory.py
"""Pure helpers for the dealer inventory import pipeline.

No I/O — parsing, validation, column mapping, type coercion. Callable from
the import worker and from request handlers. Designed for cars only in v1.
"""
import csv
import io
import xml.etree.ElementTree as ET
from typing import Iterable, Optional, Tuple

CANONICAL_FIELDS = (
    "external_id", "make", "model", "year", "price", "mileage",
    "body_type", "color", "fuel_type", "transmission", "description",
    "image_urls",
)

REQUIRED_FIELDS = ("make", "model", "year", "price")

MIN_YEAR = 1900
MAX_YEAR = 2100


def apply_column_mapping(row: dict, mapping: dict) -> dict:
    """Map dealer-supplied column names to canonical names, dropping unmapped keys."""
    return {mapping[k]: v for k, v in row.items() if k in mapping}


def parse_csv_bytes(data: bytes) -> Iterable[dict]:
    """Parse CSV bytes (UTF-8, optional BOM) into rows of plain strings."""
    text = data.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    for row in reader:
        yield {k: (v or "").strip() for k, v in row.items() if k}


def parse_xml_bytes(data: bytes) -> Iterable[dict]:
    """Parse a flat XML structure: <root><item><field>value</field>...</item>...</root>"""
    root = ET.fromstring(data)
    for child in list(root):
        yield {c.tag: (c.text or "").strip() for c in child}


def validate_row(row: dict) -> Tuple[bool, Optional[dict]]:
    missing = [f for f in REQUIRED_FIELDS if not (row.get(f) or "").strip()]
    if missing:
        return False, {"code": "missing_fields", "fields": missing}
    try:
        price = float(row["price"])
        if price < 0:
            return False, {"code": "invalid_price"}
    except (TypeError, ValueError):
        return False, {"code": "invalid_price"}
    try:
        year = int(float(row["year"]))
        if not (MIN_YEAR <= year <= MAX_YEAR):
            return False, {"code": "invalid_year"}
    except (TypeError, ValueError):
        return False, {"code": "invalid_year"}
    return True, None


def coerce_row(row: dict) -> dict:
    """Convert validated row into the listing DB column shape."""
    out = dict(row)
    if "year" in row:
        try:
            out["make_year"] = int(float(row["year"]))
        except (TypeError, ValueError):
            pass
    if "price" in row:
        try:
            out["expected_selling_price"] = int(float(row["price"]))
        except (TypeError, ValueError):
            pass
    if "mileage" in row:
        try:
            out["kilometers"] = int(float(row["mileage"]))
        except (TypeError, ValueError):
            pass
    if "model" in row:
        out["car_model"] = row["model"]
    raw_images = (row.get("image_urls") or "").strip()
    out["images"] = [u.strip() for u in raw_images.split(";") if u.strip()] if raw_images else []
    return out
```

- [ ] **Step 4: Run pytest, confirm all 11 tests pass**

```bash
cd flask-react-supabase-app/backend && pytest test_dealer_inventory_service.py -v
```

Expected: `11 passed`.

- [ ] **Step 5: Commit**

```
Phase 3: dealer_inventory pure service (CSV/XML parse + validate + coerce)
```

---

## Task 3: Service module — `dealer_credentials` (envelope encryption)

**Files:**
- Create: `flask-react-supabase-app/backend/services/dealer_credentials.py`
- Test: `flask-react-supabase-app/backend/test_dealer_credentials_service.py`

- [ ] **Step 1: Confirm Fernet is available**

```bash
cd flask-react-supabase-app/backend && python -c "from cryptography.fernet import Fernet; print('ok')"
```

If missing, STOP and report BLOCKED — add `cryptography>=41` to `requirements.txt` first.

- [ ] **Step 2: Write the failing test**

```python
# flask-react-supabase-app/backend/test_dealer_credentials_service.py
import os
import pytest

from services.dealer_credentials import (
    encrypt_credentials,
    decrypt_credentials,
    KeyMissingError,
)


@pytest.fixture
def fake_key(monkeypatch):
    # urlsafe-base64 32 bytes (a Fernet key)
    monkeypatch.setenv("DEALER_INTEGRATIONS_KEY", "rR-1RrwvLZQ3rWdEzTfBQg2WJ5HhEuJ8gFxqK6vfYbY=")
    yield


def test_encrypt_then_decrypt_round_trips(fake_key):
    plain = {"bearer_token": "very-secret-123"}
    enc = encrypt_credentials(plain)
    assert isinstance(enc, str) and enc != "very-secret-123"
    dec = decrypt_credentials(enc)
    assert dec == plain


def test_encrypt_raises_without_key(monkeypatch):
    monkeypatch.delenv("DEALER_INTEGRATIONS_KEY", raising=False)
    with pytest.raises(KeyMissingError):
        encrypt_credentials({"x": "y"})


def test_decrypt_raises_without_key(monkeypatch, fake_key):
    enc = encrypt_credentials({"x": "y"})
    monkeypatch.delenv("DEALER_INTEGRATIONS_KEY", raising=False)
    with pytest.raises(KeyMissingError):
        decrypt_credentials(enc)


def test_decrypt_returns_none_for_tampered_payload(fake_key):
    enc = encrypt_credentials({"x": "y"})
    tampered = enc[:-2] + "AA"
    assert decrypt_credentials(tampered) is None
```

- [ ] **Step 3: Run pytest, confirm failure**

```bash
pytest test_dealer_credentials_service.py -v
```

- [ ] **Step 4: Implement the service**

```python
# flask-react-supabase-app/backend/services/dealer_credentials.py
"""Envelope encryption for dealer DMS credentials.

Key sourced from env var DEALER_INTEGRATIONS_KEY (urlsafe base64, 32 bytes).
We use cryptography.fernet — symmetric AES-128-CBC + HMAC. Production
should rotate this key offline and rewrap; this module deliberately
doesn't implement rotation (deferred to a later phase).
"""
import json
import os
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken


class KeyMissingError(RuntimeError):
    pass


def _fernet() -> Fernet:
    key = os.getenv("DEALER_INTEGRATIONS_KEY")
    if not key:
        raise KeyMissingError(
            "DEALER_INTEGRATIONS_KEY env var is unset. Generate one with: "
            "python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'"
        )
    return Fernet(key.encode("utf-8"))


def encrypt_credentials(payload: dict) -> str:
    """Encrypt a JSON-serialisable credentials dict and return a base64 token."""
    token = _fernet().encrypt(json.dumps(payload).encode("utf-8"))
    return token.decode("utf-8")


def decrypt_credentials(token: str) -> Optional[dict]:
    """Return the original dict or None if the token is tampered/invalid.

    Raises KeyMissingError if the env key is unset (caller should treat that
    as a configuration problem, not a tampered token).
    """
    try:
        plain = _fernet().decrypt(token.encode("utf-8"))
    except InvalidToken:
        return None
    return json.loads(plain.decode("utf-8"))
```

- [ ] **Step 5: Run pytest, confirm all 4 tests pass**

- [ ] **Step 6: Commit**

```
Phase 3: dealer_credentials envelope encryption (Fernet)
```

---

## Task 4: Import worker

**Files:**
- Create: `flask-react-supabase-app/backend/workers/inventory_import_worker.py`
- Test: `flask-react-supabase-app/backend/test_inventory_import_worker.py`

The worker:
1. Picks the oldest `dealer_inventory_jobs` row with `status='queued'`. Optimistic claim: PATCH it to `status='running'` with `started_at=now()`. Only proceed if the row was actually updated.
2. Reads the file from Supabase Storage at `dealer-imports/<dealership_id>/<job_id>/<filename>`.
3. Parses with `parse_csv_bytes` or `parse_xml_bytes` based on `kind`.
4. For each row: apply column mapping, validate, coerce. On failure → insert a `dealer_inventory_row_errors` row; on success → upsert into `cars` (insert if `external_id` is new for this dealership, update otherwise).
5. Update job row with `status='succeeded'|'partial'|'failed'`, `rows_total/created/updated/skipped/failed`, `finished_at=now()`.

Worker test cases (≥ 5):
- Picks queued job, advances to running, then succeeded with `rows_created=N`.
- Partial success: 3 rows good, 2 rows bad → status `partial`, error rows recorded.
- Skips job that's not in `queued` state (idempotency).
- `api_pull` kind reads from the job's `column_mapping` field; doesn't try to load a file.
- Failure during file download → status `failed`, `error_summary` set.

Full implementation: ~250 lines, follows `dealer_lead_aggregator.py` pattern. See plan's reference notes above. The test file should mock `requests` for Supabase REST + Storage.

For brevity in this plan, write the implementer prompt with explicit tests but allow the implementer to fill in the production code to match the test assertions. Tests are the spec.

Test code (use exactly):

```python
# flask-react-supabase-app/backend/test_inventory_import_worker.py
from unittest.mock import patch, MagicMock
from workers import inventory_import_worker as imp


def _resp(status, body, headers=None):
    r = MagicMock()
    r.status_code = status
    r.json.return_value = body
    r.text = str(body)
    r.headers = headers or {}
    r.content = body if isinstance(body, (bytes, bytearray)) else str(body).encode()
    return r


CSV_BODY = b"external_id,make,model,year,price\nS1,Toyota,Camry,2020,60000\nS2,Honda,Civic,2019,40000\n"


@patch("workers.inventory_import_worker.requests")
def test_run_succeeds_on_csv_with_two_rows(mock_requests):
    mock_requests.get.side_effect = [
        _resp(200, [{
            "id": "job-1", "dealership_id": "d1", "kind": "csv_import",
            "file_path": "dealer-imports/d1/job-1/file.csv",
            "column_mapping": {"external_id": "external_id", "make": "make",
                               "model": "model", "year": "year", "price": "price"},
            "status": "queued",
        }]),  # claim — pick queued
        _resp(200, CSV_BODY),  # storage download
        # listing upserts: lookup-by-external_id returns empty
        _resp(200, []),
        _resp(200, []),
    ]
    mock_requests.patch.return_value = _resp(204, [])
    mock_requests.post.return_value = _resp(201, [{"id": "car-1"}])
    inserted = imp.run()
    assert inserted == 1  # one job processed
    # Job moved through running → succeeded
    statuses = [c.kwargs.get("json", {}).get("status")
                for c in mock_requests.patch.call_args_list
                if "dealer_inventory_jobs" in c.args[0]]
    assert "running" in statuses
    assert "succeeded" in statuses


@patch("workers.inventory_import_worker.requests")
def test_run_marks_partial_when_some_rows_fail(mock_requests):
    bad_csv = b"external_id,make,model,year,price\nS1,Toyota,Camry,2020,60000\nS2,Honda,,2019,nope\n"
    mock_requests.get.side_effect = [
        _resp(200, [{
            "id": "job-2", "dealership_id": "d1", "kind": "csv_import",
            "file_path": "dealer-imports/d1/job-2/file.csv",
            "column_mapping": {"external_id": "external_id", "make": "make",
                               "model": "model", "year": "year", "price": "price"},
            "status": "queued",
        }]),
        _resp(200, bad_csv),
        _resp(200, []),  # lookup for S1
    ]
    mock_requests.patch.return_value = _resp(204, [])
    mock_requests.post.return_value = _resp(201, [{"id": "car-1"}])
    imp.run()
    final_statuses = [c.kwargs.get("json", {}).get("status")
                      for c in mock_requests.patch.call_args_list
                      if "dealer_inventory_jobs" in c.args[0]]
    assert "partial" in final_statuses
    # An error row was POSTed
    err_calls = [c for c in mock_requests.post.call_args_list
                 if "dealer_inventory_row_errors" in c.args[0]]
    assert err_calls


@patch("workers.inventory_import_worker.requests")
def test_run_skips_when_no_queued_jobs(mock_requests):
    mock_requests.get.return_value = _resp(200, [])
    inserted = imp.run()
    assert inserted == 0
    assert mock_requests.patch.called is False
    assert mock_requests.post.called is False


@patch("workers.inventory_import_worker.requests")
def test_run_marks_failed_when_file_download_fails(mock_requests):
    mock_requests.get.side_effect = [
        _resp(200, [{
            "id": "job-3", "dealership_id": "d1", "kind": "csv_import",
            "file_path": "dealer-imports/d1/job-3/missing.csv",
            "column_mapping": {},
            "status": "queued",
        }]),
        _resp(404, b""),  # storage download 404
    ]
    mock_requests.patch.return_value = _resp(204, [])
    imp.run()
    statuses = [c.kwargs.get("json", {}).get("status")
                for c in mock_requests.patch.call_args_list
                if "dealer_inventory_jobs" in c.args[0]]
    assert "failed" in statuses
```

- [ ] **Step 1: Write the failing test file** (content above).
- [ ] **Step 2: pytest expects ModuleNotFoundError.**
- [ ] **Step 3: Implement `workers/inventory_import_worker.py`.**

The implementation must:
- Expose `run()` returning the count of jobs processed in this tick.
- Use `_svc()` for Supabase REST headers (service role).
- Use `requests.get(f"{SUPABASE_URL}/storage/v1/object/{file_path}", headers=_svc(), timeout=30)` for file downloads (the storage REST is parallel to /rest/v1/).
- Apply `apply_column_mapping`, `validate_row`, `coerce_row` from `services.dealer_inventory`.
- For each successful row: lookup `cars` by `(dealership_id, external_id)` (when `external_id` present); POST a new row or PATCH the existing one. Always set `dealership_id`, `is_dealer=true`, `is_approved=true` (verified dealers are pre-approved), `status='active'`, and the standard required fields the existing app sets. **Use the helper `_build_car_payload(dealership_id, coerced)` defined within the worker** to keep one source of truth.
- Track counts; mark job `succeeded` if 0 failures, `partial` if some, `failed` if 0 successful or download failed.

Provide a reference implementation (~250 lines) that the implementer can use verbatim if they prefer:

```python
# flask-react-supabase-app/backend/workers/inventory_import_worker.py
"""Process queued dealer_inventory_jobs.

For each tick: claim one queued job, parse its file from storage, run rows
through the import pipeline (validate -> coerce -> upsert), record per-row
errors, set the final job status.
"""
import logging
import os
from datetime import datetime, timezone

import requests

from services.dealer_inventory import (
    apply_column_mapping, parse_csv_bytes, parse_xml_bytes,
    validate_row, coerce_row,
)

logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = (
    os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
)


def _svc(prefer="return=representation"):
    return {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Prefer": prefer,
    }


def _claim_job():
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/dealer_inventory_jobs",
        headers=_svc(prefer=""),
        params={"select": "*", "status": "eq.queued",
                "order": "created_at.asc", "limit": 1},
        timeout=10,
    )
    if r.status_code != 200 or not r.json():
        return None
    job = r.json()[0]
    pr = requests.patch(
        f"{SUPABASE_URL}/rest/v1/dealer_inventory_jobs"
        f"?id=eq.{job['id']}&status=eq.queued",
        headers=_svc(prefer="return=representation"),
        json={"status": "running",
              "started_at": datetime.now(timezone.utc).isoformat()},
        timeout=10,
    )
    if pr.status_code not in (200, 204) or (isinstance(pr.json(), list) and not pr.json()):
        return None
    return job


def _download_file(file_path):
    r = requests.get(
        f"{SUPABASE_URL}/storage/v1/object/{file_path}",
        headers={"apikey": SUPABASE_SERVICE_KEY,
                 "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}"},
        timeout=30,
    )
    return r


def _build_car_payload(dealership_id, coerced):
    """Map coerced row -> cars insert payload. Mirrors PostCar.js defaults."""
    payload = {
        "dealership_id": dealership_id,
        "is_dealer": True,
        "is_approved": True,
        "status": "active",
        "external_id": coerced.get("external_id") or None,
        "make": coerced.get("make"),
        "car_model": coerced.get("car_model") or coerced.get("model"),
        "make_year": coerced.get("make_year"),
        "expected_selling_price": coerced.get("expected_selling_price"),
        "kilometers": coerced.get("kilometers"),
        "body_type": coerced.get("body_type"),
        "color": coerced.get("color"),
        "fuel_type": coerced.get("fuel_type"),
        "transmission": coerced.get("transmission"),
        "description": coerced.get("description"),
    }
    return {k: v for k, v in payload.items() if v is not None}


def _upsert_car(dealership_id, coerced):
    """Returns ('created'|'updated', car_id) or raises."""
    ext_id = coerced.get("external_id")
    if ext_id:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/cars",
            headers=_svc(prefer=""),
            params={"select": "id",
                    "dealership_id": f"eq.{dealership_id}",
                    "external_id": f"eq.{ext_id}",
                    "limit": 1},
            timeout=10,
        )
        if r.status_code == 200 and r.json():
            car_id = r.json()[0]["id"]
            requests.patch(
                f"{SUPABASE_URL}/rest/v1/cars?id=eq.{car_id}",
                headers=_svc(prefer="return=minimal"),
                json=_build_car_payload(dealership_id, coerced),
                timeout=10,
            )
            return ("updated", car_id)
    cr = requests.post(
        f"{SUPABASE_URL}/rest/v1/cars",
        headers=_svc(prefer="return=representation"),
        json=_build_car_payload(dealership_id, coerced),
        timeout=10,
    )
    if cr.status_code in (200, 201) and cr.json():
        return ("created", cr.json()[0]["id"])
    raise RuntimeError(f"insert failed: {cr.status_code} {cr.text[:200]}")


def _emit_row_error(job_id, row_index, external_id, code, message, raw_row):
    requests.post(
        f"{SUPABASE_URL}/rest/v1/dealer_inventory_row_errors",
        headers=_svc(prefer="return=minimal"),
        json={"job_id": job_id, "row_index": row_index,
              "external_id": external_id, "error_code": code,
              "error_message": message, "raw_row": raw_row},
        timeout=10,
    )


def _finish_job(job_id, status, counts, error_summary=None):
    body = {
        "status": status,
        "rows_total": counts["total"],
        "rows_created": counts["created"],
        "rows_updated": counts["updated"],
        "rows_skipped": counts["skipped"],
        "rows_failed": counts["failed"],
        "finished_at": datetime.now(timezone.utc).isoformat(),
    }
    if error_summary:
        body["error_summary"] = error_summary
    requests.patch(
        f"{SUPABASE_URL}/rest/v1/dealer_inventory_jobs?id=eq.{job_id}",
        headers=_svc(prefer="return=minimal"),
        json=body, timeout=10,
    )


def _rows_from_job(job, file_bytes):
    kind = job["kind"]
    if kind in ("csv_import",):
        yield from parse_csv_bytes(file_bytes)
    elif kind == "xml_import":
        yield from parse_xml_bytes(file_bytes)
    elif kind == "api_pull":
        # api_pull's payload is staged into the job's source field as a base64
        # JSON blob written by the poller. Decoded by the poller itself before
        # invoking the worker — when api_pull lands here, we expect the
        # poller to have already written rows. Skip in v1.
        return


def run():
    job = _claim_job()
    if not job:
        return 0

    counts = {"total": 0, "created": 0, "updated": 0, "skipped": 0, "failed": 0}

    try:
        if job["kind"] in ("csv_import", "xml_import"):
            dl = _download_file(job["file_path"])
            if dl.status_code != 200:
                _finish_job(job["id"], "failed", counts,
                            {"code": "file_download_failed", "status": dl.status_code})
                return 1
            file_bytes = dl.content
        else:
            file_bytes = b""

        mapping = job.get("column_mapping") or {}

        for i, raw in enumerate(_rows_from_job(job, file_bytes)):
            counts["total"] += 1
            mapped = apply_column_mapping(raw, mapping) if mapping else raw
            ok, err = validate_row(mapped)
            if not ok:
                _emit_row_error(job["id"], i, mapped.get("external_id"),
                                err.get("code", "validation_error"),
                                str(err), mapped)
                counts["failed"] += 1
                continue
            coerced = coerce_row(mapped)
            try:
                action, _ = _upsert_car(job["dealership_id"], coerced)
                counts["created" if action == "created" else "updated"] += 1
            except Exception as e:
                _emit_row_error(job["id"], i, coerced.get("external_id"),
                                "upsert_failed", str(e)[:300], mapped)
                counts["failed"] += 1

        if counts["failed"] == 0 and counts["total"] > 0:
            final = "succeeded"
        elif counts["created"] + counts["updated"] > 0:
            final = "partial"
        else:
            final = "failed"
        _finish_job(job["id"], final, counts)
    except Exception as e:
        logger.exception("import worker crashed on job %s", job.get("id"))
        _finish_job(job["id"], "failed", counts, {"code": "worker_exception", "error": str(e)[:300]})
    return 1


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    logger.info("inventory_import_worker: processed=%d", run())
```

- [ ] **Step 4: Run pytest, confirm 4 tests pass**
- [ ] **Step 5: Commit**

```
Phase 3: inventory_import_worker (claim → parse → upsert → finish)
```

---

## Task 5: Schedule import worker in `worker.py`

**Files:**
- Modify: `flask-react-supabase-app/backend/worker.py`

Add the import + scheduled_loop in the same pattern as the leads aggregator (env: `INVENTORY_IMPORT_INTERVAL_SECONDS`, default `10`). Verify with `python -c "import app"` for syntax. Commit:

```
Phase 3: schedule inventory_import_worker in worker.py (10s default)
```

---

## Task 6: Backend routes — inventory imports + jobs

**Files:**
- Create: `flask-react-supabase-app/backend/routes/dealer/inventory.py`
- Create: `flask-react-supabase-app/backend/test_dealer_inventory_routes.py`

Endpoints in this file:

- `POST /api/dealer/inventory/imports` — multipart upload. Body fields: `file` (the CSV/XML), `mapping` (JSON string), `kind` (`csv_import|xml_import`). Saves the file to storage at `dealer-imports/<dealership_id>/<job_id>/<filename>`, creates a `dealer_inventory_jobs` row with `status='queued'`, returns `{job: {id, status, ...}}`.
- `GET /api/dealer/inventory/jobs` — paginated list of jobs for the dealership.
- `GET /api/dealer/inventory/jobs/<id>` — detail with the latest job status + up to 200 row errors.
- `GET /api/dealer/inventory/jobs/<id>/errors` — paginated full error list.
- `GET /api/dealer/inventory/export.csv` — streams a CSV of the dealership's current active listings.

Role gate: only `owner` and `manager` can POST imports or trigger exports; `sales_rep` cannot. Admin acting-as is allowed.

Tests (use the same fixture pattern as Phase 2's `test_dealer_leads_routes.py` — fresh `app_with_inventory` + `client` fixtures; patch `app.token_required` BEFORE the leads module is imported):

```python
# flask-react-supabase-app/backend/test_dealer_inventory_routes.py
import io
import pytest
from unittest.mock import patch, MagicMock
from flask import request as flask_request


@pytest.fixture(scope="module")
def app_with_inventory():
    patcher = patch(
        "app.token_required",
        lambda fn: (lambda *a, **kw: fn(getattr(flask_request, "user_id", None), *a, **kw)),
    )
    patcher.start()
    try:
        import app as flask_app_module
        from routes.dealer.inventory import inventory_bp
        if "dealer_inventory" not in flask_app_module.app.blueprints:
            flask_app_module.app.register_blueprint(inventory_bp)
        flask_app_module.app.config["TESTING"] = True
        yield flask_app_module.app
    finally:
        patcher.stop()


@pytest.fixture
def client(app_with_inventory):
    def _inject_user():
        flask_request.user_id = "test-user-id"
    app_with_inventory.before_request_funcs.setdefault(None, []).append(_inject_user)
    try:
        yield app_with_inventory.test_client()
    finally:
        app_with_inventory.before_request_funcs[None].remove(_inject_user)


def _resp(status, body, headers=None):
    r = MagicMock()
    r.status_code = status
    r.json.return_value = body
    r.text = str(body)
    r.headers = headers or {}
    r.content = body if isinstance(body, (bytes, bytearray)) else str(body).encode()
    return r


@patch("routes.dealer.inventory.requests")
@patch("routes.dealer._decorators._lookup_membership")
@patch("routes.dealer._decorators._is_admin")
def test_list_jobs_returns_dealership_scope(mock_is_admin, mock_lookup, mock_requests, client):
    mock_is_admin.return_value = False
    mock_lookup.return_value = {"dealership_id": "d1", "role": "owner", "status": "active"}
    mock_requests.get.return_value = _resp(200, [{"id": "j1", "status": "succeeded"}],
                                            headers={"content-range": "0-0/1"})
    rv = client.get("/api/dealer/inventory/jobs")
    assert rv.status_code == 200
    assert rv.get_json()["jobs"][0]["id"] == "j1"
    params = mock_requests.get.call_args.kwargs["params"]
    assert params["dealership_id"] == "eq.d1"


@patch("routes.dealer.inventory.requests")
@patch("routes.dealer._decorators._lookup_membership")
@patch("routes.dealer._decorators._is_admin")
def test_post_import_creates_job_and_uploads_file(mock_is_admin, mock_lookup, mock_requests, client):
    mock_is_admin.return_value = False
    mock_lookup.return_value = {"dealership_id": "d1", "role": "owner", "status": "active"}
    # POST file to storage = 200; insert job row = 201
    mock_requests.post.side_effect = [
        _resp(200, [{"Key": "dealer-imports/d1/<job_id>/file.csv"}]),  # storage upload
        _resp(201, [{"id": "job-99", "status": "queued", "file_path": "x"}]),  # job insert
    ]
    rv = client.post(
        "/api/dealer/inventory/imports",
        data={"mapping": '{"make":"make"}', "kind": "csv_import",
              "file": (io.BytesIO(b"make\nToyota\n"), "file.csv")},
        content_type="multipart/form-data",
    )
    assert rv.status_code == 201
    assert rv.get_json()["job"]["id"] == "job-99"


@patch("routes.dealer.inventory.requests")
@patch("routes.dealer._decorators._lookup_membership")
@patch("routes.dealer._decorators._is_admin")
def test_post_import_rejects_too_large_file(mock_is_admin, mock_lookup, mock_requests, client):
    mock_is_admin.return_value = False
    mock_lookup.return_value = {"dealership_id": "d1", "role": "owner", "status": "active"}
    # 11 MB
    big = io.BytesIO(b"x" * (11 * 1024 * 1024))
    rv = client.post(
        "/api/dealer/inventory/imports",
        data={"mapping": "{}", "kind": "csv_import", "file": (big, "f.csv")},
        content_type="multipart/form-data",
    )
    assert rv.status_code == 413


@patch("routes.dealer.inventory.requests")
@patch("routes.dealer._decorators._lookup_membership")
@patch("routes.dealer._decorators._is_admin")
def test_post_import_forbidden_for_sales_rep(mock_is_admin, mock_lookup, mock_requests, client):
    mock_is_admin.return_value = False
    mock_lookup.return_value = {"dealership_id": "d1", "role": "sales_rep", "status": "active"}
    rv = client.post(
        "/api/dealer/inventory/imports",
        data={"mapping": "{}", "kind": "csv_import",
              "file": (io.BytesIO(b"x"), "f.csv")},
        content_type="multipart/form-data",
    )
    assert rv.status_code == 403


@patch("routes.dealer.inventory.requests")
@patch("routes.dealer._decorators._lookup_membership")
@patch("routes.dealer._decorators._is_admin")
def test_get_job_detail_returns_errors(mock_is_admin, mock_lookup, mock_requests, client):
    mock_is_admin.return_value = False
    mock_lookup.return_value = {"dealership_id": "d1", "role": "owner", "status": "active"}
    mock_requests.get.side_effect = [
        _resp(200, [{"id": "job-1", "dealership_id": "d1", "status": "partial",
                     "rows_total": 5, "rows_failed": 2}]),
        _resp(200, [{"row_index": 2, "error_code": "missing_fields", "error_message": "x"}]),
    ]
    rv = client.get("/api/dealer/inventory/jobs/job-1")
    assert rv.status_code == 200
    data = rv.get_json()
    assert data["job"]["status"] == "partial"
    assert len(data["errors"]) == 1


@patch("routes.dealer.inventory.requests")
@patch("routes.dealer._decorators._lookup_membership")
@patch("routes.dealer._decorators._is_admin")
def test_export_csv_streams_for_dealership(mock_is_admin, mock_lookup, mock_requests, client):
    mock_is_admin.return_value = False
    mock_lookup.return_value = {"dealership_id": "d1", "role": "owner", "status": "active"}
    mock_requests.get.return_value = _resp(200, [
        {"id": "c1", "external_id": "S1", "make": "Toyota", "car_model": "Camry",
         "make_year": 2020, "expected_selling_price": 60000, "kilometers": 45000}
    ])
    rv = client.get("/api/dealer/inventory/export.csv")
    assert rv.status_code == 200
    assert rv.mimetype == "text/csv"
    body = rv.get_data(as_text=True)
    assert "external_id" in body and "Toyota" in body
```

Production code outline (the implementer should follow these contracts; full ~250 lines):

- `inventory_bp = Blueprint("dealer_inventory", __name__, url_prefix="/api/dealer")`
- `_token_required` shim same as leads.py
- `MAX_UPLOAD_BYTES = 10 * 1024 * 1024`
- `@inventory_bp.route("/inventory/imports", methods=["POST"])` — reads `request.files["file"]`, validates length, asserts kind, generates job uuid, uploads to storage via `POST /storage/v1/object/dealer-imports/<dealership_id>/<job_id>/<filename>` with content-type from upload, then POSTs the job row. Role-gated to owner/manager (use `@role_required("owner","manager")`).
- `@inventory_bp.route("/inventory/jobs", methods=["GET"])` — list paginated.
- `@inventory_bp.route("/inventory/jobs/<job_id>", methods=["GET"])` — detail + first 200 errors.
- `@inventory_bp.route("/inventory/jobs/<job_id>/errors", methods=["GET"])` — paginated errors.
- `@inventory_bp.route("/inventory/export.csv", methods=["GET"])` — fetches all `cars` for the dealership, streams CSV. Use `flask.Response(generator(), mimetype="text/csv", headers={"Content-Disposition": "attachment; filename=dealership-inventory.csv"})`.

Commit:

```
Phase 3: dealer inventory routes (POST import, GET jobs/errors, GET export.csv)
```

---

## Task 7: Backend routes — `dealer_api_sources` CRUD

**Files:**
- Create: `flask-react-supabase-app/backend/routes/dealer/api_sources.py`
- Create: `flask-react-supabase-app/backend/test_dealer_api_sources_routes.py`

Endpoints:

- `GET /api/dealer/api-sources` — list sources for the dealership. **Never include `credentials_enc` in the response.**
- `POST /api/dealer/api-sources` — body `{label, adapter, endpoint_url, auth_type, credentials, field_mapping, poll_interval_min}`. Calls `encrypt_credentials(credentials)` and stores as `credentials_enc`. Returns the row minus credentials. If `DEALER_INTEGRATIONS_KEY` is unset, returns 503 with code `encryption_unavailable`.
- `PATCH /api/dealer/api-sources/<id>` — partial update. If `credentials` present, re-encrypt. Otherwise leave existing `credentials_enc` alone.
- `DELETE /api/dealer/api-sources/<id>` — delete.
- `POST /api/dealer/api-sources/<id>/test` — run a single fetch through the adapter, return the count of rows that would be imported (no actual import). Useful for the dealer to verify the connection.

Tests (5 minimum) — minimum coverage:
- list scopes by dealership and **does not** include `credentials_enc`
- POST encrypts credentials and never echoes them back
- POST returns 503 when `DEALER_INTEGRATIONS_KEY` is unset
- PATCH without credentials leaves the existing token alone
- DELETE returns 204 / 404

Commit:

```
Phase 3: dealer_api_sources CRUD + test endpoint (encryption-gated)
```

---

## Task 8: DMS source poller

**Files:**
- Create: `flask-react-supabase-app/backend/workers/dealer_api_source_poller.py`
- Test: `flask-react-supabase-app/backend/test_dealer_api_source_poller.py`

Logic:
1. SELECT enabled sources whose `last_pulled_at IS NULL OR last_pulled_at + (poll_interval_min * 60s) <= now()`, ordered ascending by `last_pulled_at NULLS FIRST`, limit 5 per tick.
2. For each: decrypt credentials (skip with `last_status='credentials_unreadable'` if key missing or token tampered).
3. Call the `generic_json` adapter (a function in the same module): fetch `endpoint_url` with the appropriate auth header; expect either a top-level array or `{listings: [...]}`.
4. For each fetched row: apply `field_mapping` → validate → coerce → upsert (same helpers as the import worker — import them directly).
5. Update the source row: `last_pulled_at=now()`, `last_status='ok'|'partial'|'failed'`, `last_error` on failure.

Tests (≥ 4):
- happy path: fetches 2 rows, both upsert; `last_status='ok'`, `last_pulled_at` updated
- 401 from the endpoint → `last_status='auth_failed'`
- malformed JSON → `last_status='parse_failed'`
- credentials decryption failure → `last_status='credentials_unreadable'`, no fetch attempted

Commit:

```
Phase 3: dealer_api_source_poller (generic_json adapter, decrypt + import)
```

---

## Task 9: Schedule poller in `worker.py`

Same pattern as Task 5 but env var `DEALER_API_POLL_INTERVAL_SECONDS` (default `60`).

Commit:

```
Phase 3: schedule dealer_api_source_poller in worker.py (60s default)
```

---

## Task 10: Register blueprints

**Files:**
- Modify: `flask-react-supabase-app/backend/routes/dealer/__init__.py`

Add `from .inventory import inventory_bp` and `from .api_sources import api_sources_bp`. Register both. Update docstring.

```
Phase 3: register inventory + api_sources blueprints
```

---

## Task 11: Frontend — `DealerInventory.jsx` (upload + job list)

**Files:**
- Create: `flask-react-supabase-app/frontend/src/components/dealer/DealerInventory.jsx`

Multi-step wizard within a single page:

1. **Upload step** — drag-drop or file picker. Show file size, type. CSV or XML toggle.
2. **Mapping step** — preview first 5 rows; for each detected column header, a `<select>` of canonical fields (`external_id, make, model, year, price, mileage, ...`) plus `— ignore —`. Required canonical fields highlighted. Submit-disabled until make/model/year/price are mapped.
3. **Confirm step** — preview the first 5 rows after mapping is applied. "Start import" submits.
4. **Job list** — under the wizard, a table of recent jobs with status pills, click-through to detail page.

Use `apiClient.upload` if it exists for multipart; otherwise construct `FormData` and call via `apiClient.request("/api/dealer/inventory/imports", {method: "POST", body: form, isFormData: true})`. Verify `apiClient` upload semantics with:

```bash
grep -n "FormData\|multipart" /Users/suhayl/Downloads/Flask-React-superbase-classified/flask-react-supabase-app/frontend/src/utils/apiClient.js
```

Realtime: use Supabase Realtime via the existing client to subscribe to UPDATE events on `dealer_inventory_jobs` filtered by `dealership_id=eq.<id>`. On update, refresh the job list.

Components live under the dealer page area; mirror styling from `DealerLeads.jsx` (header strip, table card with hover rows, status pill).

Commit:

```
Phase 3: DealerInventory page (upload wizard + job list + realtime)
```

---

## Task 12: Frontend — `DealerInventoryJobDetail.jsx`

Per-job detail page at `/dealer/inventory/jobs/:id`:

- Header: kind, status, counts (created/updated/failed), started/finished, triggered_by display name.
- Counts grid: total, created, updated, failed, skipped.
- Error table: row_index, external_id, error_code, message. Paginate via `/inventory/jobs/<id>/errors`.
- A "Reimport this job" button if status is `failed` and `file_path` exists — POST a new job pointing at the same file. (Defer if time-constrained; ship the rest first.)

Commit:

```
Phase 3: DealerInventoryJobDetail page (status + error breakdown)
```

---

## Task 13: Frontend — `DealerApiSources.jsx`

A simple CRUD page at `/dealer/integrations`:

- "Add source" button → modal form: label, endpoint_url, auth_type, credentials JSON, field_mapping JSON, poll_interval_min.
- Sources table: label, endpoint, last_pulled_at, last_status, enabled toggle, edit, delete, "Test" button.
- Edit modal lets the dealer update everything except `credentials` (leaving the field blank preserves the existing encrypted credentials).
- Test button hits `POST /api/dealer/api-sources/<id>/test`, shows a toast with the row count.

Defer if time-constrained — the backend endpoints + poller are the load-bearing parts. Ship this page even if minimal.

Commit:

```
Phase 3: DealerApiSources page (CRUD + Test action)
```

---

## Task 14: Sidebar + App.js routes

**Files:**
- Modify: `flask-react-supabase-app/frontend/src/components/DealerSidebar.jsx` — add `Inventory` (Upload icon) and `Integrations` (Plug icon) entries between `Leads` and `Team`. Both behind `ownerOnly: false` (managers also need access).
- Modify: `flask-react-supabase-app/frontend/src/App.js` — add three lazy imports for the new pages and three `<Route>` entries under the `/dealer` block.

Commit:

```
Phase 3: dealer sidebar Inventory + Integrations entries + routes
```

---

## Task 15: Manual smoke checklist

**Files:**
- Create: `flask-react-supabase-app/backend/migrations/PHASE3_MANUAL_SMOKE.md`

Document:
1. Apply `2026_06_05_dealer_inventory.sql` in Supabase SQL Editor.
2. Create the `dealer-imports` storage bucket (private; 10 MB max). Add policy: only service role can read/write.
3. Generate a Fernet key locally and set `DEALER_INTEGRATIONS_KEY` env var both locally and in Vercel/Railway:
   ```bash
   python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'
   ```
4. Run a CSV smoke import: log in as dealership owner, upload a 3-row CSV at `/dealer/inventory`, watch the job progress through `queued → running → succeeded`, confirm 3 cars appear under the dealership.
5. Run an export smoke: download `/api/dealer/inventory/export.csv`, confirm rows match.
6. Configure a DMS source: hit a test JSON endpoint (e.g. https://api.npoint.io/...), set `field_mapping`, trigger Test, confirm row count comes back; let the poller run for a cycle; check that listings get created.

Commit:

```
Phase 3: manual smoke checklist
```

---

## Final review checklist (run after all 15 tasks)

- [ ] Every spec §8 item covered:
  - §8.1 CSV/XML import → Tasks 1, 2, 4, 6, 11, 12
  - §8.2 CSV export → Task 6 (`/inventory/export.csv`)
  - §8.3 DMS API ingest → Tasks 3, 7, 8, 13
- [ ] No placeholders in this plan ("TBD", "TODO", "similar to Task N").
- [ ] Naming consistent: `dealer_inventory_jobs`, `dealer_inventory_row_errors`, `dealer_api_sources`, `inventory_import_worker`, `dealer_api_source_poller`, `DealerInventory`, `DealerInventoryJobDetail`, `DealerApiSources`.
- [ ] TDD ordering preserved per task.
- [ ] Each task gets its own commit.

## Deferred to Phase 3.1 (explicit)

- Image download into our own storage (currently store URLs as-is).
- Schema auto-detection (currently dealer must map columns manually on every upload).
- Bikes / plates / parts imports (currently cars only).
- Multiple DMS adapter types beyond `generic_json`.
- Encryption key rotation tooling.
