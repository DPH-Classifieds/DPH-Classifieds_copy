# Reddit Imported Listings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import eligible for-sale posts from `r/DubaiPetrolHeads` every four hours as clearly attributed DPH Classifieds listings owned by the DPH Classifieds account, retain the direct Reddit post link, and report both listing views and Reddit outbound-post opens in the admin dashboard.

**Architecture:** A backend-only worker obtains a Reddit OAuth token, retrieves the newest posts, deterministically parses only sale posts with enough trustworthy vehicle data, and upserts them into `cars` and `car_images` using the service role. Imported rows are distinguished from member listings by immutable source fields and are rendered with source attribution and an external Reddit CTA. The existing canonical `platform_events` pipeline receives a new listing-scoped `reddit_post_open` event, which powers a separate admin import-health and outbound-click panel.

**Tech Stack:** Flask 3, Python `requests`, Supabase/PostgREST, PostgreSQL migrations, React, existing `PlatformAnalyticsTracker`, existing Railway worker process, Reddit OAuth Data API.

## Global Constraints

- The importer runs only on the backend worker; no browser, frontend, or client token may call Reddit.
- Poll `r/DubaiPetrolHeads` every `14400` seconds (four hours), with a maximum of 100 newest posts per run; do not chase comments, profiles, or unrelated subreddits.
- Use OAuth and the supplied Reddit credentials only through environment variables; never commit them, log them, or expose them to the frontend.
- Set `REDDIT_IMPORT_OWNER_ID` to the UUID for `admin@dphclassifieds.com`; do **not** authenticate the account with its password for each job. The worker’s service-role key performs writes and assigns that UUID as `cars.user_id`.
- The account must exist in both Supabase Auth and `public.users`, and display as `DPH Classifieds`. It needs no new end-user role: service-role writes bypass normal listing limits, verification gates, and RLS. The importer itself is protected by server-only configuration.
- Imported content must be visibly attributed as Reddit content, retain a direct original-post link, and be hidden when the source post is deleted/removed. Do not import phone numbers, email addresses, Reddit post bodies verbatim, or comments.
- Remote Reddit image URLs are displayed directly in `car_images`; do not download or permanently re-host media in this first release. This keeps source-removal handling accurate.
- Only posts that produce `make`, `model`, `year`, AED price, a title, and at least one safe image are publishable. Everything else is counted as skipped—not guessed or made public.
- Create a `reddit_post_open` canonical event; do not infer this conversion from generic `link_click` rows.
- Preserve the user’s existing dirty changes, especially `backend/app.py`, `frontend/src/components/AdminDashboard.js`, and the current canonical-analytics work. Integrate with them without reverting or overwriting unrelated lines.

---

## Data model and decisions

### Imported-car field contract

| Field | Value / source |
| --- | --- |
| `cars.user_id` | `REDDIT_IMPORT_OWNER_ID` UUID (`DPH Classifieds`) |
| `cars.source_platform` | Literal `reddit` |
| `cars.source_external_id` | Reddit submission fullname/id, e.g. `t3_1v4iryw` |
| `cars.source_url` | Canonical `https://www.reddit.com<permalink>` only |
| `cars.source_author` | Reddit author name if available, otherwise null |
| `cars.source_subreddit` | Literal `DubaiPetrolHeads` |
| `cars.source_created_at` | Submission `created_utc` |
| `cars.source_last_seen_at` | UTC timestamp of every successful observation |
| `cars.source_removed_at` | UTC timestamp when a formerly imported source is absent/removed/deleted |
| `cars.status` / `is_approved` | `approved` / `true` while the source is visible; `source_removed` / `false` once removed |
| `cars.car_description` | A generated source notice plus a short parsed summary only; no raw post body |
| `car_images` | First safe `preview.redd.it` or `i.redd.it` image, stored as direct URL with `is_primary=true` |

### Parsing policy

1. Inspect only the submission title and selftext returned by the OAuth listing endpoint.
2. Eligible posts must look like a sale: title/selftext contains `WTS`, `for sale`, or `selling`, and it is not `WTB`, `wanted`, `sold`, `sold!`, `price check`, or a moderator post.
3. Parse AED price from `AED 85,000`, `85,000 AED`, `85k`, or `85 K`; reject prices outside `1,000..10,000,000` AED.
4. Parse year from a four-digit token in `1980..current_year+1`; parse mileage only when accompanied by `km`, `kms`, or `kilometres`.
5. Resolve make/model from an explicit maintained make list and adjacent title tokens. A post lacking a confident make/model is skipped.
6. Never infer VIN, location, seller contact, regional spec, transmission, fuel, or condition. Store the existing valid “not specified” option for only fields the schema requires; add no fake marketing claims.
7. An update is permitted only for the same `source_external_id`; user-editable imported rows are not supported in v1. Admin removal uses the normal lifecycle status and does not delete audit data.

### Environment contract

```dotenv
# existing server-only Supabase credentials remain unchanged
REDDIT_IMPORT_ENABLED=false
REDDIT_IMPORT_INTERVAL_SECONDS=14400
REDDIT_IMPORT_SUBREDDIT=DubaiPetrolHeads
REDDIT_IMPORT_MAX_POSTS=100
REDDIT_IMPORT_OWNER_ID=<Supabase public.users UUID for admin@dphclassifieds.com>
REDDIT_CLIENT_ID=<Reddit app client id>
REDDIT_CLIENT_SECRET=<Reddit app client secret>
REDDIT_USER_AGENT=web:com.dphclassifieds.reddit-importer:v1.0 (by /u/DPHClassifieds)
```

`REDDIT_IMPORT_OWNER_EMAIL=admin@dphclassifieds.com` may be retained only as an operator-facing cross-check; the worker validates the UUID’s `public.users.email` before writing. The account password currently in the environment is not used by the importer and should be removed after the owner UUID is verified.

## File structure

- Create: `backend/migrations/2026_07_23_reddit_imported_listings.sql` — source columns, unique index, run audit table, RLS/indexes.
- Create: `backend/services/reddit_import.py` — OAuth client, source validation, parser, canonical source URL builder, and payload construction. No database writes.
- Create: `backend/workers/reddit_import_worker.py` — run orchestration, Supabase reads/writes, row removal sync, and structured run audit.
- Create: `backend/test_reddit_import.py` — parser, OAuth/fetch, upsert, removal, and no-PII tests using mocked HTTP.
- Modify: `backend/worker.py` — schedule the importer exactly every four hours when enabled.
- Modify: `backend/services/analytics_events.py` — accept and validate the new listing-scoped click event.
- Modify: `supabase/migrations/20260720000002_expand_analytics_event_allowlist.sql` or a new additive migration — allow the RPC to store `reddit_post_open`.
- Modify: `backend/app.py` — admin import analytics endpoint and cache invalidation; no new public write endpoint.
- Create: `backend/test_reddit_import_analytics.py` — endpoint aggregation and authorization tests.
- Modify: `frontend/src/components/CarDetail.jsx` — source attribution panel and `reddit_post_open` CTA.
- Modify: `frontend/src/components/MarketplaceListingCard.jsx` — compact Reddit source badge, no external CTA from the browse grid.
- Create: `frontend/src/components/admin/RedditImportAnalyticsPanel.jsx` — imported-listing health, run status, outbound-post clicks, and top listings.
- Modify: `frontend/src/components/AdminDashboard.js` — fetch and render the dedicated panel.
- Modify: `backend/.env.example`, `vault/Deployment.md`, and `vault/API Reference.md` — server configuration, data lifecycle, and analytics contract.

## Task 1: Establish the database contract and owner-account preflight

**Files:**
- Create: `flask-react-supabase-app/backend/migrations/2026_07_23_reddit_imported_listings.sql`
- Modify: `flask-react-supabase-app/backend/.env.example`
- Modify: `vault/Deployment.md`

**Interfaces:**
- Produces columns used by `build_imported_car_payload()` and `get_admin_reddit_import_analytics()`.
- Produces `reddit_import_runs` with `status in ('running','succeeded','partial','failed')`.

- [ ] **Step 1: Write the migration with source identity, status safety, and audit history.**

```sql
ALTER TABLE public.cars
  ADD COLUMN IF NOT EXISTS source_platform text,
  ADD COLUMN IF NOT EXISTS source_external_id text,
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS source_author text,
  ADD COLUMN IF NOT EXISTS source_subreddit text,
  ADD COLUMN IF NOT EXISTS source_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_removed_at timestamptz;

ALTER TABLE public.cars
  ADD CONSTRAINT cars_reddit_source_contract CHECK (
    source_platform IS DISTINCT FROM 'reddit'
    OR (source_external_id IS NOT NULL AND source_url ~ '^https://www\\.reddit\\.com/r/')
  );

CREATE UNIQUE INDEX IF NOT EXISTS cars_reddit_source_external_id_unique
  ON public.cars (source_external_id)
  WHERE source_platform = 'reddit';
CREATE INDEX IF NOT EXISTS cars_reddit_live_idx
  ON public.cars (source_subreddit, source_last_seen_at DESC)
  WHERE source_platform = 'reddit' AND source_removed_at IS NULL;

CREATE TABLE IF NOT EXISTS public.reddit_import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subreddit text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('running','succeeded','partial','failed')),
  fetched_count integer NOT NULL DEFAULT 0,
  eligible_count integer NOT NULL DEFAULT 0,
  created_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  removed_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  error_summary text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reddit_import_runs_subreddit_started_idx
  ON public.reddit_import_runs (subreddit, started_at DESC);
ALTER TABLE public.reddit_import_runs ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Apply the migration locally with the authenticated Supabase CLI and inspect the exact resulting columns/indexes.**

Run: `cd flask-react-supabase-app && supabase db push --local`

Expected: successful migration output; `supabase db diff --local` returns no uncommitted schema difference.

- [ ] **Step 3: Resolve the exact import owner UUID without printing credentials.**

Run a service-role-backed query selecting only `id,email,full_name,role,email_verified` from `public.users` where email is `admin@dphclassifieds.com`.

Expected: one row; record only the UUID in local `backend/.env` as `REDDIT_IMPORT_OWNER_ID`. Confirm the name shown to buyers is `DPH Classifieds`, the account is not deleted, and its email is verified.

- [ ] **Step 4: Document configuration and secret handling.**

Add every environment key in the contract above to `backend/.env.example` with blank values, and explain in `vault/Deployment.md` that only Railway worker receives Reddit variables. Explicitly state that the frontend/Vercel must never receive them and the account password is not a worker credential.

- [ ] **Step 5: Commit the isolated schema and configuration documentation.**

```bash
git add backend/migrations/2026_07_23_reddit_imported_listings.sql backend/.env.example ../vault/Deployment.md
git commit -m "feat: add Reddit listing import schema"
```

## Task 2: Build and test the pure Reddit source/parser service

**Files:**
- Create: `flask-react-supabase-app/backend/services/reddit_import.py`
- Create: `flask-react-supabase-app/backend/test_reddit_import.py`

**Interfaces:**
- Produces `RedditSubmission` and `ParsedRedditCar` dataclasses.
- Produces `fetch_new_submissions(session, access_token, subreddit, limit) -> list[RedditSubmission]`.
- Produces `parse_sale_post(submission, now) -> ParsedRedditCar | None`.
- Consumed by `workers/reddit_import_worker.py`; this module performs no Supabase calls.

- [ ] **Step 1: Write failing parser tests before implementation.**

```python
def test_parses_a_complete_wts_post_without_retaining_contact_details():
    post = submission(title="WTS: 2018 BMW 120i GCC - AED 39,000", selftext="88,000 km. Call +971501234567", id="abc")
    parsed = parse_sale_post(post, datetime(2026, 7, 23, tzinfo=UTC))
    assert parsed.make == "BMW"
    assert parsed.model == "120i"
    assert parsed.year == 2018
    assert parsed.price_aed == 39000
    assert parsed.mileage_km == 88000
    assert "+971" not in parsed.description

def test_rejects_wanted_sold_and_incomplete_posts():
    assert parse_sale_post(submission(title="WTB Porsche 911", id="a"), NOW) is None
    assert parse_sale_post(submission(title="SOLD: 2018 BMW 120i AED 39k", id="b"), NOW) is None
    assert parse_sale_post(submission(title="WTS: BMW 120i", id="c"), NOW) is None

def test_canonical_url_cannot_be_redirected_to_an_untrusted_host():
    assert canonical_reddit_url("/r/DubaiPetrolHeads/comments/abc/title/") == "https://www.reddit.com/r/DubaiPetrolHeads/comments/abc/title/"
    with pytest.raises(ValueError): canonical_reddit_url("https://evil.example/post")
```

- [ ] **Step 2: Run the parser test and verify it fails because the module does not exist.**

Run: `cd flask-react-supabase-app/backend && ./.venv/bin/python -m unittest test_reddit_import -v`

Expected: import failure for `services.reddit_import`.

- [ ] **Step 3: Implement constrained OAuth fetching and pure normalization.**

Use these exact boundaries:

```python
TOKEN_URL = "https://www.reddit.com/api/v1/access_token"
OAUTH_BASE_URL = "https://oauth.reddit.com"
ALLOWED_IMAGE_HOSTS = {"preview.redd.it", "i.redd.it"}

def get_app_access_token(session: requests.Session, client_id: str, client_secret: str, user_agent: str) -> str:
    response = session.post(TOKEN_URL, auth=(client_id, client_secret),
        data={"grant_type": "client_credentials"}, headers={"User-Agent": user_agent}, timeout=20)
    response.raise_for_status()
    return response.json()["access_token"]

def fetch_new_submissions(session, access_token, subreddit, limit):
    response = session.get(f"{OAUTH_BASE_URL}/r/{subreddit}/new", params={"limit": min(limit, 100), "raw_json": 1},
        headers={"Authorization": f"Bearer {access_token}", "User-Agent": user_agent}, timeout=20)
    response.raise_for_status()
    return [RedditSubmission.from_api(child["data"]) for child in response.json()["data"]["children"]]
```

Use regular expressions for bounded extraction, clean title/text before storage, and preserve only `title`, `make`, `model`, `year`, `price_aed`, optional `mileage_km`, optional public image URL, author, created timestamp, source ID, and canonical permalink. Reject crossposts, NSFW, removed/deleted, selftext-only/no-image posts, and any malformed response rather than retrying indefinitely.

- [ ] **Step 4: Add mock HTTP tests for OAuth failures, rate limits, bad payloads, image-host rejection, and safe title cleanup.**

Run: `cd flask-react-supabase-app/backend && ./.venv/bin/python -m unittest test_reddit_import -v`

Expected: all parser/fetch tests pass without network access.

- [ ] **Step 5: Commit the independently tested parser.**

```bash
git add backend/services/reddit_import.py backend/test_reddit_import.py
git commit -m "feat: parse eligible Reddit sale posts"
```

## Task 3: Implement the four-hour idempotent import worker

**Files:**
- Create: `flask-react-supabase-app/backend/workers/reddit_import_worker.py`
- Modify: `flask-react-supabase-app/backend/worker.py`
- Modify: `flask-react-supabase-app/backend/app.py`
- Modify: `flask-react-supabase-app/backend/test_reddit_import.py`

**Interfaces:**
- Produces `run() -> dict[str, int | str]` for the scheduler.
- Consumes `ParsedRedditCar`, `REDDIT_IMPORT_*` configuration, `cars`, `car_images`, and `reddit_import_runs`.
- Produces public `cars` rows with `status='approved'` and `is_approved=true` only after a complete source contract passes.

- [ ] **Step 1: Write failing worker tests for create, update, idempotency, and removal.**

```python
@patch("workers.reddit_import_worker.fetch_new_submissions")
@patch("workers.reddit_import_worker.supabase_request")
def test_second_run_updates_same_source_id_not_creates_duplicate(mock_db, mock_fetch):
    mock_fetch.return_value = [complete_post(id="t3_same")]
    mock_db.side_effect = existing_reddit_car_then_successful_patch()
    result = run()
    assert result["created"] == 0
    assert result["updated"] == 1
    assert all(call.kwargs.get("data", {}).get("user_id") == OWNER_ID for call in mock_db.mock_calls if "cars" in str(call))

def test_removed_import_is_unpublished_not_deleted():
    result = sync_missing_previous_posts(current_source_ids=set())
    assert result["removed"] == 1
    assert patched_car["status"] == "source_removed"
    assert patched_car["is_approved"] is False
```

- [ ] **Step 2: Run the worker tests and confirm they fail before the worker exists.**

Run: `cd flask-react-supabase-app/backend && ./.venv/bin/python -m unittest test_reddit_import -v`

Expected: import failure for `workers.reddit_import_worker`.

- [ ] **Step 3: Implement run auditing and idempotent writes.**

Implement this sequence exactly:

1. Return `{"status": "disabled"}` before any network/database write if `REDDIT_IMPORT_ENABLED` is not truthy.
2. Validate all required variables and fetch the owner from `public.users` using the service role. Abort and create a failed run row if the UUID is missing, email does not match `admin@dphclassifieds.com`, or the account is deleted.
3. Insert `reddit_import_runs(status='running')`; fetch a token and one newest-post page.
4. Parse every post, counting each rejected item. Query existing cars once by the batch’s source IDs.
5. For every eligible post, insert or PATCH exactly one car. Build the payload with the existing DB-valid fallback values for required non-source car columns, `user_id=REDDIT_IMPORT_OWNER_ID`, `status='approved'`, `is_approved=true`, source columns, and a short attribution description. Do not call the user-facing `/api/cars` endpoint.
6. Insert/update `car_images` only when the source primary image changed. Set `is_primary=true` for its one imported image.
7. For previously live Reddit cars in this subreddit that are absent from a successful newest-post fetch only when their source post is explicitly returned as `removed_by_category`/`author='[deleted]'`, unpublish them. Do **not** mark an old post removed merely because it fell outside a 100-post newest window; source removal is evaluated only for submissions fetched by stored IDs in a separate bounded verification pass.
8. Finalize the audit row with exact counts and a capped, non-secret error summary. Invalidate `cars` and admin import analytics caches only after actual create/update/removal.

- [ ] **Step 4: Register the job with the existing worker scheduler.**

Add this import beside the other worker imports in `backend/worker.py`:

```python
from workers.reddit_import_worker import run as _run_reddit_import_once
```

Then start a dedicated thread after the existing dealer API poll thread:

```python
reddit_import_thread = threading.Thread(
    target=scheduled_loop,
    args=("reddit_import_worker", _run_reddit_import_once,
          int(os.getenv("REDDIT_IMPORT_INTERVAL_SECONDS", str(4 * 60 * 60)))),
    name="reddit-import",
    daemon=True,
)
reddit_import_thread.start()
```

The function is invoked once per four-hour period; a disabled run must remain a no-op. Do not run it in the Flask web process.

- [ ] **Step 5: Run the focused worker tests and static compilation.**

Run: `cd flask-react-supabase-app/backend && ./.venv/bin/python -m unittest test_reddit_import -v && ./.venv/bin/python -m py_compile workers/reddit_import_worker.py worker.py services/reddit_import.py`

Expected: all tests pass; no outbound network calls occur.

- [ ] **Step 6: Commit the worker.**

```bash
git add backend/workers/reddit_import_worker.py backend/worker.py backend/test_reddit_import.py backend/app.py
git commit -m "feat: import Reddit sale listings on worker"
```

## Task 4: Add a dedicated, canonical Reddit outbound-post conversion

**Files:**
- Modify: `flask-react-supabase-app/backend/services/analytics_events.py`
- Create: `flask-react-supabase-app/supabase/migrations/20260723000001_reddit_post_open_analytics.sql`
- Modify: `flask-react-supabase-app/backend/test_analytics_events.py`

**Interfaces:**
- Produces accepted event name `reddit_post_open` requiring `listing_type` and `listing_id`.
- Consumed by `PlatformAnalyticsTracker`, `CarDetail`, and the admin import analytics endpoint.

- [ ] **Step 1: Add failing tests to the canonical validator.**

```python
def test_reddit_post_open_is_listing_scoped_and_safe():
    event = normalize_analytics_event({
        "event_name": "reddit_post_open", "listing_type": "cars", "listing_id": "car-1",
        "visitor_id": "visitor-1", "session_id": "session-1",
        "metadata": {"source": "reddit", "target_domain": "reddit.com", "url": "https://secret.example"},
    })
    assert event["event_name"] == "reddit_post_open"
    assert event["listing_type"] == "car"
    assert event["metadata"] == {"source": "reddit", "target_domain": "reddit.com"}

def test_reddit_post_open_requires_listing_identity():
    with self.assertRaises(AnalyticsEventError):
        normalize_analytics_event({"event_name": "reddit_post_open", "visitor_id": "v", "session_id": "s"})
```

- [ ] **Step 2: Implement the event contract and database allowlist migration.**

Change the event sets to:

```python
EVENT_NAMES = {..., "reddit_post_open"}
LISTING_EVENTS = {..., "reddit_post_open"}
METADATA_KEYS = {..., "target_domain", "import_source"}
```

Create an additive migration that replaces `record_analytics_event(...)` with the existing exact function body, adding only `reddit_post_open` to its event-name allowlist and listing-identity condition. Keep the function service-role-only; do not grant direct client execution.

- [ ] **Step 3: Run and pass focused analytics tests.**

Run: `cd flask-react-supabase-app/backend && ./.venv/bin/python -m unittest test_analytics_events -v`

Expected: `reddit_post_open` is accepted only with a car identity and safe metadata.

- [ ] **Step 4: Commit the conversion event.**

```bash
git add backend/services/analytics_events.py backend/test_analytics_events.py supabase/migrations/20260723000001_reddit_post_open_analytics.sql
git commit -m "feat: track Reddit listing opens"
```

## Task 5: Render imported listings transparently and emit the event once

**Files:**
- Modify: `flask-react-supabase-app/frontend/src/components/CarDetail.jsx`
- Modify: `flask-react-supabase-app/frontend/src/components/MarketplaceListingCard.jsx`
- Test: existing frontend test harness plus a new `frontend/src/components/__tests__/CarDetail.reddit.test.jsx`

**Interfaces:**
- Consumes source fields returned by `GET /api/cars/:id`.
- Produces one `<a>` with `data-analytics-event="reddit_post_open"`, `data-listing-type="car"`, and `data-listing-id={car.id}`.

- [ ] **Step 1: Write the failing UI tests.**

```jsx
it('shows the Reddit source CTA only for imported Reddit cars', () => {
  render(<CarDetail car={{ id: 'car-1', source_platform: 'reddit', source_url: 'https://www.reddit.com/r/DubaiPetrolHeads/comments/a/title/' }} />);
  expect(screen.getByRole('link', { name: /view original reddit post/i })).toHaveAttribute('data-analytics-event', 'reddit_post_open');
});

it('does not render a Reddit CTA for a member listing', () => {
  render(<CarDetail car={{ id: 'car-2', source_platform: null }} />);
  expect(screen.queryByRole('link', { name: /reddit/i })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Implement source-safe rendering.**

Only render after `new URL(car.source_url).hostname` is `www.reddit.com` or `reddit.com`. Use an anchor—not a JavaScript redirect:

```jsx
<a
  href={car.source_url}
  target="_blank"
  rel="noopener noreferrer"
  data-analytics-event="reddit_post_open"
  data-analytics-intent="view_original_reddit_post"
  data-listing-type="car"
  data-listing-id={car.id}
  data-analytics-label="View original Reddit post"
>
  View original Reddit post
</a>
```

Above the button, show: `Imported from Reddit · Original post by u/{source_author}` and `Listing details are supplied by the original post; verify them with the seller on Reddit.` Do not show a DPH call/WhatsApp CTA for imported listings. Add a compact `Reddit` badge on `MarketplaceListingCard` when `source_platform === 'reddit'`.

- [ ] **Step 3: Verify no duplicate event is sent.**

The global click handler already emits `data-analytics-event` as the one canonical event. Do not add an `onClick` network call in `CarDetail`; the dataset attributes are the integration.

- [ ] **Step 4: Run frontend tests and production build.**

Run: `cd flask-react-supabase-app/frontend && npm test -- --watchAll=false CarDetail.reddit.test.jsx && npm run build`

Expected: two UI tests pass and the production build succeeds.

- [ ] **Step 5: Commit source presentation.**

```bash
git add frontend/src/components/CarDetail.jsx frontend/src/components/MarketplaceListingCard.jsx frontend/src/components/__tests__/CarDetail.reddit.test.jsx
git commit -m "feat: show Reddit source listings transparently"
```

## Task 6: Surface importer health and Reddit outbound opens in admin

**Files:**
- Modify: `flask-react-supabase-app/backend/app.py`
- Create: `flask-react-supabase-app/backend/test_reddit_import_analytics.py`
- Create: `flask-react-supabase-app/frontend/src/components/admin/RedditImportAnalyticsPanel.jsx`
- Modify: `flask-react-supabase-app/frontend/src/components/AdminDashboard.js`

**Interfaces:**
- Produces `GET /api/admin/reddit-import-analytics?days=1..90`.
- Returns `{window_days, listings, opens, daily_opens, top_listings, latest_run}`.

- [ ] **Step 1: Write backend endpoint tests.**

```python
def test_admin_reddit_import_analytics_returns_clicks_and_import_health(client, admin_token):
    seed_imported_car("car-1")
    seed_platform_event(event_name="reddit_post_open", listing_type="car", listing_id="car-1")
    seed_run(status="succeeded", created_count=2, skipped_count=1)
    response = client.get("/api/admin/reddit-import-analytics?days=30", headers=admin_token)
    assert response.status_code == 200
    assert response.json["opens"]["total"] == 1
    assert response.json["listings"]["live"] == 1
    assert response.json["latest_run"]["status"] == "succeeded"

def test_non_admin_cannot_read_reddit_import_analytics(client, member_token):
    assert client.get("/api/admin/reddit-import-analytics", headers=member_token).status_code == 403
```

- [ ] **Step 2: Implement a single admin-only aggregation endpoint.**

The endpoint must use `_require_admin_api_user`, clamp `days` to `1..90`, cache for 60 seconds, and query only:

- Reddit `cars` for total/live/removed and their title/thumbnail/source URL.
- `platform_events` where `event_name='reddit_post_open'`, `listing_type='car'`, and `occurred_at >= cutoff` for total opens, unique visitors, daily buckets, and top imported listings.
- Latest `reddit_import_runs` row for health/counters/error summary.

Return no IP address, user agent, raw event metadata, access token, post body, or seller contact. Use the existing date/time helpers and `_fetch_all_rows` pagination so results do not silently truncate.

- [ ] **Step 3: Build the dashboard panel.**

`RedditImportAnalyticsPanel` receives the endpoint result and shows:

- `Live imported listings`, `Reddit post opens`, `Unique visitors opening Reddit`, and `Open rate = opens / DPH listing views` (show `—` if zero views).
- Latest run timestamp, status, `fetched / eligible / created / updated / skipped / failed`, with the error summary only when non-empty.
- A small daily opens chart and five top source listings with title, DPH views, Reddit opens, and external-link icon.
- An empty state that explains no eligible listing has been imported yet, without treating it as an error.

Fetch it alongside the existing `contactAnalytics` request in `AdminDashboard`, include it in the SWR cache object, and place the panel beneath platform/contact KPI cards. The dashboard must continue rendering if this single request fails.

- [ ] **Step 4: Run backend, frontend, and build checks.**

Run:

```bash
cd flask-react-supabase-app/backend && ./.venv/bin/python -m unittest test_reddit_import_analytics test_analytics_events -v
cd ../frontend && npm test -- --watchAll=false && npm run build
```

Expected: tests pass and the dashboard build has no lint/build failure.

- [ ] **Step 5: Commit admin reporting.**

```bash
git add backend/app.py backend/test_reddit_import_analytics.py frontend/src/components/admin/RedditImportAnalyticsPanel.jsx frontend/src/components/AdminDashboard.js
git commit -m "feat: report Reddit import engagement in admin"
```

## Task 7: End-to-end local verification and operational documentation

**Files:**
- Modify: `vault/API Reference.md`
- Modify: `vault/Deployment.md`
- Modify: `flask-react-supabase-app/README.md`

- [ ] **Step 1: Add an offline fixture-driven import smoke test.**

Use a saved, redacted OAuth JSON fixture under `backend/tests/fixtures/reddit_new_listing.json`. Start with `REDDIT_IMPORT_ENABLED=true` and mocked Reddit transport, then assert exactly one `cars` row owned by `REDDIT_IMPORT_OWNER_ID`, one direct `car_images` row, one `reddit_import_runs` row, and no stored phone number or raw selftext.

- [ ] **Step 2: Run the complete local verification gate.**

```bash
cd flask-react-supabase-app/backend
./.venv/bin/python -m unittest test_reddit_import test_reddit_import_analytics test_analytics_events test_user_flow_contracts -v
./.venv/bin/python -m py_compile app.py worker.py services/reddit_import.py workers/reddit_import_worker.py
cd ../frontend
npm test -- --watchAll=false
npm run build
```

Expected: all named suites and frontend build pass. Record exact output in the PR/commit handoff.

- [ ] **Step 3: Document the operational runbook.**

Document all of the following in `vault/Deployment.md`:

1. Apply both Supabase migrations before enabling the worker.
2. Confirm the import-owner UUID/email/name match without exposing credentials.
3. Add the seven server-only variables to Railway’s **worker** service; leave `REDDIT_IMPORT_ENABLED=false` for initial deploy.
4. Verify worker health and startup logs; confirm the Reddit job is registered but makes no fetch while disabled.
5. Enable it, wait one four-hour interval, then verify the successful `reddit_import_runs` row, public card, source attribution, direct original link, `listing_view`, and `reddit_post_open` dashboard counter.
6. Roll back safely by setting `REDDIT_IMPORT_ENABLED=false`; existing imported rows remain visible until an explicit admin lifecycle action, preserving audit history.

Also add `GET /api/admin/reddit-import-analytics` response shape to `vault/API Reference.md`.

- [ ] **Step 4: Commit documentation and verification assets.**

```bash
git add backend/tests/fixtures/reddit_new_listing.json README.md ../vault/API\ Reference.md ../vault/Deployment.md
git commit -m "docs: add Reddit import deployment runbook"
```

## Task 8: GitHub handoff and live acceptance test

**Files:**
- No feature files; use the commits from Tasks 1–7.

- [ ] **Step 1: Inspect only the intended diff and retain pre-existing unrelated modifications.**

Run: `git -C flask-react-supabase-app status --short && git -C flask-react-supabase-app diff --check`

Expected: no whitespace error; unrelated current files remain unstaged unless deliberately incorporated and reviewed.

- [ ] **Step 2: Push the verified implementation branch to GitHub.**

Run:

```bash
git -C flask-react-supabase-app push origin HEAD
git -C flask-react-supabase-app log --oneline origin/main..HEAD
```

Expected: successful push and a concise list of the Reddit-import commits.

- [ ] **Step 3: Perform live acceptance after the user triggers the redeploy.**

1. Confirm the deployed backend and worker health endpoints return 200.
2. Confirm both new Supabase migrations are present in the production database.
3. Confirm disabled mode produces no Reddit API request or new run row.
4. Enable `REDDIT_IMPORT_ENABLED=true`; after the next four-hour tick, verify one successful `reddit_import_runs` record with non-zero fetched count.
5. Verify an eligible imported car shows the DPH Classifieds account, Reddit badge, source disclaimer, Reddit preview image, and canonical `www.reddit.com` original link.
6. Open its DPH detail page in an anonymous browser session and verify one `listing_view` canonical event.
7. Click “View original Reddit post” once; verify one `reddit_post_open` event tied to the same car, one increment in the admin panel, and no duplicate generic click conversion.
8. Test a simulated removed post in a non-production source fixture first, then verify the live importer unpublishes only a source explicitly identified as removed/deleted—not an old post outside the latest 100.
9. Check Railway worker logs for zero secrets, zero raw post text, controlled retry behavior, and one run outcome per interval.

- [ ] **Step 4: Record the deploy evidence and decision.**

Report migration IDs, deployed commit SHA, worker log timestamp, imported car ID/source ID, expected versus observed analytics counts, and any blocked account/API approval setting. Do not report or copy Reddit, Supabase, or account passwords.

## Self-review

- Coverage: Tasks 1–3 deliver secure four-hour source ingestion under the correct owner; Task 4 adds an unambiguous click metric; Task 5 preserves attribution in the public experience; Task 6 makes it operationally visible; Tasks 7–8 provide exhaustive local, GitHub, and live verification.
- Account privilege decision: the DPH Classifieds admin account needs identity and display-name verification only. Service-role code owns the enhanced write authority, so adding broad client/admin privileges to the account is not necessary and would be weaker security.
- Analytics decision: DPH detail views remain the existing `listing_view` event, while original Reddit opens are a separate listing-scoped `reddit_post_open` event; this supports direct reporting and prevents generic link-click ambiguity.
- Source correctness: dedupe uses immutable Reddit submission IDs; the importer never treats “not present in the newest page” as removal; imported data is minimal and attributed.

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-23-reddit-imported-listings.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
