# Senior Developer Audit Report

**Repository:** `/Users/suhayl/Downloads/Flask-React-superbase-classified/`
**Stack:** Flask 3.1.3 monolith (25k-line `app.py`) + React 18 / CRA + Supabase + Expo Router mobile + Reddit Devvit bot + two Python microservices (PaddleOCR + NudeNet/OpenCLIP)
**Audit mode:** Read-only. All ~30 parallel audit agents have completed.

---

## Executive Summary — Top Issues a Senior Dev Will Flag

The codebase is functionally rich but operationally fragile. The headline issues:

1. **`backend/app.py` is a 25,747-line monolith.** Every route, helper, worker scheduler, reminder thread, sitemap, email builder, and admin endpoint lives in one file. Two `admin_bp` blueprints exist with the same prefix; routes are registered twice in some cases. No module boundary between `public/api/`, `admin/api/`, and `dealer/api/`.
2. **No CI.** 95 `test_*.py` files, ~14k lines of tests, none of which are auto-invoked. Repo has no `.github/`, no `.circleci/`, no `.gitlab-ci.yml`, no `Jenkinsfile`. Tests run only manually.
3. **Storage waste of ~4.4 MB committed-but-unused frontend assets** (orphan JPG fallbacks, duplicate logos, unused plate PNGs, full `src/assets/images/` directory never imported).
4. **Three import-time side effects** in the React entry path: `supabaseClient` constructs the Supabase client at module load, `authService` calls `clearLegacyPersistentAuth()` at module load, `botSignals` registers two global event listeners at module load. All happen before first paint.
5. **9 synchronously-imported dealer pages** in `App.js:19-27` (DealerDashboard, DealerListings, DealerSettings, DealerVerificationPage, …) pull `motion/react` into the initial bundle for every visitor — including logged-out home-page visitors. Only 6 of 15 dealer pages are lazy.
6. **All expiry / lifecycle sweeps** in `_run_listing_expiry_reminders_once`, `_run_listing_lifecycle_sweep_once`, and `_run_dealer_doc_expiry_reminders_once` issue per-row GET/PATCH/RPC calls in serial loops. Each tick = `4 + 2N` Supabase round-trips. Replicable as 2–3 SQL statements.
7. **150 SQL migrations across two folders with massive duplication:** `fix_performance_issues.sql/.v2.sql/.FINAL.sql`, `fix_security_issues.sql/.v2.sql/.FINAL.sql`, `COMPLETE_SCHEMA_FIX.sql` + `00_COMPLETE_SCHEMA.sql`, multiple "backfill" updates of overlapping columns, drifting column types (VARCHAR vs TEXT vs NUMERIC vs double precision).
8. **Dead / orphaned data:** ~30 dead columns (write-only across migrations), 6 dead JSONB columns with no read path, `models/*` tables created by `moderation_learning_foundation.sql` never written outside the migration.
9. **OCR + Vision microservices** fetch models on first container boot (~250 MB cold). `OCR_LANG=en` is baked into the OCR image. `EXPOSE 8000` mismatches the actual bind port (`${PORT:-8080}`).
10. **Worker coordination is fragile:** `worker.py` runs ~17 daemon threads in one process; multi-replica safety relies entirely on application-level row locks with no leader election.

---

## 1. Project Inventory

| Layer | Path | Approx size | Notes |
|---|---|---|---|
| Backend monolith | `flask-react-supabase-app/backend/app.py` | **25,747 lines** | Every route + helper + worker scheduler + reminder loop + sitemap + email builder + admin endpoint in one file |
| Backend routes | `backend/routes/` | 14 files, ~5,800 lines | `admin.py` (2,671), `buying_requests.py` (477), `ocr.py` (237), `dealer/` subpackage (~3,000 lines, 11 files) |
| Backend services | `backend/services/` + `auto_review/` | 28 files, ~6,000 lines | reddit_import, vin_decoder, dealer_*, auto_review/* |
| Backend workers | `backend/workers/` + `worker.py` | 13 files, ~3,500 lines | 12 background threads |
| Backend tests | `backend/test_*.py` | **95 files, ~13,800 lines** | Mocked; only ~3 require live Supabase |
| Backend migrations | `backend/migrations/` | **94 SQL files** | Plus 8 top-level `*.sql` |
| Supabase migrations | `supabase/migrations/` | 15 SQL files | Largely duplicates of `backend/migrations/` |
| Frontend | `frontend/` (CRA + craco) | ~80 components, ~38 utils, ~25 hooks | Initial bundle carries `@supabase/supabase-js`, `axios`, `lucide-react`, `motion/react` (via 9 dealer pages), `framer-motion` indirectly |
| Frontend assets | `frontend/public/` | ~3.6 MB committed | ~833 KB orphan JPGs + duplicates |
| Frontend orphan | `frontend/src/assets/` | ~2 MB committed | **Zero files in `src/assets/images/` are imported** |
| Mobile | `mobile/` | Expo Router, ~30+ screen wrappers, ~25 real screens in `mobile/src/screens/` | `+tensorflow/tfjs`, `nsfwjs`, `@tensorflow-models/blazeface`, `@shopify/react-native-skia`, `react-native-maps`, `expo-location`, `posthog-react-native`, `react-native-webview` |
| OCR service | `ocr-service/` | FastAPI + PaddleOCR | Cold-start ~100 MB model fetch |
| Vision service | `vision-service/` | FastAPI + NudeNet + OpenCLIP | Cold-start ~250 MB model fetch |
| Devvit bot | `devvit/dph-bot/` | TypeScript esbuild | Reddit posting + GitHub roundup |
| Dev/test scripts | `scripts/`, `non-essential/scripts/` | ~10 shell scripts | Operator helpers only |
| Docs | `flask-react-supabase-app/docs/` + `non-essential/vault/` | ~10 design specs | None wired into build |
| Test runtime | `frontend/scripts/`, `mobile/src/__tests__/` | Jest config only | No CI |
| Skills | `.agents/skills/`, `.claude/skills/` | PostHog + mobile-app-ui-design | Not imported by app code |

---

## 2. Backend — `app.py` (25,747 lines)

### 2.1 Hot-path bottlenecks (verified line-by-line)

| # | Location | Pattern | Severity |
|---|---|---|---|
| 1 | `app.py:2696-2766` (`_collect_user_listing_records`) | For each listing, separate `GET /rest/v1/{images_table}?{fk}=eq.{listing_id}`. Called from `get_all_user_listings` (`app.py:15311`) once per type → 4 type iterations → 4 list queries + 4×N image queries per user-dashboard load. | **HIGH** — degrades linearly with user's listing count. |
| 2 | `app.py:21189-21300` (`/api/admin/stats`) | 9 sequential / parallel full-table scans (`platform_events`, `lead_events`, `users`, `reports`, `saved_searches`, `listing_drafts`, `cars/bikes/car_parts/license_plates`). 60s in-process cache. | **HIGH** — admin dashboard scales linearly with table size. |
| 3 | `app.py:20645-20809` (`/api/admin/metrics/overview`) | 6 sequential full-table scans (platform_events, cars, license_plates, bikes, car_parts, users). | **HIGH**. |
| 4 | `app.py:18653-18697, 18709-18749, 18761-18801` (`admin_get_cars`, `_bikes`, `_parts`) | Per-row image fetch in a `for car/bike/part in response` loop. | **HIGH**. |
| 5 | `app.py:5744-5765` (`_dealer_expired_required_documents`) | Per-dealer-doc-type GET, called inside `_enforce_listing_limit` which itself loops over 4 listing tables. | **MEDIUM-HIGH**. |
| 6 | `app.py:25102-25291` (`_run_listing_expiry_reminders_once`) | 4–8 GETs + 2 writes **per row**. Worst case `4 + 2N` round-trips per tick. | **HIGH**. |
| 7 | `app.py:25294-25337` (`_run_listing_lifecycle_sweep_once`) | 4 GETs + N×PATCH (via `_sync_listing_lifecycle`). Replicable as 3 bulk SQL updates. | **HIGH**. |
| 8 | `app.py:25007-25099` (`_run_dealer_doc_expiry_reminders_once`) | Per-row `users` GET + per-row `dealer_documents` PATCH. `1 + 2N` round-trips. | **HIGH**. |
| 9 | `app.py:21595-21602` | `track_listing_lead_event` writes to **two** event tables per contact action (`lead_events` insert + `record_analytics_event` RPC). | **MEDIUM**. |
| 10 | `app.py:21616-21622` | Per-contact-event `threading.Thread(target=_notify_user_push, daemon=True).start()` — unbounded thread spawn. | **MEDIUM** — DOS surface. |

### 2.2 Per-request work that should move to module load

| Location | Work |
|---|---|
| `app.py:5369-5393` (`add_security_headers`) | Rebuilds the CSP string every response. Constant content; precompute at import. |
| `app.py:6325-6390` (`supabase_request`) | Rebuilds the headers dict on every call (5 branches, ~20 lines). Called from ~150 places. |
| `app.py:6725-6730`, `7239-7245`, `7563-7574` | `extras_mapping` dict literal rebuilt per request in `get_cars`, `create_car`, `update_car`. |
| `app.py:4307-4330` | `_normalize_for_profanity` rebuilds `str.maketrans(...)` per call. Should be a module-level constant. |
| `app.py:5369-5376` | `_build_content_security_policy()` called per response. |
| `app.py:1032-1100` (approx) | `_optional_user_id` runs JWT `decode` with up to 3 secret tries per request. |
| `app.py:18584-18608` (`_get_user_email`) | 2 REST calls (`/rest/v1/users` + `/auth/v1/admin/users`) on every CRUD hot path (called from `create_car`, `update_car`, `create_bike`, `create_plate`, etc.). Not cached. |

### 2.3 Caches (in-process state)

| Name | Location | Backend | Thread-safe | Bounded? |
|---|---|---|---|---|
| `_MEMORY_API_CACHE` | `app.py:573` | In-process dict | `LOCK` (line 574) | YES — 500 keys cap, evict 100 |
| `_STORAGE_BUCKET_CACHE` | `app.py:170` | In-process dict | `LOCK` (line 171) | bounded by bucket-name count (~4) |
| `_USERNAME_AVAILABILITY_CACHE` | `app.py:185-186` | external (30s TTL) | inherits lock | n/a |
| `_MEMORY_AUTH_REVOCATIONS` | `app.py:3385` | In-process `set[str]` | `LOCK` (line 3386) | **NO** — only removed on logout, never expires |
| `CONTACT_RATE_LIMIT` | `app.py:145` | `defaultdict(deque)` | guarded by lock | **NO** — no key eviction |
| `CONTACT_LEAD_RATE_LIMIT` | `app.py:155` | same | guarded | **NO** |
| `AUTH_RATE_LIMIT` | `app.py:158` | same | guarded | **NO** |
| `_USERS_TABLE_COLUMN_CACHE` | `app.py:4861` | dict | **NOT guarded** | bounded |

No `functools.lru_cache` anywhere in `app.py`.

### 2.4 Rate-limit concerns

- All three limiters share `_RATE_LIMIT_LOCK` (`app.py:159`) — when Redis is down, contact-rate-limiting serializes against auth-rate-limiting.
- **OTP send limiter is Redis-only.** `app.py:12362-12364` calls `_redis_fixed_window_rate_limited(...)` and **does not fail-closed when Redis is unavailable** — request proceeds unthrottled.
- `_contact_lead_rate_limited` uses `defaultdict(deque)` without global sweep; the dict grows unboundedly under bot traffic.

### 2.5 Concurrency hazards

- `_REDIS_CACHE_CLIENT` reassignment race (`app.py:578-598, 622, 658, 759`) — no lock around `global _REDIS_CACHE_CLIENT`.
- Per-contact-event `threading.Thread` (`app.py:21616-21622`) — no upper bound; threads die silently on exception.
- `_sync_listing_lifecycle` mutates in-memory `record` dict (`app.py:1553, 1580, 1633, 1705`); each request gets a fresh dict, but the same lifecycle patch can be applied to a row that's already been mutated by another worker (race on `auto_review_decided_at` stamping).
- `_request_supabase_durations_ms` ContextVar list is per-request; background-thread `_notify_user_push` calls happen with empty ContextVar — their supabase durations are silently lost.
- Background-thread `reminder_thread` in `__main__` (`app.py:25364`) only runs under `python app.py`. Under gunicorn, `__name__` is `app`, so the daemon does NOT start — meaning **the local-dev reminder sweep is the only one that runs, and the production reminder sweep is performed by `worker.py`'s `worker.py:296-305` instead** (confirmed via process model audit).

### 2.6 Heavy imports

| Import | Line | Note |
|---|---|---|
| `from PIL import Image` | `app.py:38` | Loaded at module top even though only used by image handlers |
| `from posthog import Posthog` | `app.py:39` | Instantiated at `app.py:95-100` (sync) |
| `from flask_mail import Mail` | `app.py:121` | Wrapped in try/except but the import itself runs |
| `from services.contact_analytics import …` | `app.py:46` | Only used by admin handlers — lazy-import candidate |
| `from analytics_metrics import …` | `app.py:44` | Same — lazy candidate |
| `from services.analytics_events import …` | `app.py:45` | Same |
| `from services.featured_listings import …` | `app.py:47-51` | Same |
| `from expo_push import …` | `app.py:52` | Same |

**Note:** `nudenet`, `opencv-python-headless`, `onnxruntime`, `numpy` are NOT in `app.py` top-level imports — they're lazy in `services/auto_review/vision.py`. Comment in `requirements.txt:19-23` confirms intent.

### 2.7 Module-level mutable state

- `posthog_client` (line 93): immutable after init ✓
- `_RATE_LIMIT_LOCK` (159): shared by 3 limiters — contention under Redis-down
- `_MEMORY_AUTH_REVOCATIONS` (3385): **never expires**, bounded only by logout events
- `_MEMORY_API_CACHE` (573): bounded to 500 ✓

### 2.8 Dead / commented / TODO

| Line | Note |
|---|---|
| `app.py:19649` | Commented `# app.register_blueprint(admin_bp)  # Remove this line from here` |
| `app.py:18121` | Note-only — `/api/admin/users/<id>/make-admin` removed |
| `app.py:21124` | Note-only — `/api/admin/ga4-summary` removed |
| `app.py:20262` | Note-only — admin_bp registration comment |
| `app.py:4710-4716` | `_send_infobip_sms` is a **stub that always raises `RuntimeError("SMS provider removed")`** — called from `_issue_phone_verification` (line 5068) and `_resend_phone_verification` (line 5146). Any non-UAE prefix would 500. |
| `app.py:25340-25341` | Comment `# Admin routes are registered at the top of the file` is **stale** — `admin_bp` is actually registered at line 20253 mid-file. |

### 2.9 `__main__` block / routes registered after

The `if __name__ == "__main__":` block at `app.py:25343-25367` is dead code under gunicorn. The 9 routes registered after `app.py:25367` (`/api/admin/cache/flush`, `/api/admin/auto-review/settings`, etc.) **ARE alive in production** because Flask registers routes at import time, not at `__main__` execution.

### 2.10 Debug-mode env var

- `app.py:25345` reads `FLASK_DEBUG` (not the conventional `FLASK_ENV`). Truthy values: `{1, true, yes}` — missing `on` (inconsistent with `AUTO_REVIEW_WORKER_ENABLED` at line 25398).
- Binds to `127.0.0.1` only — safe but undocumented.

### 2.11 Routes registered twice

- `/api/health` at `app.py:9871` and `app.py:21038`
- `/healthz` at `app.py:21039` (different handler but same intent as `/api/health`)
- `/api/health/live` at `app.py:21082` and `/healthz/live` at `app.py:21083`
- Multiple CORS preflight handlers (`OPTIONS /api/cars`, `OPTIONS /api/cars/<id>`, etc.) — expected.

### 2.12 Orphaned handler body

**`app.py:17927-18031`** is an orphaned function body — its `@app.route` decorator is missing. The block starts mid-function at line 17927 (`bootstrap_token = os.getenv(...)`) and runs `current_user` references without a clear enclosing function header in this range. This is **unreachable code in the current module flow** but wastes tokens and confuses readers.

### 2.13 Dead code (unreachable)

- `app.py:19940` `return redirect(url_for("admin_web.list_pending_items", item_type=item_type))` — last line of `reject_item_api` (line 19854), **unreachable** because all prior branches `return jsonify(...)`.

---

## 3. Backend — `routes/`

### 3.1 `routes/admin.py` (2,671 lines, 31 routes)

- **N+1 confirmed:** `get_reports` (line 873) — per-report `users?select=email,username` lookup.
- **`get_listing_overview`** (line 2298): 6 sequential REST calls per overview load.
- **`get_user_overview` / `get_dealer_overview` / `get_listing_overview`**: each does 6+ round-trips; 60s in-process cache.
- **Hard import error:** `routes/admin.py:2551-2556` lazy-imports `_send_renewal_nudge_sms` and `_send_renewal_nudge_whatsapp` from `app`. **Neither function exists.** Any call to `send_listing_renewal_nudge` (line 2470) will raise `ImportError`.
- **Routes registered to `/api/admin` prefix**, **overlapping** with `dealer/admin_oversight.py:23` which also uses `url_prefix="/api/admin"`. Route resolution depends on registration order; some endpoints collide.

### 3.2 `routes/buying_requests.py` (477 lines, 6 routes)

- **`list_buying_requests` (line 92)**: 60s cache; `create_buying_request` (line 281): 2 sequential GETs + image inserts + PostHog capture (synchronous in handler).

### 3.3 `routes/ocr.py` (237 lines, 1 route)

- **`POST /api/ocr/scan-registration`**: offloads to a module-level `ThreadPoolExecutor` with `BoundedSemaphore`. `verify_listing_ownership` is a synchronous REST call in the handler. `_record_ocr_failure` does a synchronous `app.record_app_error(...)` on the request thread.

### 3.4 `routes/dealer/_decorators.py`

- `_request_client_ip()` (line 21) **does not consult `X-Forwarded-For`** despite the docstring claiming to do so.
- `dealer_required` (line 126): 2 REST round-trips per request (`_lookup_membership` + `_is_admin`), plus `_audit_write` POST on writes (3-4 total).
- `role_required` (line 177): bypasses if `actor_kind == "admin"`.

### 3.5 `routes/dealer/` — duplicated shims

**Every file in `routes/dealer/` defines its own `_svc` and `_token_required`:** `admin_oversight.py:32, 26`; `analytics.py:64, 58`; `api_sources.py:69, 56`; `core.py:24, 40`; `diagnostic.py:19, 25`; `inventory.py:59, 40`; `market.py:16, 22`; `webhooks.py:37, 47`; `leads.py:23, 33`. **9 copies of each.**

---

## 4. Backend — `services/` (28 modules)

| Service | Concern |
|---|---|
| `analytics_events.py` | Pure. No issues. |
| `cloudflare_analytics.py` | In-process `_CACHE` and `_ZONE_RESOLUTION` dicts (`cloudflare_analytics.py:39, 43`) — not lock-guarded; bounded by zone count but `_CACHE` keyspace is `(tuple(zone_ids), days)`. **5-min TTL but `_CACHE` is unbounded within TTL.** |
| `contact_analytics.py` | Pure aggregation. |
| `dealer_credentials.py` | Fernet constructed per call. Thread-safe (Fernet is documented as thread-safe). |
| `dealer_diagnostic.py` | Pure rule engine. |
| `dealer_inventory.py` | `defusedxml.fromstring` parses entire XML document into memory — no streaming. |
| `dealer_kpi.py` | Pure. |
| `dealer_leads.py` | SHA-256 per row, microseconds. |
| `dealer_market.py` | **`params = {...}` constructed at line 67 and then OVERWRITTEN by line 74-79** — first construction is dead code. Line 67-72 allocates a dict that's never used. |
| `dealer_secrets.py` | Symmetric to dealer_credentials. |
| `featured_listings.py` | Pure. |
| `url_safety.py` | `socket.getaddrinfo` DNS lookup per call (blocks on Windows timeouts). Iterates response in 64-KB chunks. |
| `vin_decoder.py` | `_VIN_CACHE` is module-level dict + Lock. **Bounded** via `_enforce_cache_bound` (FIFO eviction at 1000 entries). Cache entries stored as `deepcopy` — defensive but doubles CPU/memory per cache hit. |
| `vision_service.py` | Sync HTTP, no retry, 12s timeout. Web workers never trigger it. |
| `webhook_dispatcher.py` | Insert-only — does NOT make outbound HTTP. **No retry / DLQ in this file** — whatever retry logic exists is in the delivery worker. |
| `webhook_signing.py` | HMAC-SHA256, constant time. |
| `registration_ocr.py` | Sync HTTP to OCR service. `pypdfium2` lazy. 8s per attempt × 2 attempts = 16s cap. |
| `reddit_import.py` | **No retry / no rate-limit handling** on `response.raise_for_status()`. `submit_self_post` raises on Reddit's `RATELIMIT` errors. 100-listing hard cap. |
| `auto_review/trust.py`, `hard_blockers.py`, `decision.py`, `vin_gate.py`, `sync_gate.py`, `rules.py` | Pure-logic / dependency-injected. **Clean.** |
| `auto_review/vision.py` | `LocalVisionProvider` lazy-loads `cv2`, `nudenet`, `onnxruntime`, `numpy` inside `_ensure_loaded` (lines 118-127). Heavy deps never loaded if `AUTO_REVIEW_VISION_PROVIDER` is not `local`. |

---

## 5. Backend — `workers/` (12 workers + `worker.py` orchestrator)

### 5.1 Process model

`worker.py` runs **~17 daemon threads in one process** under `scheduled_loop()`. All share the GIL; a slow tick blocks all others. **No multi-replica leader election.** If `worker` scales >1, application-level row locks are the only safety:

- `inventory_import_worker._claim_job` (line 48-61) — atomic PATCH.
- `webhook_delivery_worker._claim` (line 87-103) — atomic PATCH with `(id, status, next_retry_at)`.
- `dealer_api_source_poller._claim_source` (line 269-283) — atomic PATCH.
- `dealer_auto_approval_worker._claim` (line 111-119) — atomic PATCH.
- `reddit_daily_post_worker` — relies on `reddit_daily_posts.post_date` UNIQUE.

### 5.2 Per-worker notes

| Worker | Interval | Per-tick cost |
|---|---|---|
| `auto_review_worker.py` | 15s | Sequential per-row: 20 image HTTP GETs × 80 rows = 1600 GETs/tick + ONNX nudity scan + trust-context fan-out (~10 SELECTs per row). |
| `dealer_api_source_poller.py` | 60s | Per-source: HTTPS fetch + claim PATCH + per-existing-car PATCH storm. |
| `dealer_auto_approval_worker.py` | 60s | No `try/except` around `_process_one` — one bad row stalls the loop. |
| `dealer_kpi_aggregator.py` | **NOT WIRED** into `worker.py`. **Worst-case 500k GETs** (limit 50k per call × many tables × many dealerships). No per-row error handling — aborts whole run on single 5xx. **GET limit 5000 silently truncates dealerships past 5000.** |
| `dealer_lead_aggregator.py` | 30s | Per-event `dealer_leads` GET (dedup lookup) + per-event insert/update + per-event `dealer_lead_events` insert = **~3 round-trips per event × 500 events = ~1500 round-trips/tick**. **No try/except around per-event loop** — exception aborts mid-batch, cursor not advanced, events re-processed. |
| `inventory_import_worker.py` | 10s | Per-existing-car PATCH (no batch update). Storage download failure leaves job in `running` status — only fixed on worker exception. |
| `market_snapshot_worker.py` | **NOT WIRED**. Cron-only by docstring. |
| `reddit_daily_post_worker.py` | 1h | Hour-of-day guard + cooldown. Reddit OAuth rate limit NOT handled. |
| `reddit_import_worker.py` | 4h | Per-row VIN dedup + image sync + price history = ~3-5 REST/row × 100 rows = ~500/tick. |
| `reddit_roundup_bridge_worker.py` | 1h | 1 GET + 1 PUT to GitHub. Idempotent via `content_hash`. |
| `webhook_delivery_worker.py` | 5s | 20 deliveries/tick × ~4 REST + 1 outbound HTTPS = **~80 REST/s + ~20 outbound/s**. Backoff: `[60, 300, 1500, 7200, 43200]`. |
| `auth_cleanup` (worker.py:523) | optional 1h | Paginates `/auth/v1/admin/users`. |

### 5.3 Concurrency hazards in workers

- `_SESSION = requests.Session()` shared across ticks (good — connection pooling).
- `_VIN_DECODER` lazy + module-cached (good).
- `requests.get(...)` **without** `Session` in `auto_review_worker.py:191` — no connection pooling for image fetches.
- `_run_listing_draft_reminders_once` (`app.py:13482`+): `for table in DRAFT_TABLE_CONFIG: ... for listing in lt_rows: ... _fetch_listing_primary_image_url(...)` — **per-listing image query**.
- `_run_price_drop_alerts_once` (`app.py:14013-14069`): per-drop `saved_searches` GET with `limit=2000` + per-match `get_user_email` + per-match email send (which itself does `_fetch_listing_primary_image_url`).
- `_run_saved_search_alerts_once` (`app.py:14115-14194`): per-row `_count_listings_for_saved_search` (multi-table fan-out) + `get_user_email` + email.
- `_run_saved_car_reminders_once` (`app.py:13680-13748`): per-row `cars` GET + `get_user_email` + email.

---

## 6. Backend — DB / 150+ SQL Migrations

### 6.1 Migrations with 3+ variants (delete all but the latest)

| Concept | Variants | Lines each |
|---|---|---|
| `fix_performance_issues` | `fix_performance_issues.sql` (253), `_v2.sql` (346), `_FINAL.sql` (266) | 3 |
| `fix_security_issues` | `fix_security_issues.sql` (383), `_v2.sql` (626), `_FINAL.sql` (231) | 3 |
| `enhance_user_profiles` | `enhance_user_profiles.sql` (277), `_FIXED.sql` (329); plus `COMPLETE_DATABASE_FIX.sql` re-implements | 2 + 1 |
| `COMPLETE_SCHEMA` | `00_COMPLETE_SCHEMA.sql` (368), `COMPLETE_SCHEMA_FIX.sql` (427) | 2 |
| `push_tokens` | `add_push_tokens_20260702.sql` (backend) + `supabase/20260703000002_push_tokens.sql` | 2 (cross-folder) |
| `outbound_emails` | `add_reminder_system_48h_20260619.sql` + `supabase/20260703000001_outbound_emails_reminders.sql` | 2 (cross-folder) |
| `dealer_info_requests` | `backend/2026_06_08_dealer_info_requests.sql` + `supabase/20260818010000_dealer_info_requests.sql` | 2 (cross-folder) |
| `dealer panel phase 2/3/4` | 3 separate + 1 combined | 4 |
| `sync_car_image_urls` / `sync_bike_image_urls` | 6 distinct function bodies across migrations | 6 |

### 6.2 Schema drift (sample)

| Column | Files / drift |
|---|---|
| `cars.country_code` | VARCHAR(10) vs TEXT across `00_COMPLETE_SCHEMA.sql:40`, `COMPLETE_SCHEMA_FIX.sql:41`, `add_country_code_to_tables.sql:5` (TEXT), `add_lifecycle_columns.sql:16` (VARCHAR(10)) |
| `cars.vin_number` | VARCHAR(50) vs VARCHAR(255) vs VARCHAR(17) — **three sizes** |
| `bikes.vin_number` | VARCHAR(255) vs VARCHAR(17); initial schema **lacks it entirely** |
| `cars.focal_x` / `focal_y` | `double precision` vs `NUMERIC(5,2)` |
| `users.username` | VARCHAR(50) vs VARCHAR(100) |
| `users.phone` | VARCHAR(20) vs VARCHAR(30) |
| `is_admin(...)` function | `()` no args vs `(user_id UUID)` — **non-deterministic at RLS evaluation time** |
| `handle_new_user` body | 5+ divergent bodies — last write wins |
| `dealer_users` view | At least **6 distinct column lists** across migrations |

### 6.3 Index coverage (cross-referenced against app.py queries)

| Coverage | Notes |
|---|---|
| **Covered** | All FK indexes (car_images.car_id, bike_images.bike_id, …); all status composite indexes; all lifecycle composite indexes; all `dealership_*` FK indexes; all `dealer_leads*` indexes; all `dealer_webhook*` indexes; all `outbound_emails` indexes; the 4 listing-table `auto_review_state` partial indexes. |
| **Partial / single-col** | `dealer_documents(user_id, uploaded_at)` — only single-col `user_id` index. `reports(reporter_id, created_at)` — only single-col `reporter_id`. Sort happens after fetch. |
| **Missing** | `users(is_dealer, dealer_verified, dealer_verification_requested_at)` (admin dealer-verification-pending scan, `routes/admin.py:943`); `users(created_at)` for admin order (only in `supabase/migrations/20260703000004_composite_indexes.sql:70` — not in any backend migration); `users(is_dealer, created_at)` and `users(is_dealer, dealer_verified)` — single-col partial indexes only. |
| **DROPPED by perf variants and never re-added** | `reports(created_at)` — `fix_performance_issues*.sql:174/231/261` drops `idx_reports_created_at`. Used unscoped at `backend/app.py:21879, 21918`. |

### 6.4 Dead columns (write-only across migrations)

Sample of 30+:

| Column | Table |
|---|---|
| `users.last_app_close_at`, `users.last_reminder_at` | never referenced outside migration |
| `cars.mallu_doctor_driven` | never read or written by app.py |
| `bikes.bike_manufacturer` / `bikes.bike_model` / `bikes.bike_type` | legacy schema names; modern uses `make`/`model`/`year` |
| `bikes.price` | `idx_bikes_price` indexes a column modern schema may not have |
| `cars.external_id` | only used by dealer workers |
| `featured_listings.note`, `featured_listings.highlight` | never written by app.py |
| `push_tokens.last_used_at`, `device_id`, `platform` | written, never read |
| `listing_verification_scans.*` (user_id, document_type, raw_text, fields, vin_validation, confidence, needs_review, training_image_path, ocr_diagnostics, reviewer_outcome, reviewed_at, reviewer_id) | **all write-only** — entire table is one-way infra |
| `moderation_image_checks.*`, `moderation_labels.*`, `model_registry.*` | never read or written outside migration |
| `dealer_documents.ocr_expires_at`, `ocr_scanned_at`, `ocr_raw_text` | written, never read |
| `outbound_emails.error_message`, `bounced_at`, `spam_at`, `unsubscribed_at`, `subject`, `to_email` | written, never read |
| `users.show_username_on_listings` | mapped read-only at `app.py:10026`; column never SELECTED from DB, never WRITTEN |
| `auto_review_decisions.*` | written only, never read |

### 6.5 Oversized JSONB columns — none are queried as filters

| Column | Used as PostgREST filter? |
|---|---|
| `import_field_sources` (cars/bikes/car_parts/license_plates) | NO — pure payload |
| `payload` (lead_events) | NO |
| `payload` and `draft_payload` (listing_drafts) | NO — **both columns are 100% redundant** (written in parallel, read in tandem, identical schema) |
| `metadata` (listing_deletion_events) | NO — write-only |
| `fields` / `vin_validation` / `confidence` / `ocr_diagnostics` (listing_verification_scans) | NO |
| `filters` (saved_searches) | NO (used as Python hash input only) |
| `renewal_nudge_channels` (listing tables) | NO |

JSONB GIN/BRIN indexes would be a no-op for current usage.

---

## 7. Backend — root files

| File | Issue |
|---|---|
| `analytics_metrics.py` | Pure, no issues. |
| `auth_cleanup.py` | Live `/auth/v1/admin/users` GET — single 25s-timeout request, no retries. |
| `debug_supabase.py` | Dev-only CLI. **Has `try/except: bare`** — too broad. |
| `diagnose_auth.py` | **No `if __name__ == "__main__":` guard** is wrong on `verify_complete_fix.py`, not on this one. (Verified — fine.) |
| `expo_push.py` | **Sends only first 100 tokens** (`expo_push.py:28`). Batched send is **never implemented** despite the docstring claiming "batch only if a single send ever targets more". |
| `health_monitoring.py` | Module-level env reads at import; `_REDIS_CLIENT` lazy singleton with lock; `HEALTH_CHECK_INTERVAL_SECONDS` and `WORKER_HEARTBEAT_INTERVAL_SECONDS` defined but never used in this file (consumed elsewhere). |
| `seed_reddit_import.py` | Standalone — read `.env`, import services + workers, run warmup. |
| `setup_storage_bucket.py` | **Missing `timeout=` kwarg on `requests.post`** — blocks forever on hung Supabase. |
| `verify_complete_fix.py` | **No `if __name__ == "__main__":` guard** — import-time HTTP probes. Four requests with no `timeout=` kwarg. |
| `wsgi.py` | Trivial. |
| `apply_migration.py` | Top-level `from app import supabase_request` — importing boots entire Flask app. |

---

## 8. Backend — `requirements.txt`

- `nudenet==3.4.2`, `opencv-python-headless==4.11.0.86`, `onnxruntime==1.28.0`, `numpy==2.4.6` — all lazy via `services/auto_review/vision.py`. Web image never pays this cost (unless `auto-review` endpoint is hit, which imports `auto_review_worker` lazily).
- `psycopg2-binary==2.9.10` is installed but **unused by app.py** (app uses `supabase_request` against PostgREST REST, never psycopg directly). Confirmed: no `import psycopg2` anywhere.
- `matplotlib==3.10.0` — used only by `_create_plate_with_image_impl` in `app.py:18513` for `fm.findfont(...)`. Heavy 30+ MB dep for font discovery.
- `pypdfium2==4.30.0` — lazy via `services/registration_ocr.py:505`.
- `flask-compress==1.15` + `brotli==1.2.0` — both present. Verify both compression paths work.
- `redis==5.1.1` — optional but referenced.
- `posthog>=7.0.0` — used.

---

## 9. Frontend — bundle weight & eager imports

### 9.1 Eager imports in initial bundle (verified)

| Pulls into initial bundle | Reason |
|---|---|
| `@supabase/supabase-js` | `supabaseClient.js` (line 1) imported by `AuthContext.js:3`, `PlatformAnalyticsTracker.js`, transitive via `apiClient` |
| `axios` | `authService.js:1`, `HomePage.js:3`, `CarDetail.jsx`, `BikeDetailRedesigned.jsx`, `PlateDetailRedesigned.jsx`, `PartDetailRedesigned.jsx`, `PostBuyingRequest.jsx`, `ResetPassword.js`, `ForgotPassword.js`, `ReportBugButton.jsx` |
| `lucide-react` | `Header.js:3-13` (10 icons) + `AdminSidebar.js` (12 icons) + every dealer/admin page that imports it |
| `motion/react` | **Synchronously imported by 26 components** — every dealer/admin page |
| `@radix-ui/react-accordion` | `Header.js:17` (always rendered) |
| `@radix-ui/react-slot`, `class-variance-authority` | `Header.js:18`, all dealer pages via `Button` |
| `@radix-ui/react-navigation-menu`, `@radix-ui/react-icons` | `Header.js:19-27` |
| `@radix-ui/react-dialog` | `Header.js:28` (Sheet) |
| `react-select` | `ui/searchable-select.jsx:2` — pulled in via `CarList`, `BikesRedesigned`, `CarParts`, `CreateListing`, `LoanCalculator`, `ReportBugButton`, `PostCarParts` |

### 9.2 Lazy / dynamic imports (correctly split)

| Trigger | Package |
|---|---|
| `App.js:38-43, 112-166` (dealer 6, admin 20+, public 30+ routes) | All lazy-loaded `React.lazy` chunks |
| `directUpload.js:113` | `await import('heic2any')` — only on HEIC byte sniff |
| `dealerDocumentExtractor.js:86` | `await import('pdfjs-dist/build/pdf.mjs')` — only on PDF |
| `dealerDocumentExtractor.js:125` | `await import('tesseract.js')` — only on non-PDF image |
| `imageModeration.js:25-27` | `Promise.all([import('@tensorflow/tfjs'), import('@tensorflow/tfjs-backend-webgl'), import('nsfwjs')])` — only on first upload |
| `analytics.js:54` | `await import('posthog-js')` — only when `REACT_APP_POSTHOG_KEY` set |
| `PostCar.js:217-225` | `await Promise.all([import('leaflet'), import('react-leaflet'), import('leaflet/dist/images/...png')])` — only when location picker opens |

### 9.3 Heavy packages that are correctly lazy

`@tensorflow/tfjs`, `nsfwjs`, `tesseract.js`, `pdfjs-dist`, `heic2any`, `@react-three/*` (via `HeroBackground.js` lazy in `HomePage.js:20`), `motion` (deferrable from initial via the same lazy pattern).

### 9.4 The 9 dealer pages that are NOT lazy

`App.js:19-27` imports these synchronously:

```js
App.js:19  DealerDashboard
App.js:20  DealerListings
App.js:21  DealerListingAnalytics  // pulls motion + react-leaflet (via DealerListingMarket)
App.js:22  DealerListingDiagnostic
App.js:23  DealerTeam
App.js:24  DealerSettings
App.js:25  DealerInviteAccept
App.js:26  DealerInfoRequest
App.js:27  DealerVerificationPage
```

Every one of these (and `DealerListingAnalytics`/`DealerDashboard` etc. inside `components/dealer/`) pulls `motion/react` synchronously. **Net: motion/react is in the initial bundle for every visitor, including logged-out home-page visitors who never see a dealer page.**

### 9.5 `package.json` anomalies

| Item | Status |
|---|---|
| `react-router@7.18.3` AND `react-router-dom@7.18.3` both listed | Verified — `react-router` is **unused** in `src/`. Only `react-router-dom` is imported. Remove `react-router` from `package.json`. |
| `lucide-react@^1.7.0` | Verified — `1.39.0` is current; `1.7.0` is **valid** (not the 0.x line as the question suggested). Premise was wrong; package is fine. |
| `@tensorflow-models/blazeface` listed | Only referenced by `imageModeration.test.js:3` as a `jest.mock`. **Never imported in production.** Remove from `package.json`. |
| `html2canvas` listed | Not imported anywhere in `src/`. Remove. |

---

## 10. Frontend — components / render / image

### 10.1 React.memo coverage

Only **one** component is `React.memo`-wrapped in the entire frontend: `MarketplaceListingCard.jsx:200`. Every other component re-renders on parent state changes.

### 10.2 Inline objects / functions causing re-renders

- `CarList.jsx:91-149` — `carExtrasCategories` object literal (~50 entries) recreated every render.
- `ExplorePage.jsx:1440` — `priceFiltersByMode` rebuilt every render.
- `ExplorePage.jsx:1154` — `filteredItems` `useMemo` deps include `filters` object that is fresh on every keystroke → re-runs the full filter + score + sort on every keystroke. **No debounce on globalQuery.**
- `MarketplaceListingCard.jsx:68` — `useSwipe({ onSwipeLeft: …, onSwipeRight: …, enabled: hasGallery })` — inline options object every render.
- `CarDetail.jsx:295-330` — `getGalleryImages()` runs on every render; called from line 246 (hero swipe), 278 (render), and inside `<ImageLightbox>` (line 651) — at least 3 full passes per render.
- `DealerKpiTiles.jsx:6-18` — `useMotionValue(0)` created per mount per tile; 6 simultaneous `animate(...)` per dashboard render.
- `AdminListings.jsx:955-960`, `AdminUsers.jsx:435-439`, `AdminReports.jsx:506-510`, `BikeDetailRedesigned.jsx:329,379-388`, `CarDetail.jsx:573`, `ListingSkeleton.jsx`, every `<img>` lacks intrinsic `width`+`height` HTML attrs — CLS contribution.

### 10.3 useEffect issues

- `CarList.jsx:255` — `useEffect(... [sortOption, fetchCars])` re-fires on every filter keystroke because `fetchCars` identity changes; **no debounce** on filter typing.
- `ExplorePage.jsx:913` — `useEffect` watching `[loading, featuredCounts, activeMode]` with stale-closure risk.
- `ExplorePage.jsx:1285` — URL-sync effect on every keystroke; no debounce.
- `PostCar.js:830-861` — auto-fill title effect re-fires on every dropdown change.
- `Header.js:85-93` — scroll listener fires `setScrolled(window.scrollY > 24)` on every scroll event (passive but still triggers re-render).
- `DealerVerificationPage.jsx:101` — `setInterval(fetchStatus + fetchMessages, 8000)` — no `document.visibilityState` guard. Hidden tab wastes CPU + battery.
- `PlatformAnalyticsTracker.js` (line 139) — `console.debug` in production — gated by `process.env.NODE_ENV !== 'production'` (correct but the env check runs at runtime, not build time).

### 10.4 Image handling — every `<img>` is broken

| Component | Issues |
|---|---|
| `CarList.jsx`, `BikeDetailRedesigned.jsx`, `PlateDetailRedesigned.jsx`, `PartDetailRedesigned.jsx`, `PlatesRedesigned.jsx`, `BikesRedesigned.jsx`, `CarParts.js` | `<img>` with NO `srcset`, NO `sizes`, NO `decoding="async"`, NO intrinsic `width`/`height` HTML attrs. Some set `loading="lazy"`. None have blurhash/LQIP. |
| `Header.js:33`, `Footer hover-footer.jsx` | `<img>` for Reddit brand mark — no `loading`, no `decoding`, no dimensions. |
| `AdminDashboard.js:781-786` | Has `loading="lazy"`; still missing `width`/`height` HTML attrs. |
| `AdminUsers.js:435-439`, `AdminReports.js:506-510,666-670` | Avatars and report thumbnails — no `width`/`height`. |
| `AdminListingDetail.jsx:742,795,814,833` | Admin document previews (Mulkiya / Plate proof / Bike plates) — no `loading`, no dimensions, no `srcset`. |
| `ExplorePage.jsx:537` | BuyingRequestCard image — no `width`/`height`. |
| `ProfileMenu.js` | Avatar img + initial-letter fallback — missing dimensions. |

### 10.5 List virtualization

**No list virtualization anywhere in the frontend.** No `react-window`, `react-virtuoso`, `@tanstack/react-virtual`. Worst cases:

| Component | Rows |
|---|---|
| `AdminUsers.js` | up to 200 `<motion.tr>` rows, no virtualization |
| `AdminListings.js` | 25 per page × 4 pages = up to 100 visible |
| `AdminReports.js` | no pagination cap visible — full filtered list |
| `AdminDealerAuditLog.jsx` | search → 1000 audit rows possible |
| `AdminDealerDetail.jsx` | documents × uploads × requests |
| `ExplorePage.jsx` | 48 cards initially, 48 per "Show more" click |
| `CarList.jsx`, `BikesRedesigned.jsx`, `PlatesRedesigned.jsx`, `CarParts.js` | Load More → unbounded DOM growth |

### 10.6 Files > 500 lines (frontend)

| File | Lines |
|---|---|
| `PostCar.js` | 3,198 |
| `AccountSettings.js` | 1,585 |
| `PostBike.js` | 1,172 |
| `CarDetail.jsx` | 1,111 |
| `PostPlate.js` | 1,050 |
| `PostCarParts.js` | 980 |
| `CarList.jsx` | 870 |
| `Signup.js` | 1,259 |
| `DealerWebhooks.jsx` | 652 |
| `BikeDetailRedesigned.jsx` | 657 |
| `PartDetailRedesigned.jsx` | 610 |
| `DealerApiSources.jsx` | 589 |
| `PlateDetailRedesigned.jsx` | 504 |

### 10.7 `motion/react` synchronous import map (full list)

**Parent `components/` admin (10):** `AdminDashboard.js:3`, `AdminDealers.js:3`, `AdminListings.js:3`, `AdminListingDetail.jsx:3`, `AdminMetrics.js:3`, `AdminReports.js:3`, `AdminTools.js:3`, `AdminUserDetail.jsx:3`, `AdminUsers.js:3`, `AdminDealerDetail.jsx:3`.

**`components/admin/` subdirectory (6):** `AdminDealerAuditLog.jsx:3`, `AdminDealershipDetail.jsx:3`, `AdminRedditVerify.jsx:3`, `AdminVinOpens.jsx:3`, `ReasonModal.jsx:2`, `RedditImportAnalyticsPanel.jsx:2`.

**`components/dealer/` subdirectory (15):** `DealerDashboard.jsx:2`, `DealerInfoRequest.jsx:3`, `DealerInviteAccept.jsx:3`, `DealerKpiTiles.jsx:2`, `DealerLeads.jsx:4`, `DealerListingAnalytics.jsx:3`, `DealerListingDiagnostic.jsx:3`, `DealerListingMarket.jsx:3`, `DealerListings.jsx:3`, `DealerPerformers.jsx:3`, `DealerSettings.jsx:2`, `DealerTeam.jsx:2`, `DealerTrends.jsx:2`, `DealerFunnel.jsx:2`, `DealerWebhooks.jsx:2`.

Plus `ReportButton.jsx:2` (top-level).

**Total: 32 components** synchronously import `motion/react`. Removing it from the initial bundle requires either dynamic import or React.lazy wrapping the dealer/admin subtrees (which is the same pattern `App.js:38-43, 142-160` already uses for the lazy half).

### 10.8 `axios` vs `apiClient` vs raw `fetch` — three different patterns

| Pattern | Files |
|---|---|
| `apiClient` (recommended) | `DealerApiSources.jsx`, `AdminDealershipDetail.jsx`, `AdminDealershipsHub.jsx`, `AdminFeaturedListings.jsx`, `AdminRedditVerify.jsx`, `AdminVinOpens.jsx`, `FeatureListingModal.jsx`, `FeaturedPlacementSettings.jsx`, `ListingPicker.jsx`, `VinRevealAnalyticsModal.jsx`, `DealerFunnel.jsx`, `DealerKpiTiles.jsx`, `DealerLeadDetail.jsx`, `DealerLeads.jsx`, `DealerListingAnalytics.jsx`, `DealerListingDiagnostic.jsx`, `DealerListingMarket.jsx`, `DealerListings.jsx`, `DealerListingsLimitCard.jsx`, `DealerPerformers.jsx`, `DealerSettings.jsx`, `DealerTeam.jsx`, `DealerTrends.jsx`, `DealerWebhooks.jsx`, `ProfileMenu.js`, `RenewListing.jsx`, `PostCar.js`, `PostBike.js`, `PostPlate.js`, `PostCarParts.js`, `useDealerLeadsRealtime.js`, `AuthCallback.jsx` |
| `axios` direct (legacy) | `HomePage.js`, `BikeDetailRedesigned.jsx`, `PlateDetailRedesigned.jsx`, `PartDetailRedesigned.jsx`, `PostBuyingRequest.jsx`, `ResetPassword.js`, `ForgotPassword.js`, `ReportBugButton.jsx`, `CarDetail.jsx` |
| Raw `fetch()` (public/token-in-URL) | `DealerInfoRequest.jsx`, `DealerInfoRequest` (token endpoints), `Signup.js`, `Login.js`, `VerifyPhone.js`, `ResetPassword.js`, `ForgotPassword.js`, `CheckEmail.js`, `Settings.js`, `Contact.js`, `PlatformAnalyticsTracker.js` (`/api/analytics/events`), `RecommendedListings.jsx`, `ApiTest.js`, `BetaGate.js`, `AuthCallback.jsx` |

### 10.9 Console.log audit

- `AccountSettings.js`: ~8 (mostly `console.error`/`console.log` for debugging)
- `PostCar.js`: ~12
- `AuthContext.js`: **~30+** (heavy debug logging)
- `ApiTest.js`: 5
- `DealerWebhooks.jsx`: 4
- Most other components: 0-3
- `CarDetail.jsx`: 5

### 10.10 `useDealerLeadsRealtime.js` is the only frontend file importing Supabase client directly

Five files import Supabase directly:

- `DealerInventory.jsx:13`
- `DealerInventoryJobDetail.jsx:8`
- `DealerWebhooks.jsx:15`
- `useDealerLeadsRealtime.js:3`
- `DealerSettings.jsx:6` (named import `getBestAccessToken`, but still pulls in `supabaseClient`)

The 5th pulls `supabaseClient` into the dealer chunk, which is fine — but `DealerSettings` is one of the 9 synchronously-imported dealer pages, so **the full Supabase client is in the initial bundle** via this route.

---

## 11. Frontend — utils and context

### 11.1 Two parallel token-storage mirrors

- `supabaseClient.js` writes to `sessionStorage.supabase_access_token` + `sessionStorage.authData`.
- `authService.js` writes to **the same `sessionStorage.supabase_access_token` + `sessionStorage.authData`** keys, plus the legacy `localStorage` cleanup.
- Two `clearLegacyPersistentAuth()` functions — one in each module — scrub the same `localStorage` keys at import time.
- Two `getCurrentUser` implementations — `authService.getCurrentUser` (axios / `/api/auth/me`) and `supabaseClient.getCurrentUser` (Supabase JS SDK `auth.getUser()`). `AuthContext.js` mixes both.

### 11.2 Import-time side effects (cost paid before first paint)

| File | Effect |
|---|---|
| `supabaseClient.js:14-28` | `clearLegacyPersistentAuth()` scrubs `localStorage` on import |
| `supabaseClient.js:30` | `createClient(...)` constructs singleton Supabase client |
| `supabaseClient.js:85-93` | `_AUTH_TRACE` initializer reads `window.location.search` + `localStorage.DEBUG_AUTH` |
| `authService.js:17-29` | `clearLegacyPersistentAuth()` scrubs `localStorage` again (duplicate work) |
| `authService.js:31` | runs the scrub synchronously at module load |
| `botSignals.js:13-14` | registers `pointermove` + `scroll` global listeners at import |

All of these are reached on initial render because `index.js:6` calls `initializeAuth()` synchronously and `App.js:3-5` mounts the contexts whose top-level imports trigger `supabaseClient` + `authService`.

### 11.3 `Intl.NumberFormat` constructed per call

In `utils/seo.js:29` (`formatMoney`), `utils/adminUtils.js:3,12` (`formatNumber`, `formatCurrencyAED`), every call constructs a fresh `Intl.NumberFormat` (≈50 µs each). With 13 `formatMoney` calls per `AdminMetrics` Acquire tab render, that's ~650 µs per render from this alone.

### 11.4 Two parallel `API_BASE_URL` resolution patterns

- `media.js:1` — `process.env.REACT_APP_API_URL || 'http://localhost:8000'` (no prod fallback).
- `DealerInfoRequest.jsx:6-9` — same + a hostname check that prefers `https://api.dphclassifieds.com` in prod.
- `RequestCarModel.jsx:8` — same as `media.js` (no prod fallback).

Three different fallback chains. Inconsistent.

### 11.5 Two duplicate `buildLoginRedirect` helpers

- `utils/contactAccess.js:1-2`
- `context/SavedListingsContext.js:29-36` (private, not exported)

`countryCodes.js` does NOT contain a `buildLoginRedirect` (the prior audit's mention was a phantom).

### 11.6 `formatters.js` missing from web; `mobile/src/utils/formatters.js` exists with `formatPrice`, `formatDate`, `formatNumber`, `timeAgo`. Web has no centralized formatter — `formatPrice` is duplicated in `HomePage.js`, `ExplorePage.jsx`, `BuyingRequestsPage.jsx`.

### 11.7 `frontend/.env.production` exists and is committed

Contains live `REACT_APP_SUPABASE_URL`, `REACT_APP_SUPABASE_KEY`, `REACT_APP_POSTHOG_KEY`, `REACT_APP_TURNSTILE_SITE_KEY`, `REACT_APP_GA4_MEASUREMENT_ID`. All are public/anonymous ingest keys by design — but rotation requires a redeploy.

---

## 12. Frontend — public assets / src assets

### 12.1 Storage waste (committed-but-unused)

| Category | Bytes |
|---|---|
| Orphan `public/` images (`instagram.png`, `redditlogo.png`, `About-page.avif`, `IMG_3391.avif`) | 1,229,358 |
| Orphan JPGs in `public/images/optimized/` (AVIF is the source-of-truth, JPGs never imported) | 853,141 |
| Orphan `public/images/plates/*` (7 files — React renders plates via `UAELicensePlate.js`, not PNGs) | 281,080 |
| Orphan `src/assets/images/*` (**zero files imported** in this folder) | 2,071,338 |
| **Total audited dead weight** | **≈ 4.4 MB** (~78% of the 5.6 MB committed static-asset budget) |

### 12.2 Duplicate logos

- `instagram-logo.png` (78 KB, 608×584) — used
- `instagram.png` (5 KB, 225×225) — orphan
- `reddit-logo.png` (62 KB, 656×656) — used
- `redditlogo.png` (58 KB, 860×900) — orphan

### 12.3 AVIF + JPG fallbacks

- `hero.avif` (538 KB) + `images/optimized/hero-1600.jpg` (662 KB) — only `.avif` is referenced.
- `images/bottom-landing.avif` (152 KB) + `images/optimized/bottom-landing-1600.jpg` (191 KB) — only `.avif` is referenced.

**The `optimized/` directory is dead weight** — no build pipeline consumes those JPGs.

### 12.4 `public/index.html` issues

- `<meta property="og:image:type" content="image/webp" />` while `og:image` URL points to `/hero.avif` — type/value contradiction.
- `manifest.json` uses inconsistent `?v=` cache-busters (`?v=4` for favicon, `?v=3` for logos).
- `favicon.ico` is **not a real ICO container** — magic bytes are PNG (32×32 RGBA).
- 3 Google Fonts CSS links (Inter, Plus Jakarta Sans, Material Symbols Outlined) — every visitor pays for these.

### 12.5 `frontend/build/` is gitignored but exists locally (~48 MB) — correct.

### 12.6 `craco.config.js`

Only two customizations: `parser.amd=false` for `@tensorflow`/`nsfwjs`/`@tensorflow-models`, and suppression of the "Critical dependency: require function is used" warning. **No image-optimization plugin** (no `image-minimizer-webpack-plugin`, no `@squoosh/lib`, no `sharp`, no `responsive-loader`, no `<picture>` source-set transform).

### 12.7 `tailwind.config.js`

`content: ["./src/**/*.{js,jsx,ts,tsx}"]` — only scans `src/`. No weird exclusions.

---

## 13. Frontend — build/deploy config

| File | Issue |
|---|---|
| Repo-root `Dockerfile` | **Does not exist.** |
| `nixpacks.toml` AND `railway.json` | **Duplicate.** Both define the same build + start commands. Nixpacks builder is configured in `railway.json` so `nixpacks.toml` is partly redundant. |
| `nixpacks.toml` paths | References `requirements.txt` at working dir root — **but Python deps live at `flask-react-supabase-app/backend/requirements.txt`**. Path bug. `start-local.sh` does `cd "$BACKEND_DIR"` before pip. |
| Repo-root `vercel.json` vs `frontend/vercel.json` | **Duplicate.** Inner is a superset (extra sitemap + cars rewrites, explicit source-map env). |
| Repo-root `start-local.sh` vs `flask-react-supabase-app/start-local.sh` | **Duplicate.** Both start the backend on different ports / mechanisms. |
| `backend/.env.railway.example` | Stale partial duplicate of `backend/.env.example`. References Infobip (retired per `.env.example:29`). Missing OCR/Vision/Reddit env. |
| `backend/Procfile` | Only useful for Heroku. |
| `backend/runtime.txt` | `python-3.11` (no patch). |
| `backend/Dockerfile` | `python:3.11-slim-bookworm`. Single-stage. No build-time model loading for vision/ocr. `.dockerignore` excludes secrets. |
| `ocr-service/Dockerfile` | **Bakes `OCR_LANG=en` into image** at line 8. `EXPOSE 8000` but binds `${PORT:-8080}` — **port mismatch**. `download_models.py` deliberately NOT run at build. |
| `vision-service/Dockerfile` | CPU-only (`device="cpu"` hardcoded in `app.py:57-59`). Same `EXPOSE 8000` vs `${PORT:-8080}` mismatch. |
| `.env` (root) | Empty. |
| `.dockerignore` (root) | Aggressive: excludes all PNG/JPG, `client_secret*.json`, `.env*`. Good. |
| `.gitignore` | Has `/non-essential/`, `/build/`, `.env`, credential globs, `.worktrees/`, `.playwright-mcp/`, `.ruff_cache/`, `.agents/`, `.claude/`. Good. |
| `frontend/scripts/ensure-mediapipe-sourcemap.js` | Writes an empty sourcemap for `@mediapipe/tasks-vision`. |
| `frontend/scripts/audit-media-assets.mjs` | Validates asset sizes >1 MiB and SHA-256 dupes. CI-style script. |
| `frontend/scripts/verify-deploy-assets.js` | Post-deploy smoke test that `/static/*` paths return non-`text/html`. Catches the SPA-fallback-as-chunk bug. |
| `scripts/build-backend-image.sh` | Local Docker build helper. |
| `scripts/check-api.sh` | Curl smoke against running backend. |
| `scripts/railway-redis-setup.sh` | `railway add --database redis`. |

---

## 14. Microservices

### 14.1 OCR service

- FastAPI + PaddleOCR. Endpoints: `GET /health`, `POST /scan`.
- Heavy imports at top: `numpy`, `PIL`. Lazy: `paddleocr.PaddleOCR` inside `_load_predictor` (line 51-57).
- **Model loading:** background thread on startup (`@app.on_event("startup")`). `/health` returns `503 {"status":"loading"}` until predictor is loaded.
- **Inference serialised** by `threading.Lock` (`_infer_lock` at line 47) — PaddleOCR's predictor is not thread-safe.
- **Concurrency cap:** `asyncio.Semaphore` (`OCR_MAX_CONCURRENCY` = 2 default).
- **Auth:** shared-secret API key on `POST /scan` via `X-OCR-Service-Key` header.
- **Cold-start:** first container boot downloads PaddleOCR model weights (~50-100 MB) over the wire. After that, in-process predictor init only.
- **No DB / no Supabase.** Reached over Railway private networking.
- **Issue:** comment `ocr-service/app.py:25-29` says paddlepaddle segfaults in buildkit sandbox — so build-time warming is intentionally skipped. **First boot pays cold-cache download cost.**

### 14.2 Vision service

- FastAPI + NudeNet + OpenCLIP (`ViT-B-32` `laion2b_s34b_b79k`). Endpoints: `GET /health`, `POST /v1/analyze`.
- **CPU-only hardcoded** (`device="cpu"`). `torch==2.6.0` installed but not GPU-aware.
- **Warmup:** one harmless CPU `encode_text(["a vehicle listing photo"])` at end of `_load_models` to surface any first-call lazy init before readiness.
- **Concurrency cap:** `VISION_MAX_CONCURRENCY=1` default. Serialized by `_lock`.
- **Auth:** shared-secret API key.
- **Cold-start:** ~250 MB model download on first boot.
- **No DB / no Supabase.**

### 14.3 devvit bot (`devvit/dph-bot/`)

- TypeScript esbuild bundle to `dist/server/index.js` (≈3 MB).
- 3 endpoints: `/internal/cron/roundup`, `/internal/on/menu/roundup`, `/internal/on/menu/force-roundup`. All POST-only.
- HMAC verification (`hmac.ts`) — `crypto.timingSafeEqual`, canonical JSON with sorted keys, excludes `generated_at`, `signature`, `signature_version` from signed payload.
- URL allowlist: exact-host match for `api.github.com` (`server.ts:63-65`).
- 10-minute cooldown on `/force-roundup` (`FORCE_REPOST_COOLDOWN_MS`).
- **Fully independent codebase** — not referenced by web/mobile/frontend.

---

## 15. Mobile app (`mobile/`)

### 15.1 Heavy deps not in initial mobile bundle but loaded on demand

| Dep | Trigger | Files |
|---|---|---|
| `@tensorflow/tfjs`, `@tensorflow/tfjs-react-native` | First `moderateImage()` call in post-listing flow | `imageModeration.js` (top-level) |
| `nsfwjs`, `@tensorflow-models/blazeface` | First `loadModels()` call | `imageModeration.js:42-46` (dynamic) |
| `@shopify/react-native-skia` | Photo editor open | `bakeImageEdits.js`, `PhotoEditorModal.js` |
| `react-native-maps` | Listing detail / post-listing map | `mapComponents.native.js:1` |
| `expo-location` | Post-listing "use my location" | `PostListingScreen.js:9` |
| `expo-image-picker` | Image pick | `PostListingScreen.js:6`, `SettingsScreen.js:6`, `ocrScanner.js:1` |
| `expo-document-picker` | OCR doc pick | `ocrScanner.js:2` |
| `posthog-react-native` | Boot | `app/_layout.tsx:20` |
| `@expo-google-fonts/plus-jakarta-sans` (5 weights) | Boot (blocks first paint via `useFonts`) | `app/_layout.tsx:12-18` |
| `react-native-webview` | Privacy/Terms/Turnstile modal | PrivacyPolicyScreen, TermsOfServiceScreen, turnstile.js |

### 15.2 Direct Supabase imports

Only **one** mobile screen imports Supabase directly: `ForgotPasswordScreen.js:5` calls `supabase.auth.resetPasswordForEmail`. Everything else goes through `apiClient` REST or `useAuth`.

### 15.3 Heavy file

- `PostListingScreen.js` — **2,935 lines**. Single screen combining listing create + edit, image upload + moderation + Skia photo editor + OCR registration scanner + map location picker + draft autosave + 3 lazy chunks.

### 15.4 Mobile — same patterns as web

- `console.log` — only 1 (gated by `__DEV__`).
- `React.memo` — 0.
- List virtualization — `@shopify/flash-list` for long lists, no `react-window`-style in-place virtualization.
- All API calls are async inside `useEffect`/`useFocusEffect`/user-action handlers.

### 15.5 Mobile dead code

`mobile/src/screens/home/HomeScreen.js` (357 lines) is not routed via `app/` — likely legacy/unused. `mobile/examples/native-tabs-liquid-glass/` is template/boilerplate, ~190 lines of unrelated code.

### 15.6 Console.log unguarded in mobile

`mobile/src/utils/supabaseClient.js:86` prints a deep-link URL to console in all builds — `console.log('[GoogleAuth] Add this to Supabase Redirect URLs:', MOBILE_REDIRECT_URL)`. No `__DEV__` guard.

---

## 16. Tests / CI

- **95 `test_*.py` files, ~13,823 lines.**
- **Only 3 require live services:**
  - `test_fixes.py` — live Supabase
  - `test_reminders_local.py` — live Supabase + Resend (or `--dry-run`)
  - `test_vin_integration.py` — live NHTSA (gated by `TEST_NHTSA_LIVE=1`)
- 1 conditional: `test_dealer_isolation.py` (skips without `TEST_SUPABASE_URL`).
- 1 contract test: `test_mobile_msg91_contract.py` reads `mobile/package.json`.

**No CI exists anywhere.** No `.github/`, no `.circleci/`, no `.gitlab-ci.yml`, no `Jenkinsfile`. `Procfile` and `Dockerfile` don't invoke tests.

- **Root `README.md` is a 5-line stub** (`"hihi."` + blank lines).
- **`flask-react-supabase-app/README.md` does not exist.**
- Repo has docs under `flask-react-supabase-app/docs/` and `non-essential/vault/` (10 design specs in `vault/`, none wired into build).

---

## 17. Concurrency, Threading, Rate-Limit (consolidated)

### 17.1 Concurrency hazards

| Hazard | Location |
|---|---|
| `_REDIS_CACHE_CLIENT` race | `app.py:578-598, 622, 658, 759` — no lock |
| `_MEMORY_AUTH_REVOCATIONS` unbounded | `app.py:3385` |
| Per-contact-event `threading.Thread` | `app.py:21616-21622` — unbounded |
| Multi-replica worker safety | All `worker.py` loops rely on row-level locks; no leader election |
| `_sync_listing_lifecycle` mutates `record` dict | `app.py:1553, 1580, 1633, 1705` — race on auto-review stamping |
| `_run_listing_expiry_reminders_once` per-row RPC + writes | `app.py:25102-25291` — `4 + 2N` round-trips per tick |
| `_run_listing_lifecycle_sweep_once` per-row PATCH | `app.py:25294-25337` — `4 + N` round-trips |
| Dealer verification polling (8s) | `DealerVerificationPage.jsx:101-108` — no visibility guard |
| Polling interval resets to base on work | `worker.py:131-150` — sustained load = no backoff |

### 17.2 Rate-limit gaps

| Gap | Location |
|---|---|
| OTP send only Redis; Redis-down = unthrottled | `app.py:12362-12364` |
| `_contact_lead_rate_limited` dict unbounded | `app.py:155` |
| All 3 limiters share one lock | `app.py:159` |
| `_send_infobip_sms` always raises | `app.py:4710-4716` — non-MSG91 country = 500 |
| `renewal_nudge_sms` / `renewal_nudge_whatsapp` import will fail | `routes/admin.py:2551-2556` — `ImportError` at runtime |
| `expo_push.send_expo_push` truncates to 100 | `expo_push.py:28` |

---

## 18. PostHog / analytics overhead

### 18.1 What runs at boot

| File | Behavior |
|---|---|
| `index.js:13` | `initAnalytics()` → defers via `requestIdleCallback` (or 2s timeout) |
| `initAnalytics()` in `utils/analytics.js` | Lazy-imports `posthog-js` via `await import(...)` only if `REACT_APP_POSTHOG_KEY` set |
| `initGa4` | Injects `https://www.googletagmanager.com/gtag/js?id=…` |
| `initClarity` | Injects `https://www.clarity.ms/tag/<id>` |
| `AuthContext.js:235` | Subscribes to `supabase.auth.onAuthStateChange` at boot |
| `App.js:267` | `<PlatformAnalyticsTracker />` mounts unconditionally — `fetch('/api/analytics/events')` on every view |
| `App.js:268` | `<PostHogPageview />` mounts unconditionally |
| `App.js:269` | `<UserBehaviorTracker />` mounts unconditionally — `JSON.parse(localStorage.dph_user_behavior)` + filter + unshift + slice + stringify + write on every route change |
| `App.js:30` | `UserBehaviorTracker.jsx` synchronously imports `userBehavior.js` |

### 18.2 Per-request overhead

- `_capture_posthog_event` (app.py:105-116): swallows errors. On every login, signup, listing create/update/delete, lead event, etc.
- `UserBehaviorTracker.jsx` (line 23, 29): `trackView`, `trackSearch` — `JSON.parse` + `filter` + `unshift` + `slice` + `JSON.stringify` on every route change.

---

## 19. Security / Performance Overlap

### 19.1 RLS

- `dealer_info_requests` has only `svc_dealer_info_requests` — **no public read policy**. Token-based URL access works only because the route is gated by token + no auth header.
- `model_registry` table created without RLS.
- 30+ tables `ENABLE RLS only` (no policy). Backend uses service_role, so reads work — but any client attempting to read via Supabase JS SDK fails.
- `is_admin(...)` function has two signatures (`()` vs `(user_id UUID)`). Non-deterministic at RLS evaluation time — depends on which migration ran last.

### 19.2 Auth

- `_send_infobip_sms` always raises `RuntimeError` — non-MSG91 country = 500.
- `_send_renewal_nudge_sms` / `_send_renewal_nudge_whatsapp` lazy-imports but the functions **do not exist anywhere** — `ImportError` at first call.
- `Login.js` bypasses `apiClient` to use raw `fetch` — skips the localhost↔127.0.0.1 retry fallback and 401-retry-after-refresh.
- `ResetPassword.js` and `ForgotPassword.js` use **axios** directly — same gap.

### 19.3 Image size / compression

- `MAX_CONTENT_LENGTH = 25 * 1024 * 1024` (25 MB) hardcoded at `app.py:87` — `MAX_UPLOAD_SIZE_MB` env var at `app.py:141` only consumed inside `upload_to_supabase_storage`. The env var has no effect on the route layer.
- Image pipeline (`upload_to_supabase_storage` at `app.py:8695`): `Image.verify()` + `Image.open()` + `Image.open()` + `Image.load()` — **2 PIL opens + 1 verify per file**.
- For listing images: also `_build_display_variant` at the same call site (second PIL decode/encode + JPEG re-encode at quality 0.88).
- HEIC byte sniff via `FileReader` first 16 bytes.
- TUS uploads chunk at 6 MB.

### 19.4 Compression

- Both `flask-compress==1.15` AND `brotli==1.2.0` are installed. Verify both compression paths are wired.

### 19.5 Rate-limit code paths

- `/api/contact` — `_contact_rate_limited` (5/hr).
- `/api/car-model-request` — same.
- `/api/listings/<type>/<id>/lead-events` — `_contact_lead_rate_limited` (40/hr).
- `/api/auth/login`, `/api/auth/signup`, `/api/phone-verifications/start/verify/verify-token`, `/api/auth/refresh`, `/api/auth/reset-password`, `/api/auth/resend-confirmation` — `_auth_rate_limited` (5/5min).
- OTP send — Redis-only `otp_send_phone` (3/10min). **Redis-down = unthrottled.**

---

## 20. Dead / Commented / TODO (consolidated)

| Location | Note |
|---|---|
| `app.py:19649` | Commented `# app.register_blueprint(admin_bp)` |
| `app.py:17927-18031` | Orphaned handler body (missing route decorator) |
| `app.py:19940` | Unreachable `return redirect(...)` in `reject_item_api` |
| `app.py:4710-4716` | `_send_infobip_sms` stub that always raises |
| `routes/admin.py:2551-2556` | Imports `_send_renewal_nudge_sms` and `_send_renewal_nudge_whatsapp` which don't exist |
| `app.py:25340-25341` | Stale comment "Admin routes are registered at the top" |
| `verify_complete_fix.py` | **No `__main__` guard** — import-time HTTP probes |
| `setup_storage_bucket.py` | **No `timeout=` on `requests.post`** |
| `mobile/src/utils/supabaseClient.js:86` | Unguarded `console.log` of deep-link URL |
| `nixpacks.toml` paths | References `requirements.txt` at working dir root — wrong path |
| `railway.json` | Duplicates `nixpacks.toml` |
| Root `vercel.json` | Duplicates `frontend/vercel.json` |
| Root `start-local.sh` | Duplicates `flask-react-supabase-app/start-local.sh` |
| `backend/.env.railway.example` | Stale; references retired Infobip |
| Repo `requirements.txt` (N/A — doesn't exist) | path bug |
| `ocr-service/Dockerfile` | Bakes `OCR_LANG=en` into image |
| `ocr-service/Dockerfile` + `vision-service/Dockerfile` | `EXPOSE 8000` mismatch with actual bind port `${PORT:-8080}` |

---

## 21. What Can Save A Second

Based on the audit, the highest-leverage perf wins are:

1. **Replace per-row expiry/lifecycle sweeps with bulk SQL.** `_run_listing_expiry_reminders_once`, `_run_listing_lifecycle_sweep_once`, `_run_dealer_doc_expiry_reminders_once` — three sweep functions, each currently `4 + 2N` round-trips per tick. A single SQL function (`UPDATE … RETURNING …`) per sweep replaces this with 1 round-trip per table. **Estimated per-tick savings: 10–100s of round-trips depending on row count.**

2. **Lazy-load the 9 dealer pages** that are currently synchronous in `App.js:19-27`. Each imports `motion/react` (≈50 KB gz). Initial bundle savings: ~200–400 KB gz. First-page-render improvement: measurable on cold cache.

3. **Drop `psygopg2-binary`, `matplotlib`, `nudenet`, `opencv-python-headless`, `onnxruntime`, `numpy` from the web image.** All are lazy-loaded but still installed in `pip install -r requirements.txt`. Split `requirements.txt` into `requirements-web.txt` and `requirements-worker.txt`. Web image gets smaller.

4. **Lazy `CarDetail.jsx`'s `react-leaflet`.** It synchronously imports `MapContainer`, `Marker`, `TileLayer`, plus `leaflet` and the marker PNGs (`CarDetail.jsx:17-21`). The map is below the fold for most visitors. Use the same dynamic-import pattern as `PostCar.js:217-225`. Saves the leaflet bundle (~150 KB gz) from the `/cars/:id` chunk.

5. **Add a composite index on `dealer_documents(user_id, uploaded_at DESC)`** and `reports(reporter_id, created_at DESC)` and `users(is_dealer, dealer_verified, dealer_verification_requested_at)` — these are the three "partial coverage" gaps in §6.3.

6. **Cache `_get_user_email` results** for the lifetime of a process. It's called from `create_car`, `update_car`, `create_bike`, `create_plate` — every CRUD hot path issues 2 REST calls (`/rest/v1/users` + `/auth/v1/admin/users`) per call.

7. **Replace direct `requests.get` / `requests.patch` in `app.py` admin bulk endpoints** (`_admin_renew_listings_bulk`, `admin_approve_listings_bulk`, `admin_delete_listings_bulk`) with bulk SQL — each currently does `requests.get + requests.patch + email + cache invalidation` per item, capped at 200 items per call.

8. **Debounce `CarList.jsx` filter typing** to reduce fetches from one-per-keystroke to one-per-300ms.

9. **Make `MarketplaceListingCard` the only memoized card** — already done. **Memoize `LazyImage`, `ImageLightbox`, and the 30+ admin/dealer rows that re-render unnecessarily on parent state change.**

10. **Add `width` + `height` HTML attrs to every `<img>`** — eliminates CLS contribution from 100+ images across the app. Largest CLS wins are on the homepage hero (already has `width="1600" height="1143"`), `CarList`/`BikeList`/`PlateList`/`PartList` thumbnails, and `AdminUsers`/`AdminReports` avatars.

---

## 22. Summary by File Count

| Category | Count |
|---|---|
| Files audited (every layer) | ~600 |
| Python files | ~250 |
| React components | ~120 |
| React utils / context / hooks | ~80 |
| SQL migrations | 117 |
| Mobile screens / utils / components | ~100 |
| Devvit TypeScript files | ~8 |
| Microservice Python files | ~6 |
| Documentation / vault / skills / non-essential | ~80 |
| Test files | 95 |
| **Total** | **~1,400 files** |

---

## 23. Recommended Next Steps (for the senior developer)

1. **Split `app.py` by feature**: `app/blueprints/listings.py`, `app/blueprints/auth.py`, `app/blueprints/admin.py`, `app/blueprints/dealer.py`, `app/blueprints/notifications.py`, etc. Each blueprint owns its routes + helpers + email builders.
2. **Add a CI pipeline** (`.github/workflows/ci.yml`) that runs `pytest backend/test_*.py` on every PR. The 95 test files are already there; just wire them up.
3. **Replace per-row sweep functions with 3 bulk SQL stored procedures** for listing expiry, listing lifecycle, and dealer doc expiry. This is the single biggest CPU/network win in the backend.
4. **Lazy-load the 9 synchronous dealer pages** + remove `motion/react` from `Header.js`/`Footer.js`'s bundle path (these already don't use motion).
5. **De-duplicate `_svc` and `_token_required` in `routes/dealer/`** — extract to `routes/dealer/_common.py`.
6. **Fix the 3 hard import errors**: delete the orphan handler body at `app.py:17927-18031`, delete the unreachable line `app.py:19940`, fix the missing `_send_renewal_nudge_sms`/`_send_renewal_nudge_whatsapp` imports in `routes/admin.py`.
7. **Clean up `frontend/public/`** — delete `instagram.png`, `redditlogo.png`, `About-page.avif`, `IMG_3391.avif`, the `images/optimized/` JPGs, and `images/plates/*` (~833 KB recovered).
8. **Clean up `frontend/src/assets/images/`** — every file is orphan; delete the entire folder (~2 MB recovered).
9. **Remove unused deps from `package.json`**: `react-router`, `@tensorflow-models/blazeface`, `html2canvas`. Trim `package.json` dependencies by ~3 entries.
10. **Add image-optimization plugin** to `craco.config.js` (`image-minimizer-webpack-plugin` with `@squoosh/lib`) — auto-generates AVIF/WebP variants and responsive sizes at build time.
11. **Add `React.memo` to the 30+ list-rendering components** that re-render on parent state changes (admin tables, dealer tables, marketplace cards).
12. **Memoize `getGalleryImages`** in `CarDetail.jsx` / `BikeDetailRedesigned.jsx` / `PlateDetailRedesigned.jsx` / `PartDetailRedesigned.jsx` — currently runs 3+ times per render.
13. **Consolidate the `path_map` / `paths` dicts** that appear in 3 different forms across `_build_listing_title` / `_build_listing_url` / `_build_public_listing_url` / `_resolve_featured_listing_meta`.
14. **Set `React.StrictMode` double-invoke logging** — currently the dev server doesn't surface double-effect issues because `index.js` doesn't wrap `<App />` in `<React.StrictMode>`.
15. **Add `intersection-observer`-based lazy loading** for `CarDetail.jsx`'s gallery images (currently 12-image `<img>` tag array renders all at once when the page opens).

---

# Deployment-Readiness Audit — Addendum

**Scope:** Fresh-eyes audit focused on *will this app boot and run cleanly on first production deploy*, complementing the deep feature/perf audit above.
**Mode:** Read-only. No files modified.
**Branch audited:** `main` @ `c5741ff4`.

**Validators actually run**

| Surface | Validator | Result |
|---|---|---|
| Backend | `python3 -c "import ast; ast.parse(...)"` on every `.py` under `backend/` (168 files, excl. venv/cache) | **0 syntax errors** |
| Frontend | `npx tsc --noEmit` | **PASS** (8 TS files, `tsconfig.json` `"strict": false`) |
| Mobile | `npx tsc --noEmit` | **FAIL — 47 errors** (32 in `app/`, 15 in `node_modules`) |
| Repo | `git status --porcelain` | 1 pre-existing unstaged deletion (`dphsecuritypatch.md`), unrelated |

---

## A. CRITICAL — Will break on first deploy or first hit

### C1. Conflicting `vercel.json` files at repo root and frontend dir
- `/Users/.../vercel.json` rewrites `/cars/(.*)` → `/api/cars/$1` and declares a CSP/HSTS/Permissions-Policy header set.
- `/Users/.../flask-react-supabase-app/frontend/vercel.json` has the same `/cars/(.*)` rewrite plus a full SPA fallback.
- The root file declares no `framework`, no `buildCommand`, no `outputDirectory`. Vercel uses **one** `vercel.json` per project: if the root wins, the build fails (no output dir); if the frontend wins, the root's security headers are silently lost (different CSP allow-list).
- **Fix:** delete the root `vercel.json` (the frontend one is complete). Or set `"rootDirectory": "flask-react-supabase-app/frontend"` in the root and delete the inner one.

### C2. `/cars/(.*)` rewrite hijacks SPA detail pages
- Same rule rewrites `/cars/abc` → `/api/cars/abc` for **all** user agents. Handler at `frontend/api/cars/[slug].js` only renders crawler cards to bots; for humans it proxies the SPA shell (`[slug].js:30-33`).
- That proxy path works today but: (a) pays a full-HTML round-trip on every detail-page load, (b) depends on `https://www.dphclassifieds.com/` being reachable from Vercel's edge, (c) silently degrades (`503` only if the upstream fetch actually fails).
- **Fix:** remove the `/cars/(.*)` rewrite entirely; keep the SPA fallback and let React Router handle the route. The crawler-card function can stay reachable via a dedicated `/preview/cars/<slug>` path.

### C3. Production API URL inconsistency across the frontend
- `frontend/src/utils/apiClient.js:6` — `DEFAULT_PROD_API_URL = 'https://api.dphclassifieds.com'`.
- `frontend/.env.production:1` — `REACT_APP_API_URL=https://dphclassifieds-production.up.railway.app`.
- Today's bundle is built with `REACT_APP_API_URL` set, so the live build is correct.
- But: `frontend/src/utils/authService.js:4`, `frontend/src/components/dealer/DealerSettings.jsx:13`, `DealerInfoRequest.jsx:6`, and `frontend/vercel.json` all hard-code `api.dphclassifieds.com`.
- If `REACT_APP_API_URL` is ever unset in Vercel project env vars, the apiClient hits the Railway host while those modules silently hit the wrong `api.dphclassifieds.com` host. Two production URLs, three different defaults.
- **Fix:** pick one canonical URL. Then align every constant + env example to it.

### C4. Mobile: 32 TypeScript errors in route shims — `tsc --noEmit` exits 2
- `npx tsc --noEmit` in `flask-react-supabase-app/mobile/` exits with code 2 and 47 errors. 32 in app code, all in `app/(auth)/*.tsx` and `app/(tabs)/.../*.tsx`.
- Each shim is `<Screen navigation={navigation} route={{ params }} />`. Target screens declare inconsistent prop signatures (some take no props, some only `route`, some both). TypeScript correctly rejects the mismatch.
- Runtime is fine — Metro/Babel strips types. **But any CI/precommit that runs `tsc --noEmit` (per AGENTS.md §7.7) will fail.**
- **Fix:** make every screen accept `{ navigation?, route? }`, OR cast at the shim (`<Screen {...({ navigation, route } as any)} />`), OR split into two shim types per screen.

### C5. Mobile: `_layout.tsx` PostHog null vs undefined
- `app/_layout.tsx:69` — `posthog` is typed `PostHog | null` (because `posthogClient.js` exports `null` when `EXPO_PUBLIC_POSTHOG_API_KEY` is missing); `<PostHogProvider client>` expects `PostHog | undefined`.
- Same TS gate failure as C4. Runtime is null-tolerant in the published JS.
- **Fix:** `client={posthog ?? undefined}` in the call site, or change `posthogClient.js` to export `undefined` when no key.

### C6. Backend: `/api/health` shadowed by stub
- Two routes registered for `/api/health`:
  - `backend/app.py:10090` `health_check` → returns `{"status":"ok"}` regardless of backend state.
  - `backend/app.py:21324` `api_health` → full Redis/worker/snapshot.
- Verified by AST scan + runtime probe. Today the **rich** handler answers `/api/health`, but the stub is still in a 26,060-line file, easy to reorder on accident.
- More importantly: `worker.py` exposes `/api/health` on **port 8080** (default), but the Dockerfile `EXPOSE 8000` and gunicorn default bind `0.0.0.0:8000`. Railway's healthcheck on the worker service will hit a wrong port → connection refused → crash loop if you ever wire the worker to a Railway HTTP healthcheck.
- **Fix:** remove the stub handler at `app.py:10090`, and add a `HEALTHCHECK` to the Dockerfile that selects port based on `SERVICE_ROLE`.

### C7. Backend: `FLASK_SECRET_KEY` fallback breaks sessions in multi-worker prod
- `backend/app.py:4538-4545` falls back to `secrets.token_hex(32)` per import if `FLASK_SECRET_KEY` is unset.
- `backend/gunicorn.conf.py:11` sets `workers = 2`, `preload = False` (deliberate). Two workers = two independent imports = two different ephemeral keys.
- Result: any Flask session cookie or itsdangerous token validates ~50% of the time at random. Login state appears to "log out" between requests on the unlucky worker.
- `.env.example` ships `FLASK_SECRET_KEY=your-secret-key-here-change-this-in-production` as a placeholder. If someone copies `.env.example` → `.env` literally and deploys, sessions are broken.
- **Fix:** fail-fast at startup if `FLASK_ENV=production` (or `RAILWAY_ENVIRONMENT` is set) and `FLASK_SECRET_KEY` is missing or still the placeholder string.

### C8. Backend: 9 routes defined after `if __name__ == "__main__":` block
- `backend/app.py:25656-25680` defines the `__main__` block. Lines 25683-26060 register 9 routes that **never execute under `python app.py`** because `app.run()` at 25680 blocks:
  - `/api/admin/cache/flush`
  - `/api/admin/auto-review/settings`
  - `/api/admin/auto-review/run`
  - `/api/admin/reddit-listings/settings`
  - `/api/admin/reddit-explore/settings`
  - `/api/admin/google-signin/settings`
  - `/api/config/google-signin`
  - `/api/dealer/verification/notify-admin`
  - `/api/dealer/verification/messages`
- Under gunicorn (`app:app`) all 9 register correctly. **Production works, dev doesn't.**
- **Fix:** move `if __name__ == "__main__":` to the end of `app.py`, OR move those 9 routes above line 25656.

---

## B. HIGH — Will misbehave under load, misconfig, or wrong env

### H1. Railway `startCommand` and `nixpacks.toml` install phase run from wrong CWD
- `railway.json` does **not** set a `rootDirectory`. `startCommand` references `gunicorn.conf.py` and `app:app` as if it's in the backend dir, but Railway defaults CWD to repo root.
- `nixpacks.toml:5-9` does `python -m venv .venv && ... pip install -r requirements.txt` — there is no `requirements.txt` at repo root, only at `flask-react-supabase-app/backend/requirements.txt`. **Build will fail with "ERROR: Could not open requirements file: [Errno 2] No such file or directory: 'requirements.txt'".**
- **Fix:** add `rootDirectory: "flask-react-supabase-app/backend"` to `railway.json`, OR change `nixpacks.toml` install/start phases to `cd flask-react-supabase-app/backend && ...`.

### H2. Mobile: `SafeAreaProvider` missing from tree
- `mobile/app/_layout.tsx` mounts `GestureHandlerRootView → ErrorBoundary → PostHogProvider → ThemeProvider → AuthProvider → SavedListingsProvider → AppShell`. **No `SafeAreaProvider`.**
- `react-native-safe-area-context@~5.7.0` is in deps and 200+ components call `SafeAreaView`/`useSafeAreaInsets`.
- On Android with edge-to-edge (default SDK 56+), `useSafeAreaInsets` returns all zeros → content slides under the gesture pill / status bar.
- **Fix:** wrap with `<SafeAreaProvider>` inside `GestureHandlerRootView`.

### H3. Mobile: dev API on HTTP, `usesCleartextTraffic` not enabled for Android
- `mobile/src/constants/config.js:6-8` falls back to `http://localhost:8000` in dev.
- `mobile/app.json` Android block has **no `usesCleartextTraffic: true`** (default is `false` since SDK 49).
- Android dev builds can't reach the local backend unless devs manually `adb reverse tcp:8000 tcp:8000` *and* override the network security config.
- **Fix:** add `"usesCleartextTraffic": true` to `expo.android` for dev, or scope it via a `networkSecurityConfig` that whitelists `localhost` and `10.0.2.2` only.

### H4. Mobile: dual API base URL with port mismatch
- `mobile/src/constants/config.js:6-8` → port `8000`.
- `mobile/src/screens/auth/SignupScreen.js:16` and `mobile/src/screens/auth/CheckEmailScreen.js:11` → port `5000`.
- If `EXPO_PUBLIC_API_URL` is unset in dev, sign-up username-check, email-resend, and email-update hit `:5000` while every other auth call hits `:8000`. Silent CORS/404 in the auth flow.
- **Fix:** import `API_BASE_URL` from `constants/config.js`; delete the local copies.

### H5. Mobile: MSG91 native module will crash in Expo Go if env vars are ever filled
- `mobile/src/utils/msg91.js:28` requires `@msg91comm/sendotp-react-native` at module load. Comment notes "Requires a dev build — native module does NOT run in Expo Go."
- `EXPO_PUBLIC_MSG91_WIDGET_ID` and `EXPO_PUBLIC_MSG91_TOKEN_AUTH` are absent from `mobile/.env` and `mobile/.env.local`, so `isMsg91Enabled()` returns false and the require is never hit. **Currently safe.**
- If anyone fills those vars and runs `expo start` (Expo Go), the very first phone-verification tap will crash.
- **Fix:** defer the `require()` until inside `initMsg91()` and guard on `Constants.executionEnvironment` / `Constants.appOwnership`.

### H6. Backend: dual name for the same secret
- `app.py`, `routes/admin.py`, `auth_cleanup.py`, `health_monitoring.py` → `SUPABASE_SERVICE_ROLE_KEY`.
- All 10 dealer route modules, `services/dealer_market.py`, `services/webhook_dispatcher.py`, 6/8 workers → `SUPABASE_SERVICE_KEY` **first**, fallback to `SUPABASE_SERVICE_ROLE_KEY`.
- Two workers (`dealer_auto_approval_worker.py:29`, `reddit_daily_post_worker.py:34`, `reddit_import_worker.py:35`) **reverse the precedence**.
- `.env.example` documents only `SUPABASE_SERVICE_ROLE_KEY`. `.env.railway.example` is worse (see H7).
- **Fix:** pick one canonical name, update all 30+ call sites, update both example env files.

### H7. Backend: `.env.railway.example` is stale
- Missing from this file (all used by deployed code): `REDIS_URL`, `MSG91_AUTHKEY`, `OCR_SERVICE_*`, `VISION_SERVICE_*`, `POSTHOG_PROJECT_TOKEN`, `POSTHOG_HOST`, `SUPABASE_JWT_SECRET`, `PRIMARY_SUPER_ADMIN_*`, `DEALER_INTEGRATIONS_KEY`, `ENABLE_DEALER_PANEL`, `TRUSTED_PROXY_HOPS`, `WORKER_HEARTBEAT_*`.
- Still documents `INFOBIP_*` as the active provider, but `.env.example:42-44` says "Infobip has been removed." Will mislead anyone setting up Railway.
- `CORS_ORIGINS` placeholder doesn't match the actual frontend origin (`https://dphclassifieds-production.up.railway.app`, `https://www.dphclassifieds.com`).
- **Fix:** regenerate `.env.railway.example` from `.env.example` plus the production-only additions.

### H8. Backend: no automatic migration runner
- `Procfile` has no `release:` line. `nixpacks.toml` `start` phase has no migration step. `apply_migration.py` is a manual one-shot script (`python apply_migration.py <file>`).
- 96 SQL files in `backend/migrations/` with mixed naming conventions (`20260507_*`, `2026_06_03_*`, plus 60+ undated). No ledger, no ordering guarantee.
- Multiple `_v2`/`_FINAL`/`_FIXED` chains with no supersession marker.
- **Fix:** introduce a `schema_migrations` ledger and a `release` Procfile step that runs `python apply_migration.py --pending` against Supabase's `/rest/v1/sql` endpoint. Or use Supabase CLI migrations in `supabase/migrations/`.

### H9. Backend: only one error handler
- `backend/app.py:5457-5469` only handles 500. Anything else on `/api/*` returns Werkzeug HTML.
- **Fix:** add `@app.errorhandler(404)`, `@app.errorhandler(405)`, `@app.errorhandler(413)`, `@app.errorhandler(Exception)` that branch on `request.path.startswith('/api/')` and return JSON.

### H10. Frontend: SPA env contract drift
- Used in code but **never declared** in any `.env*`:
  - `REACT_APP_SITE_URL` (5 files, with two different hardcoded fallbacks — `https://www.dphclassifieds.com` in `seo.js`, `https://dphclassifieds.com` in detail components).
  - `REACT_APP_ENABLE_VERCEL_TELEMETRY` (`src/App.js:236`, falls back to `undefined`, telemetry off — probably intended).
- Declared in `.env.production` but **undocumented** in `.env.example`:
  - `REACT_APP_POSTHOG_KEY`, `REACT_APP_POSTHOG_HOST`.
- Declared in `.env.example` only (silently disabled in prod):
  - `REACT_APP_CLARITY_PROJECT_ID` (`src/utils/analytics.js:7`).
  - `REACT_APP_MSG91_WIDGET_ID`, `REACT_APP_MSG91_TOKEN_AUTH` (`src/utils/msg91Widget.js`).
- **Fix:** add the missing keys to whichever env file is the source of truth, then collapse the per-file `const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000'` pattern to import from `apiClient.js`.

### H11. Frontend: `og:image:type` is `image/webp` but the asset is `image/avif`
- `frontend/public/index.html:38, 49` say `og:image:type="image/webp"` for `/hero.avif`. Crawlers that validate declared MIME vs served bytes will reject the OG card.
- **Fix:** change meta to `image/avif` or transcode the asset.

### H12. Frontend: `authService.js` bypasses apiClient
- `frontend/src/context/AuthContext.js:96-101, 155-159` does a direct `fetch` to `${REACT_APP_SUPABASE_URL}/auth/v1/user`. Bypasses the apiClient's 401-retry/recovery logic. A transient 5xx is interpreted as "session invalid" and clears the user.
- **Fix:** wrap in apiClient (or a dedicated authClient that has its own retry-with-backoff).

### H13. Frontend: `api/cars/[slug].js` proxy path is fragile
- For non-crawlers, `[slug].js:34-36` does `fetch(${SITE_ORIGIN}/)` to get the SPA shell, then returns it. **Re-fetches your own frontend from inside the function on every detail-page load.**
- Fails open (`503` only if upstream fetch actually fails; otherwise returns whatever HTML the fetch returned, which might be a Vercel error page).
- **Fix:** branch on crawler vs. human. For humans, do **not** proxy — `return res.status(404).send('Not a crawler')` and rely on the SPA fallback rewrite to serve `/index.html`. Or remove the entire rewrite and let Vercel's SPA fallback handle `/cars/<id>`.

---

## C. MEDIUM — Debt, drift, partial config

- **M1.** Backend: `python-dateutil` is imported (`app.py:16172`) but not in `requirements.txt`. Only satisfied transitively via `matplotlib`. Add explicitly.
- **M2.** Backend: `psycopg2-binary==2.9.10` declared, **zero imports** anywhere. Dead weight + build-time cost.
- **M3.** Backend: `posthog>=7.0.0` unbounded upper; major bumps could break `capture_exception`.
- **M4.** Backend: 3 of 5 blueprint registrations swallow exceptions (`app.py:5992, 6001, 18906`). An `ImportError` in `routes/admin.py` → silent admin 404s. The dealer registration at `20544` is unguarded → inconsistent. Pick one policy.
- **M5.** Backend: `app.py:11875` and `app.py:11927` both define `find_user_email_by_username`; second shadows first.
- **M6.** Backend: `routes/__init__.py` and `services/__init__.py` don't exist; relies on PEP 420 namespace packages. Fragile if any installed package shadows the namespace.
- **M7.** Backend: `wsgi.py` is dead code (8 lines, no Procfile/Dockerfile reference, would bind `127.0.0.1:5000` if invoked).
- **M8.** Backend: `worker.py:163-195` — import failures log and `return`; worker exits 0 silently while its health endpoint already reported healthy.
- **M9.** Backend: CORS origin default (`app.py:4482`) only includes `dphclassifieds.com/.ae` ±www when `FLASK_ENV=production` **or** `RAILWAY_ENVIRONMENT` is set. Forget to set `FLASK_ENV=production` on Railway → prod frontend gets CORS-blocked.
- **M10.** Backend: `Dockerfile` has no `HEALTHCHECK`; `EXPOSE 8000` while worker binds port 8080 by default.
- **M11.** Backend: `runtime.txt` ships `python-3.11` (no patch). Modern Heroku prefers `.python-version`.
- **M12.** Backend: `apply_migration.py` is correctly path-validated but not wired anywhere. Document the deployment procedure or add a `release` step.
- **M13.** Backend: 96 SQL files with no ledger, multiple `_v2`/`_FINAL`/`_FIXED` chains. Two separate migration trees (`backend/migrations/` and `flask-react-supabase-app/supabase/migrations`).
- **M14.** Frontend: no `typecheck` or `lint` npm script. `tsc --noEmit` is manual; the default `extends` only lints `.ts`/`.tsx` (8 files), so the 215 `.js`/`.jsx` files are completely lint-blind.
- **M15.** Frontend: `tsconfig.json` `"strict": false`. The 8 TS files have no real type safety.
- **M16.** Frontend: `package.json` pins `react-router-dom@7.18.3` on a React 18 codebase. Functional today, but a heavy upgrade.
- **M17.** Frontend: `frontend/src/components/dealer/DealerTeam.jsx:75-84` and `frontend/src/components/dealer/DealerSettings.jsx:227-236` — empty-deps `useEffect` calling non-memoized loaders. Stale-closure risk on refresh.
- **M18.** Frontend: `frontend/src/utils/supabaseClient.js:30-37` — `createClient(supabaseUrl || '', supabaseKey || '')` with empty-string fallbacks. The first auth call will throw. Fail fast at module load instead.
- **M19.** Frontend: `frontend/src/utils/authService.js:45-49` — `setTokenStorageMode` is a no-op stub. Caller `Login.js:79` looks like it controls persistence when it doesn't.
- **M20.** Mobile: `tsconfig.json` lacks `skipLibCheck`. Adding it drops ~15 of the 47 tsc errors (the `node_modules` ones from `@msg91comm` and `react-native-worklets`).
- **M21.** Mobile: `react-native-dotenv` declared in deps but never wired in `babel.config.js`. Drop it.
- **M22.** Mobile: `react-native-url-polyfill` declared, no consumer. Drop it.
- **M23.** Mobile: `@react-native/jest-preset` declared, `jest-expo` supersedes. Drop it.
- **M24.** Mobile: `mobile/jest.config.js` `collectCoverageFrom` covers `src/utils` and `src/hooks` only — misses `src/screens`, `src/components`, `src/context`, `app/`. Coverage will under-report against the actual logic density.
- **M25.** Mobile: `mobile/app.json` declares `expo-splash-screen` + plugin, but no `SplashScreen.preventAutoHideAsync()`/`hideAsync()` calls anywhere. Cold start races font loading (`app/_layout.tsx:63`) and produces a black-screen flash.
- **M26.** Mobile: `mobile/src/components/ui/SplashIntro.js` exists, has a test, but is never imported in `app/_layout.tsx`. The branded splash is dead weight.
- **M27.** Mobile: `mobile/examples/native-tabs-liquid-glass/` committed but never imported. Delete or move.
- **M28.** Mobile: MSGB91/Skia/TFJS/NSFWJS model weights (combined ~6 MB) load unconditionally on image-pick paths, no `__DEV__` skip, no admin kill switch.
- **M29.** Mobile: Skia is imported at module top-level in `mobile/src/components/ui/PhotoEditorModal.js` and `mobile/src/utils/bakeImageEdits.js` even when the modal never opens.

---

## D. LOW — Style, dead code, comments

- **L1.** `backend/app.py` is 26,060 lines in a single module. Refactor candidate but not a deployment blocker.
- **L2.** `frontend/scripts/test-registration-scan.mjs` exists but isn't wired to `npm test`. Same for `frontend/scripts/audit-media-assets.mjs`, `ensure-mediapipe-sourcemap.js`, `verify-deploy-assets.js` — all one-offs not in CI.
- **L3.** Mobile `app.json` doesn't include `usesCleartextTraffic` or a `networkSecurityConfig`. Default for SDK 57 is `false`.
- **L4.** `console.error`/`console.warn` count: 50+ in `frontend/src/`. No error-reporting integration (Sentry/PostHog exception capture) wired.
- **L5.** Mobile: `@expo/metro-runtime` declared but only needed for web builds. Native-only builds carry dead weight.
- **L6.** Mobile: `eas.json:11` `development` profile is iOS-simulator-only; Android devs have no internal-distribution path other than a custom dev client + sideload.
- **L7.** Mobile: external credentials (`mobile/credentials/AuthKey_*.p8`, `mobile/credentials/play-service-account.json`) — confirmed gitignored by `mobile/.gitignore:45`. Safe.
- **L8.** `app.py:25658` `debug_mode` reads `FLASK_DEBUG` only inside `__main__`, which is never the production path. Defensive but unreachable.

---

## E. Env var cross-reference (selected)

| Var | Used at | Declared in | Risk |
|---|---|---|---|
| `FLASK_SECRET_KEY` | `backend/app.py:4538` | `.env.example` (placeholder) | Placeholder passes lint, breaks sessions at runtime |
| `REACT_APP_API_URL` | `frontend/src/utils/apiClient.js:6` etc. | `.env.production` + `.env.example` | Hard-coded fallback `api.dphclassifieds.com` doesn't match Railway host in `apiClient.js` default |
| `REACT_APP_SITE_URL` | `frontend/src/utils/seo.js:1`, detail components | **nowhere** | Two different hard-coded fallbacks across files |
| `REACT_APP_CLARITY_PROJECT_ID` | `frontend/src/utils/analytics.js:7` | `.env.example` only | Silently disabled in prod |
| `REACT_APP_MSG91_WIDGET_ID`, `REACT_APP_MSG91_TOKEN_AUTH` | `frontend/src/utils/msg91Widget.js` | `.env.example` only | Silently disabled in prod |
| `EXPO_PUBLIC_TURNSTILE_SITE_KEY` | `mobile/src/constants/config.js:19` | `.env.example` only | Silently disabled |
| `EXPO_PUBLIC_MSG91_WIDGET_ID`, `EXPO_PUBLIC_MSG91_TOKEN_AUTH` | `mobile/src/utils/msg91.js` | **nowhere** | Phone-OTP widget path dead |
| `SUPABASE_SERVICE_KEY` | dealer modules, workers | **nowhere documented** | Inconsistent precedence with `SUPABASE_SERVICE_ROLE_KEY` (see H6) |
| `OCR_SERVICE_*`, `VISION_SERVICE_*` | backend code | `.env.example` only | Not in `.env.railway.example` — easy to forget on deploy |
| `POSTHOG_PROJECT_TOKEN` / `POSTHOG_HOST` | `backend/app.py`, frontend | `.env.example` only | Not in `.env.railway.example` |
| `ENABLE_DEALER_PANEL` | `backend/app.py:20543` | **nowhere** | Defaults to falsy → dealer routes dead on first deploy |
| `TRUSTED_PROXY_HOPS` | `backend/app.py:81` | **nowhere** | `ProxyFix` only mounts when this is non-zero |
| `WORKER_HEARTBEAT_*` | `backend/worker.py`, `backend/health_monitoring.py` | `.env.example` only | Not in `.env.railway.example` |

---

## F. Triage — what to fix first

1. **C1 + C2** (the two `vercel.json` issues) — affects every visitor hitting a car/bike/plate/part detail page.
2. **C3** (API URL consistency) — silently broken in some flows if `REACT_APP_API_URL` is missing in Vercel env.
3. **C4 + C5** (mobile tsc gate) — blocks CI today; doesn't block Metro builds, but will bite the next time someone wires a precommit.
4. **C7** (`FLASK_SECRET_KEY` fail-fast) — silent session breakage on deploy.
5. **C8** (9 routes below `__main__`) — dev-only but anyone running `python app.py` gets admin 404s.
6. **H1** (`nixpacks.toml` CWD) — most likely will fail at install with "no such file: requirements.txt".
7. **H2 + H3** (`SafeAreaProvider`, cleartext) — UX on Android.
8. **H6 + H7** (env drift, no migration runner) — operational; not blocking a single deploy but will bite next time someone resets a service.

---

**End of addendum. No code was changed. Every line reference is to a live file at commit `c5741ff4`.**