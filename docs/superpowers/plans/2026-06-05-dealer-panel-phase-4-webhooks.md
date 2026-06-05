# Dealer Panel — Phase 4: Outbound Webhooks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let dealerships register webhook endpoints that receive HMAC-signed JSON payloads when meaningful events happen (lead created, lead status changed, listing sold, listing view milestone). Deliveries are queued, signed, retried with exponential backoff, and dead-lettered after the final attempt — all visible in a UI delivery log.

**Architecture:** A new `routes/dealer/webhooks.py` blueprint serves CRUD + send-test endpoints. Webhook signing secrets are envelope-encrypted with Fernet (same pattern Phase 3 uses for DMS credentials). Events are queued by a thin `services/webhook_dispatcher.py` helper called from the event sites — it INSERTs one `dealer_webhook_deliveries` row per enabled webhook subscribed to that event type. A background `webhook_delivery_worker` polls pending deliveries, POSTs to the URL with a `X-DPH-Signature: sha256=<hex>` header (HMAC over the raw body using the per-webhook secret), records the response code/body, and reschedules with exponential backoff on failure (1m, 5m, 25m, 2h, 12h — max 5 attempts) before moving to dead-letter.

**Tech stack:**
- Backend: Flask blueprint, `requests` against Supabase REST (service role), pytest
- Worker: pure-Python loop registered through `worker.py:scheduled_loop`
- Encryption: `cryptography.fernet.Fernet` (add to requirements if not present from Phase 3)
- Signing: stdlib `hmac` + `hashlib`
- Frontend: React + apiClient + Tailwind, mirrors Phase 1–3 dealer components

**References:**
- Spec: `docs/superpowers/specs/2026-06-03-dealer-admin-panel-design.md` §3.1 (data model), §9 (Phase 4)
- Phase 1 / 2 / 3 patterns to mirror: `routes/dealer/{core,analytics,inventory,api_sources}.py`, `workers/{dealer_kpi_aggregator,dealer_api_source_poller}.py`

**Design decisions:**
1. **Event types in v1** (a closed allow-list — adding more is a one-line config change later):
   - `lead.created`
   - `lead.status_changed`
   - `lead.assigned`
   - `listing.sold` (when `cars.sold_status` flips to `sold_on_dph`)
   - `listing.view_milestone` (when a listing crosses 100, 500, 1000, 5000 lifetime views — deferred event source, just declare the type)
   - `inventory.import_completed` (Phase 3 hook, opt-in)
2. **Signing**: `X-DPH-Signature: sha256=<hex>` where hex = `HMAC-SHA256(secret, raw_request_body)`. Dealers verify by recomputing.
3. **Retry schedule**: attempts at +1m, +5m, +25m, +2h, +12h (≈ 5 attempts over ~15h). After attempt 5, status `dead_letter`.
4. **Timeouts**: 10s connect + 10s read. Anything else → `failed`, scheduled for retry.
5. **Idempotency**: each delivery row carries a UUID `delivery_id`; we send it as `X-DPH-Delivery: <uuid>` so the receiver can dedupe.
6. **Encryption key**: reuse `DEALER_INTEGRATIONS_KEY` (the same Fernet key Phase 3 introduced). If Phase 3 isn't merged yet, this branch's migration + helper introduces it.

---

## File structure

### Create
- `backend/migrations/2026_06_05_dealer_webhooks.sql` — `dealer_webhooks`, `dealer_webhook_deliveries` tables, RLS, indexes, realtime publication.
- `backend/services/dealer_secrets.py` — Fernet helpers (encrypt/decrypt + KeyMissingError). May overlap with Phase 3's `dealer_credentials.py`; if Phase 3 merges first, drop this file and import from `dealer_credentials`.
- `backend/test_dealer_secrets_service.py` — unit tests.
- `backend/services/webhook_dispatcher.py` — queue helper `dispatch(event_type, dealership_id, payload)`. Pure-ish (writes to DB but no fancy logic; one helper function).
- `backend/test_webhook_dispatcher.py` — unit tests with mocked Supabase.
- `backend/services/webhook_signing.py` — pure HMAC helper. No I/O.
- `backend/test_webhook_signing_service.py` — unit tests.
- `backend/workers/webhook_delivery_worker.py` — polls pending deliveries, signs, POSTs, retries.
- `backend/test_webhook_delivery_worker.py` — pytest mocking requests + Supabase.
- `backend/routes/dealer/webhooks.py` — CRUD + send-test.
- `backend/test_dealer_webhooks_routes.py` — pytest using the same fixtures pattern as Phase 2/3 routes.
- `frontend/src/components/dealer/DealerWebhooks.jsx` — webhooks page (list + add/edit modal + delivery log).
- `backend/migrations/PHASE4_MANUAL_SMOKE.md` — checklist for the human.

### Modify
- `backend/requirements.txt` — add `cryptography>=43,<46` if not already present (it isn't on main as of branch point).
- `backend/routes/dealer/__init__.py` — register `webhooks_bp`.
- `backend/worker.py` — schedule `webhook_delivery_worker.run` (5s).
- `frontend/src/components/DealerSidebar.jsx` — add `Webhooks` nav item.
- `frontend/src/App.js` — add `/dealer/webhooks` route.

---

## Task 1: Migration

**Files:**
- Create: `flask-react-supabase-app/backend/migrations/2026_06_05_dealer_webhooks.sql`

```sql
-- ============================================================
-- Phase 4 — Outbound Webhooks
-- Tables: dealer_webhooks, dealer_webhook_deliveries
-- ============================================================

CREATE TABLE IF NOT EXISTS public.dealer_webhooks (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dealership_id   uuid NOT NULL REFERENCES public.dealerships(id) ON DELETE CASCADE,
    label           text NOT NULL,
    url             text NOT NULL,
    secret_enc      text NOT NULL,
    events          text[] NOT NULL,
    enabled         bool NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dealer_webhooks_dealership
    ON public.dealer_webhooks (dealership_id);
CREATE INDEX IF NOT EXISTS idx_dealer_webhooks_events
    ON public.dealer_webhooks USING gin (events)
    WHERE enabled = true;

CREATE TABLE IF NOT EXISTS public.dealer_webhook_deliveries (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_id          uuid NOT NULL REFERENCES public.dealer_webhooks(id) ON DELETE CASCADE,
    dealership_id       uuid NOT NULL REFERENCES public.dealerships(id) ON DELETE CASCADE,
    event_type          text NOT NULL,
    payload             jsonb NOT NULL,
    status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','succeeded','failed','dead_letter')),
    attempt_count       int NOT NULL DEFAULT 0,
    next_retry_at       timestamptz NOT NULL DEFAULT now(),
    last_response_code  int,
    last_response_body  text,
    last_error          text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    delivered_at        timestamptz
);

CREATE INDEX IF NOT EXISTS idx_dealer_webhook_deliveries_due
    ON public.dealer_webhook_deliveries (next_retry_at)
    WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_dealer_webhook_deliveries_dealership_time
    ON public.dealer_webhook_deliveries (dealership_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dealer_webhook_deliveries_webhook_time
    ON public.dealer_webhook_deliveries (webhook_id, created_at DESC);

-- RLS
ALTER TABLE public.dealer_webhooks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dealer_webhooks_read" ON public.dealer_webhooks;
CREATE POLICY "dealer_webhooks_read" ON public.dealer_webhooks FOR SELECT
USING (public.is_dealership_member(dealership_id) OR public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "dealer_webhooks_service_all" ON public.dealer_webhooks;
CREATE POLICY "dealer_webhooks_service_all" ON public.dealer_webhooks FOR ALL
USING (true) WITH CHECK (true);

ALTER TABLE public.dealer_webhook_deliveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dealer_webhook_deliveries_read" ON public.dealer_webhook_deliveries;
CREATE POLICY "dealer_webhook_deliveries_read" ON public.dealer_webhook_deliveries FOR SELECT
USING (public.is_dealership_member(dealership_id) OR public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "dealer_webhook_deliveries_service_all" ON public.dealer_webhook_deliveries;
CREATE POLICY "dealer_webhook_deliveries_service_all" ON public.dealer_webhook_deliveries FOR ALL
USING (true) WITH CHECK (true);

-- Realtime for delivery log live-updates
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.dealer_webhook_deliveries;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
    END IF;
END $$;

DO $$ BEGIN
    RAISE NOTICE '✅ Phase 4 webhooks tables created';
END $$;
```

Commit: `Phase 4: dealer_webhooks + dealer_webhook_deliveries tables + RLS`

---

## Task 2: Secrets helper (Fernet)

Same shape as Phase 3's `dealer_credentials.py`. Create `services/dealer_secrets.py` exporting `encrypt_secret(str) -> str`, `decrypt_secret(str) -> Optional[str]`, `KeyMissingError`. Operates on plain strings rather than dicts.

Tests (4): round-trip, KeyMissingError without env, KeyMissingError on decrypt without env, None on tampered token.

Commit: `Phase 4: dealer_secrets helper (Fernet over plain strings)`

---

## Task 3: HMAC signing helper

`services/webhook_signing.py` — exports `sign(secret: str, body: bytes) -> str` returning `"sha256=" + hexdigest`. Stdlib only.

Tests (3):
- stable signature for same input
- different signatures for different bodies
- different signatures for different secrets

Commit: `Phase 4: webhook_signing helper (HMAC-SHA256)`

---

## Task 4: Webhook dispatcher

`services/webhook_dispatcher.py` exports `dispatch(event_type: str, dealership_id: str, payload: dict) -> int` (returns count of delivery rows created).

Logic: SELECT enabled webhooks for the dealership that include `event_type` in their `events` array → for each, INSERT a `dealer_webhook_deliveries` row with `status='pending'`, `next_retry_at=now()`, `payload` JSON, `attempt_count=0`.

Tests (3):
- creates one delivery per matching webhook
- skips disabled webhooks
- skips webhooks not subscribed to the event

Commit: `Phase 4: webhook_dispatcher (queue pending deliveries)`

---

## Task 5: Delivery worker

`workers/webhook_delivery_worker.py` exports `run()` returning count of deliveries processed in this tick.

Logic per tick:
1. SELECT up to 20 pending deliveries where `next_retry_at <= now()`, oldest first.
2. For each: fetch the webhook (need `url` + `secret_enc`). Decrypt the secret.
3. Build payload body: `json.dumps({"id": delivery.id, "event": delivery.event_type, "delivered_at": now_iso, "data": delivery.payload})`.
4. Compute `signature = sign(decrypted_secret, body_bytes)`.
5. POST to `webhook.url` with headers `Content-Type: application/json`, `X-DPH-Signature: <signature>`, `X-DPH-Delivery: <delivery.id>`, `X-DPH-Event: <event_type>`. Timeout 10s.
6. On 2xx: set `status='succeeded'`, `delivered_at=now()`, record `last_response_code` + first 500 chars of body.
7. On non-2xx or exception: increment `attempt_count`. If `attempt_count >= 5` → `status='dead_letter'`. Else schedule next retry per the backoff schedule (`[60, 300, 1500, 7200, 43200]` seconds).
8. If decryption fails: mark `dead_letter` immediately with `last_error='secret_unreadable'`.

Tests (≥ 5):
- 200 → succeeded, delivered_at set
- 500 → attempt_count incremented, status pending, next_retry_at moved
- 5 consecutive failures → dead_letter
- decryption returns None → dead_letter immediately
- no pending due deliveries → run returns 0, no side effects

Commit: `Phase 4: webhook_delivery_worker (HMAC-sign, backoff, dead-letter)`

---

## Task 6: Schedule worker

Add to `worker.py` per the existing pattern. Env `WEBHOOK_DELIVERY_INTERVAL_SECONDS` default `5`.

Commit: `Phase 4: schedule webhook_delivery_worker (5s default)`

---

## Task 7: Routes — webhooks CRUD + send-test

`routes/dealer/webhooks.py` blueprint `dealer_webhooks` at `/api/dealer`.

Endpoints (all `@dealer_required`):
- `GET /webhooks` — list webhooks for dealership. **Never include `secret_enc`** in response.
- `POST /webhooks` (`role_required("owner","manager")`) — body `{label, url, events, secret}`. Validate url is http(s), events is list of allowed types, secret length >= 16. `encrypt_secret(secret)`; on KeyMissingError → 503. Insert. Return row minus `secret_enc`.
- `PATCH /webhooks/<id>` (`role_required("owner","manager")`) — partial. If `secret` present, re-encrypt; else leave `secret_enc` alone.
- `DELETE /webhooks/<id>` (`role_required("owner","manager")`) — 204.
- `POST /webhooks/<id>/test` (`role_required("owner","manager")`) — synchronously fire one delivery with a sample payload `{event: "test.ping", data: {message: "Hello from DPH"}}`. Returns `{status_code, response_body, signature}` so the dealer can verify their signature math.
- `GET /webhooks/<id>/deliveries` — paginated delivery history for one webhook.
- `GET /webhooks/deliveries` — paginated delivery history for the whole dealership.

Tests (≥ 6): list strips secret_enc, POST encrypts + strips, POST 503 without key, PATCH without secret leaves it alone, DELETE 204, send-test returns status_code + signature.

Commit: `Phase 4: dealer webhooks routes (CRUD + send-test + deliveries log)`

---

## Task 8: Register blueprint

Modify `backend/routes/dealer/__init__.py` to register `webhooks_bp`. Update docstring.

Commit: `Phase 4: register dealer_webhooks blueprint`

---

## Task 9: Requirements

If `cryptography` isn't in `requirements.txt`, add `cryptography>=43,<46`. Verify with `./venv/bin/python -c "from cryptography.fernet import Fernet; print('ok')"`.

If Phase 3 hasn't landed and the venv doesn't have it, install with `./venv/bin/pip install 'cryptography>=43,<46'`.

Commit (if changed): `Phase 4: add cryptography to requirements`

---

## Task 10: Frontend page — `DealerWebhooks.jsx`

Route `/dealer/webhooks`. Sections:

1. **Header** — "Outbound webhooks" + description.
2. **Add webhook button** → modal with: `label`, `url`, `events` (multi-select chips for the 6 event types), `secret` (random-by-default; "Generate" button writes a 32-char hex). Save POSTs and refreshes.
3. **Webhooks table** — columns: label, url (truncated), events (chips), enabled toggle, actions (Edit / Send test / Delete).
4. **Send test action** — POSTs `/webhooks/<id>/test`, shows toast with returned `{status_code, signature}`.
5. **Delivery log** (separate card below the table) — paginated rows of recent deliveries with: event_type, webhook label, status pill (pending/succeeded/failed/dead_letter), attempt_count, last_response_code, created_at. Realtime subscription to `dealer_webhook_deliveries` updates rows live.

Use the same styling and `lucide-react` icons (`Webhook`, `Plus`, `Send`, `Edit3`, `Trash2`, `KeyRound`).

Commit: `Phase 4: DealerWebhooks page (CRUD + Send test + Delivery log)`

---

## Task 11: Sidebar + App.js routes

Add `Webhooks` nav item to `DealerSidebar.jsx` (between Integrations and Team). Add `/dealer/webhooks` route to `App.js` (lazy import).

Commit: `Phase 4: dealer sidebar Webhooks entry + route`

---

## Task 12: Manual smoke checklist

Write `backend/migrations/PHASE4_MANUAL_SMOKE.md` covering:
1. Apply `2026_06_05_dealer_webhooks.sql` in Supabase.
2. Set `DEALER_INTEGRATIONS_KEY` if not already (same key Phase 3 used).
3. Sign in as dealer owner; create a webhook pointing at https://webhook.site (give a test URL); enable events `lead.created` + `listing.sold`; save.
4. Click **Send test** — confirm the receiving URL gets the payload with `X-DPH-Signature`, `X-DPH-Delivery`, `X-DPH-Event` headers.
5. Verify the signature by computing `hmac-sha256(secret, raw_body)` and comparing to the `X-DPH-Signature` header.
6. Simulate a failing endpoint (point url at a route that returns 500) — confirm attempt_count increments + delivery goes to `dead_letter` after 5 attempts (skip the wait by manually updating `next_retry_at` in SQL).
7. Role gating: `sales_rep` cannot create/update/delete webhooks.

Commit: `Phase 4: manual-smoke checklist`

---

## Deferred to Phase 4.1 (intentional)

- Wiring webhook dispatch into the Phase 2 lead-events sites (`lead.created`, `lead.status_changed`, `lead.assigned`) — needs Phase 2 merged first; trivial follow-up of ~5 lines per event site calling `dispatch(...)`.
- Wiring webhook dispatch into Phase 3 inventory-import success (`inventory.import_completed`).
- `listing.view_milestone` event source (background job that detects threshold crossings).
- Webhook delivery retry button on dead-lettered rows.
- Real-time delivery log filter by event type.

## Final review checklist

- [ ] Every spec §9 item covered:
  - §9.1 UI → Tasks 10, 11
  - §9.2 events emitted → Phase 4.1 deferral (event types declared in the dispatcher allow-list)
  - §9.3 delivery + retries + dead-letter → Tasks 5, 7
  - §9.4 payload shape (signed JSON) → Tasks 3, 5, 7
- [ ] All tests passing locally
- [ ] Frontend build clean
- [ ] No placeholders in this plan
