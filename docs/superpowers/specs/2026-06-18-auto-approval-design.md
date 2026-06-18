# Auto-Approval for Listings — Design

## Goal

Replace the manual admin approval step for the four listing types (cars, bikes, car_parts, license_plates). A deterministic rule engine decides, at submit time, whether a listing can go live without human review. If any rule fails, the listing falls through to the existing pending admin queue with labeled reasons attached.

## Non-goals

- Auto-rejection. No listing is ever auto-rejected; failures land in the human queue (per product decision).
- Replacing dealer-document verification, listing-limit enforcement, or whatsapp/phone alignment, which already gate `create_car`/`create_bike`/`create_part`/`create_plate`. Those remain.
- Replacing the registration-OCR fallback path used by `PostCar.js`. That is an unrelated bug (`listing_verification_scans` table missing in prod Supabase) — tracked separately.

## High-level flow

- Seller submits a listing.
- POST handler runs **Step 0 (sync gate)**: required-field and format validation. Any failure → 400 (today's behavior).
- If Step 0 passes, the row is inserted with `status='pending_auto_review'` and `auto_review_state='auto_queued'`. The seller sees "Your listing is being reviewed."
- A worker picks the row up (sub-second to seconds latency) and runs Steps 1–4.
- On full pass → `_perform_approval(item_type, item_id, actor='auto', ...)`: same code path the admin's manual approve takes, so DB write + email + Redis cache invalidation + lifecycle scheduling stay identical.
- On any failure → row stays at `status='pending'`, `auto_review_state='auto_queued'`, `auto_review_reasons=[<labels>]`, and a row is appended to a new `auto_review_decisions` audit table.

## The formula (deterministic ladder)

### Step 0 — Sync gate (POST handler)

- All required fields present, non-empty, type-valid.

  - **Car:** `make`, `model`, `make_year` (int, `MIN_ALLOWED_YEAR..now+1`), `kilometer_driven` (int ≥ 0), `expected_selling_price` (int ≥ minimum), `vin` (17 chars, `VIN_ALLOWED_RE`), `transmission_type` ∈ {Automatic, Manual}, `fuel_type` in allowed set, `regional_spec`, `body_type`, `color`, `area`/`car_city`, `car_owner_phone_number`, `whatsapp_number`, `whatsapp_prefill_text`, `car_description` (word-count + profanity), **≥ 4 photos**.
  - **Bike:** `bike_brand`, `bike_model`, `make_year`, `kilometer_driven`, `price`, `engine_size`, `vin` (17 chars), `area`, `contact_number`, `whatsapp_number`, `whatsapp_prefill_text`, `description` (word-count + profanity), **≥ 3 photos**.
  - **Part:** `name`, `part_type`, `price`, `condition` ∈ {New, Used}, `area`, `contact_number`, `description` (word-count + profanity), **≥ 2 photos**.
  - **Plate:** `city`, `code`, `digits` (1–5), `price` (int ≥ 0), `contact_phone`, `whatsapp_number`, `description` (profanity-checked), **≥ 1 photo**.

- Phone alignment (`_require_whatsapp_prefill_and_phone_alignment`) — already enforced.
- Listing-limit (`_enforce_listing_limit`) and dealer-verification (`_require_dealer_verified`) — already enforced.

Pass → insert with `status='pending_auto_review'`. Fail → 400.

### Step 1 — Hard blockers (worker, must all be clean)

| Check | Pass condition | Fail label |
|---|---|---|
| Profanity | `_validate_no_profanity` clean on all text fields | `profanity_detected` |
| Contact info in images | No phone (`\+?\d[\d\s\-]{7,}`), email, or social handle text found via OCR on any image | `contact_info_in_image` |
| NSFW / unsafe | Vision provider returns `adult/violence/racy` < likely on every image | `nsfw_image` |
| **No faces in images** | Vision provider returns `face_count == 0` on every image (confidence ≥ `AUTO_REVIEW_FACE_CONFIDENCE_THRESHOLD`, default **0.6**) — applies to **all four types** | `face_detected_in_image` |
| Not a duplicate | Cars/bikes: no other approved listing by same user with same VIN in last 90 days. Plates: no `(plate_format, code, number)` collision in last 90 days | `duplicate_listing` |
| Price sanity (cars/bikes only) | `0.2× ≤ price ≤ 5×` median for same make+model+year over last 90 days; skipped if < 5 comparables | `price_outlier` |
| Seller not banned/under report | `users.is_banned != true` and no open report against `user_id` | `user_under_review` |

### Step 2 — VIN gate (cars + bikes only)

- `vin` matches `VIN_ALLOWED_RE` → else `vin_format_invalid`
- `VINDecoder.is_checksum_valid(vin)` → else `vin_checksum_invalid`
- `decoder.validate_and_decode(vin)` returns non-empty decoded → else `vin_decoder_unavailable`
- Decoded `make` substring-matches form make (case-insensitive) → else `vin_make_mismatch`
- Decoded `model` substring-matches form model (case-insensitive) → else `vin_model_mismatch`
- Decoded `model_year` equals form `make_year` ± 1 → else `vin_year_mismatch`

All six required.

### Step 3 — Image gate

- Image count ≥ minimum from Step 0.
- Each image ≥ 800 × 600 px and not uniform/blank (variance check) → `low_quality_image`
- ≥ 1 image with a vehicle detected (cars/bikes only) → `no_vehicle_in_images`
- No perceptual-hash duplicate of an image already used in another approved listing → `image_reuse`

### Step 4 — Trusted seller gate (≥ 1 tier matches)

- **A:** `users.is_admin = true`
- **B:** Dealer verified — all 3 verification docs `status='approved'` (per `app.py:4124`)
- **C:** Individual with ≥ 3 prior approvals (any type), 0 rejections in last 90 d, 0 reports in last 90 d
- **D:** Email-verified user (`users.email_verified = true`)

### Final decision

```
auto_approve  ⇔  Step 0 passed (pre-worker)
               ∧ every Step 1 check clean
               ∧ (type ∈ {part, plate}  OR  every Step 2 check passes)
               ∧ every Step 3 check passes
               ∧ at least one Step 4 tier matches
```

Pass → `_perform_approval(item_type, item_id, actor='auto', actor_id='auto_review_worker', signals=<recorded>)`.
Fail → `PATCH status='pending'`, `auto_review_state='auto_queued'`, `auto_review_reasons=[labels]`; append `auto_review_decisions` row.

## Data model changes

- **All four listing tables** (`cars`, `bikes`, `car_parts`, `license_plates`):
  - `auto_review_state text NULL` — `'auto_approved' | 'auto_queued' | 'auto_failed' | NULL`
  - `auto_review_reasons jsonb NOT NULL DEFAULT '[]'::jsonb`
  - `auto_review_decided_at timestamptz NULL`
- **New table** `public.auto_review_decisions` — append-only audit:
  - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
  - `listing_type text NOT NULL`
  - `listing_id text NOT NULL`
  - `decision text NOT NULL`  -- `'approved' | 'queued'`
  - `reasons jsonb NOT NULL DEFAULT '[]'::jsonb`
  - `signals jsonb NOT NULL DEFAULT '{}'::jsonb`  -- raw inputs (VIN decoded vals, vision response summary, trust tier matched, etc.)
  - `created_at timestamptz NOT NULL DEFAULT now()`
  - Indexes on `(listing_type, listing_id)`, `(decision, created_at)`
  - RLS enabled, no public policies (service-role-only writes)

Two new status values: `'pending_auto_review'` is added to the `LISTING_ACTIVE_STATUSES` exclusion path (i.e. NOT in active statuses; still not publicly visible). Existing `'pending'` and `'approved'` semantics unchanged.

## Architecture

```
backend/
  services/
    auto_review/
      __init__.py
      rules.py           # pure-logic: takes (listing dict, signals dict) → Decision
      decision.py        # dataclasses: Decision, FailReason, Signals
      vision.py          # VisionProvider protocol, NullVisionProvider, GoogleVisionProvider stub
      trust.py           # seller tier evaluation (data-only helpers; injected supabase_request)
      duplicates.py      # duplicate-listing + image-hash checks (injected supabase_request)
      price.py           # price-band check (injected supabase_request)
  workers/
    auto_review_worker.py  # run() entrypoint matching existing worker pattern
  migrations/
    add_auto_review_columns.sql
    add_auto_review_decisions.sql

  app.py changes:
    - LISTING_ACTIVE_STATUSES unchanged
    - _perform_approval(item_type, item_id, actor, actor_id, signals=None) extracted from api_approve_item
    - api_approve_item rewritten to thin wrapper calling _perform_approval(actor='admin', actor_id=current_user)
    - create_car/create_bike/create_part/create_plate: on insert success, if listing is auto-review-eligible, set status='pending_auto_review' instead of 'pending'
```

The rule engine is **pure**: every external dependency (supabase, vision provider, vin decoder, clock) is injected. Worker glue code is the only thing that touches I/O.

## Provider abstraction

```python
class VisionProvider(Protocol):
    def analyze(self, image_bytes: bytes) -> VisionResult: ...

@dataclass
class VisionResult:
    available: bool          # False ⇒ provider failed / not configured
    nsfw_likely: bool        # adult / violence / racy
    face_count: int
    contains_vehicle: bool   # object detection label
    contact_text: list[str]  # OCR strings matching phone/email/social regex
```

- `NullVisionProvider` returns `VisionResult(available=False, ...zeroes...)`. The worker treats `available=False` as **soft fail → human queue** (never auto-approve without vision). This means in dev/test with no key, *everything* drops to manual review, which is safe.
- `GoogleVisionProvider` calls Google Cloud Vision `annotate` with `FACE_DETECTION + SAFE_SEARCH_DETECTION + OBJECT_LOCALIZATION + TEXT_DETECTION` features in one request per image. One round-trip per photo.
- Future providers (`SightengineProvider`, `RekognitionProvider`) implement the same protocol.

Provider selection: `AUTO_REVIEW_VISION_PROVIDER` env var (`null` default, `google` opts in).

## Worker contract

`workers/auto_review_worker.py::run()` matches the existing worker shape used by `worker.py::scheduled_loop`. Each tick:

1. Query each of the 4 listing tables for `status='pending_auto_review' AND auto_review_decided_at IS NULL`, `LIMIT 20` per type, oldest first.
2. For each row, load the listing's images (URLs from existing `<table>_images`), invoke vision provider on each, compute Steps 1–4 via `rules.evaluate(listing, signals)`.
3. Dispatch to `_perform_approval(...)` or write the "queued" outcome.
4. Return the total count handled this tick so `scheduled_loop`'s adaptive backoff works (it doubles the wait when idle).

Worker is registered in `worker.py::main()` alongside the existing `webhook_delivery_worker` etc., gated by `AUTO_REVIEW_WORKER_ENABLED` env var (default `true` once code lands).

## Observability

- Every decision writes to `auto_review_decisions` with `signals` JSON (vision summary, tier matched, VIN decoded, price-band stats). This is the ground truth for "why did the worker do X."
- The existing `/api/admin/approve/<type>` queue endpoint enriches rows with `auto_review_reasons` so the admin sees the failure labels at a glance.
- Logger: `dph-auto-review` namespace; every queued/approved listing logs `decision=… listing_type=… listing_id=… reasons=[…] tier=…`.

## Rollout

- Phase 1: Code lands, migrations applied, worker stays disabled (`AUTO_REVIEW_WORKER_ENABLED=false`). New POST inserts keep using `status='pending'`. No behavior change.
- Phase 2: Enable worker in **dry-run** (`AUTO_REVIEW_DRY_RUN=true`) — worker evaluates everything, writes `auto_review_decisions` rows, but never flips status. Admin queue gets `auto_review_reasons` annotations to evaluate the rules' precision.
- Phase 3: After ~1 week of dry-run, flip `AUTO_REVIEW_DRY_RUN=false`. Worker now actually auto-approves.
- Kill switch: setting `AUTO_REVIEW_WORKER_ENABLED=false` stops new auto-approvals immediately; in-flight rows remain at `pending_auto_review` until the worker is re-enabled or an admin manually approves them.

## Open dependencies

1. **Vision API key** — not blocked for code landing (NullProvider works), but real auto-approvals require a Google Cloud Vision key (or another provider implementing the protocol).
2. **OCR `listing_verification_scans` table** — separate bug; needed to fix the existing OCR 500 but unrelated to auto-approval.
3. **Photo URL fetching** — worker needs to download images from storage to feed bytes into the vision API. Storage URLs are already public on approved listings; for `pending_auto_review` we may need signed URLs via the service-role key. Captured as the first task in the worker section of the plan.

## Test plan (local)

- **Pure rule engine** — `unittest` suite covering every fail label in Steps 1–4 with fixtures per listing type. Inject fake providers.
- **Provider abstraction** — `NullVisionProvider` returns `available=False`; `GoogleVisionProvider` is mocked at the HTTP layer with `responses` library style.
- **Worker** — happy path (approves), each failure path (queues with right reason), DB write idempotency (worker crash mid-flight does not double-approve).
- **Helper refactor** — golden-master test: old `api_approve_item` and new `_perform_approval` produce identical Supabase calls + email payload for the same input.
- **POST handler wiring** — mocked `supabase_request` confirms new inserts get `status='pending_auto_review'`.
- Out of scope locally: real vision API, real Supabase, end-to-end browser test.
