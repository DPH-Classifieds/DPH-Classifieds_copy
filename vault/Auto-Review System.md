# Auto-Review System

Automatically approves or queues listings to manual review without admin intervention.

## Toggle

Controlled by Redis key `ar:enabled` (set via Admin Tools toggle).  
Falls back to env var `AUTO_REVIEW_WORKER_ENABLED` when Redis is unavailable.

```python
def _auto_review_enabled() -> bool:
    # Redis → env var
```

When enabled, new listings land at `pending_auto_review` instead of `pending`.  
`_trigger_auto_review_async()` fires in a background thread immediately after every listing POST.

## Entry points

1. **Immediate** — `_trigger_auto_review_async()` called at end of each create endpoint
2. **Scheduled** — `worker.py` polls on a loop (adaptive backoff)
3. **Admin Run Now** — `POST /api/admin/auto-review/run` (bypasses enabled check, always runs)

## Decision pipeline (`services/auto_review/rules.py`)

```
Step 1 — Hard blockers
  profanity_detected
  face_detected_in_image     (vision provider required)
  nsfw_image                 (vision provider required)
  contact_info_in_image
  duplicate
  price_outlier
  user_under_review

Step 2 — VIN gate (cars + bikes only)
  vin_format_invalid         (bad 17-char format; empty VIN = PASS)
  vin_checksum_invalid
  vin_decoder_unavailable
  vin_make_mismatch
  vin_model_mismatch
  vin_year_mismatch

Step 4 — Trust tier
  no_trust_tier
```

Any reason → `auto_queued` → downgrade to `pending` for manual review.  
No reasons → `auto_approved` → listing goes live.

## Trust tiers

| Tier | Condition |
|------|-----------|
| `admin` | `is_admin = true` |
| `dealer_verified` | Approved trade license + VAT cert + owner ID |
| `clean_individual` | ≥3 approved listings, 0 rejections + reports in 90d |
| `email_verified` | Email verified in `users` table |

## Vision provider

`AUTO_REVIEW_VISION_PROVIDER` env var:
- `null` (default) — `NullVisionProvider`, skips image checks (pass-through)
- `google` — `GoogleVisionProvider` (stub, not yet wired)

> When no vision provider is configured, image checks are skipped entirely — listings are not blocked for having images.

## Worker files

```
backend/workers/auto_review_worker.py   — I/O wiring + run()
backend/services/auto_review/
    rules.py          — pure composer
    trust.py          — TrustContext / evaluate_trust()
    vin_gate.py       — evaluate_vin()
    hard_blockers.py  — profanity, image blockers
    vision.py         — VisionResult, NullVisionProvider, GoogleVisionProvider
    decision.py       — Decision dataclass
```

## Admin UI

- **Admin Tools → Auto Review** — toggle on/off, Run Now button
- **Admin Listings header** — "Run Auto-Review" button (visible from listings list)
- **Admin Listing Detail** — amber banner shows on `pending_auto_review` or `auto_queued` listings with reasons + Run Now button

## DB table

`auto_review_decisions` — records every decision:
- `listing_type`, `listing_id`, `decision` (`approved`/`queued`), `reasons[]`, `signals{}`
