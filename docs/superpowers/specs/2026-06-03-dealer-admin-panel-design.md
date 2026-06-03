# Dealer Admin Panel — Design Spec

Date: 2026-06-03
Status: Approved (sections 1–3); sections 4–8 written for review.
Author: brainstorm session (Claude + project owner)

## 1. Purpose & scope

A self-service admin panel for **approved (verified) dealers** at `/dealer/...`, giving them everything the platform admin currently sees about their own inventory, plus diagnostics that explain *why* a specific car isn't selling, plus a market-evaluation view of where their inventory sits relative to comparable platform listings.

**Audience.** Users with `is_dealer = true`, `dealer_verified = true`, and all three rows in `dealer_documents` (trade_license, company_registration, tax_registration) approved. Same gate the backend already enforces in `_require_dealer_verified` (`backend/app.py`); we mirror it client-side so unverified dealers don't see the dealer nav.

**Out of scope (v1).**
- Stripe billing / paid plan tiers — deferred. Panel shows a single greyed "Free during beta" badge so layout supports billing later without rework.
- Cross-posting to external sites (Dubizzle / YallaMotors / Facebook / Instagram).
- Scraped external market data — v1 uses our own platform data only. Pricing engine is designed behind a `MarketDataSource` interface so external sources can be added later.
- Multi-dealership membership — a user belongs to exactly one dealership in v1.

**Phasing.** Shipped as four independent vertical slices. One master spec (this doc); one implementation plan per phase.

| Phase | Deliverable | Why first |
| --- | --- | --- |
| **P1** | Foundation (dealerships org + seats), panel shell, KPI dashboard, per-listing analytics, "why isn't this selling" diagnostic, market evaluation. | Highest dealer ROI; nothing else makes sense without the org model. |
| **P2** | Lead inbox + pipeline (new → contacted → won/lost), notes, assign-to-rep. | Captures the value the dashboard reveals. |
| **P3** | Bulk inventory feed (CSV / XML import + export) and ingest from dealer's own DMS API. | Removes the manual-post bottleneck for dealers with >50 cars. |
| **P4** | Outbound webhooks (with HMAC, retries, delivery log). | Lets dealers wire leads/events into their own CRMs. |

---

## 2. Architecture & access control

### 2.1 Route layout

**Frontend (React).** New top-level tree under `/dealer/...`, structurally mirroring the existing admin shell:

```
/dealer
  /dashboard
  /listings
  /listings/:id/analytics
  /listings/:id/diagnostic
  /leads                     (P2)
  /leads/:id                 (P2)
  /inventory                 (P3)
  /inventory/jobs/:id        (P3)
  /integrations              (P4)
  /team
  /settings
```

**Backend (Flask).** New blueprint `backend/routes/dealer.py` mounted under `/api/dealer/...`. Sub-blueprints for analytics, leads, inventory, integrations to keep files focused.

### 2.2 Components (frontend)

- `DealerRoute.jsx` — wraps every `/dealer/*` route. Checks `is_dealer && dealer_verified && all_documents_approved`. Anything less redirects to existing `DealerPendingBanner` / docs upload.
- `DealerLayout.jsx`, `DealerSidebar.jsx`, `DealerHeader.jsx` — mirror `AdminLayout.js` patterns. Sidebar items appear by phase; team & settings are always visible.
- `DealerContext` — fetches the caller's `dealership_id` + role on mount, exposes to all dealer pages. One source of truth for role-gated UI.

### 2.3 Authorization

Every dealer-panel query is scoped by `dealership_id`, never by `user_id`. This is the single, non-negotiable invariant — a sales_rep seeing the dashboard sees the dealership's data, not just their own listings.

`@dealer_required` Flask decorator:
1. Validate JWT (existing `auth_required` pattern).
2. Look up the caller's `dealership_members` row with `status='active'`.
3. If missing → 403. Else attach `dealership_id` + `role` to the request context.

Role-based write gating happens inside endpoints:

| Action | owner | manager | sales_rep | admin* |
| --- | :---: | :---: | :---: | :---: |
| View dashboard / analytics / market eval | ✅ | ✅ | ✅ | ✅ |
| Edit dealership profile, invite seats, revoke seats | ✅ | ❌ | ❌ | ✅ (audited) |
| Edit listings owned by the dealership | ✅ | ✅ | ❌ | ✅ (audited) |
| Update any lead | ✅ | ✅ | ❌ | ✅ (audited) |
| Update leads assigned to me | ✅ | ✅ | ✅ | n/a |
| Configure webhooks, API sources, importers | ✅ | ✅ | ❌ | ✅ (audited) |
| Suspend / restore dealership | ❌ | ❌ | ❌ | ✅ (audited) |

\*"admin" = a user with `is_admin = true` — i.e. the same role gating the existing `/admin/*` panel today. There is no separate "super-admin" tier. See §2.4 for how admins enter dealer pages.

### 2.4 Admin access — the existing admin panel IS the oversight panel

There is **one** admin role on this platform: `users.is_admin = true`, the same role today gating `/admin/*`, `AdminRoute.jsx`, and the existing admin blueprint. The dealer panel does not introduce a new "super-admin" tier. Existing admins inherit full oversight of every dealership.

**How admins enter dealer pages — "view as".** An admin doesn't *belong* to a dealership. Instead, the `@dealer_required` decorator resolves the effective `dealership_id` from one of two sources:

1. If the caller has a `dealership_members` row → that dealership_id (the normal dealer path).
2. Else if the caller has `is_admin = true` → the dealership_id specified in the `X-Acting-As-Dealership` header (or `?as=<dealership_id>` query param for GET endpoints). Returns 400 if missing for admin callers.

Neither member nor admin → 403.

The decorator exposes `request.dealer_ctx.actor_kind` = `member | admin`, so endpoint code can branch (e.g. skip role checks for admin, write an audit row for admin).

**Audit trail.** Every write by an admin while acting-as a dealership is logged to `dealer_admin_audit` (§3.1) in the same DB transaction as the write — admin_user_id, dealership_id, method, endpoint, payload digest (not raw body), result status, ip, user-agent, timestamp. Reads are not audited (too noisy). The audit table is visible to admins at `/admin/dealerships/audit-log`.

**Integration into the existing admin shell (no parallel UI).**

1. **`AdminSidebar.js`** gets one new item — **"Dealerships"** — sitting next to the existing "Dealers" (which today is the *verification queue* — pending applications + document review). The two are deliberately separate concerns:
   - **"Dealers"** (existing `AdminDealers.js`) — verification/approval workflow.
   - **"Dealerships"** (new) — operational oversight of *approved* dealerships.
2. **`/admin/dealerships`** — new admin page (lives under the existing `AdminLayout`), listing active dealerships with at-a-glance KPIs: active listings, 7d impressions, 7d leads, 7d conversion %, sold-this-month, last-active. Sortable / searchable. Each row has an **"Open panel"** action that opens `/dealer/dashboard?as=<dealership_id>` in the same tab. Backed by the same `dealer_kpi_daily` rollups + `dealer_market_snapshots` computed for the dealer panel, just queried without a single `dealership_id` filter. New endpoint: `GET /api/admin/dealerships?window=7d`.
3. **`/admin/dealerships/:id`** — admin-side dealership detail (members, suspend/restore, audit log for this dealership, plan status placeholder). Acts as the "manage" view; the "Open panel" button cross-links into the live dealer panel.
4. **`AdminDealers.js` row action** — also gains an "Open panel" link for already-approved dealers, so the verification queue connects naturally to the operational view.
5. **Acting-as banner on dealer pages.** When `actor_kind === 'admin'`, every `/dealer/*` page renders a sticky orange bar across the top: *"Admin view — acting as <dealership name>. Writes are audited."* with an **"Exit"** button that returns to `/admin/dealerships`. Write actions on dealer pages show a confirm dialog when `actor_kind === 'admin'`: *"You are acting as <dealership>. This action will be logged."*
6. **`DealerContext`** stores the `as` param on mount; an axios/fetch interceptor adds `X-Acting-As-Dealership` to every `/api/dealer/*` request automatically.

**Why a separate dealer panel at all** (rather than building everything into `/admin/*`): the same UI must work for dealers themselves *without* admin powers. Putting the operational dealer screens under `/dealer/*` means there's one set of pages and one set of components, used by both audiences — the only difference is the banner and the audit-on-write. Admins do not see *less* than dealers; they see *more* (suspend, audit log, cross-dealership overview), and those additions live on the admin side of the app.

**Reads & RLS.** Admin reads of dealer endpoints bypass the membership check but still go through the same dealership-scoped queries — they just resolve the scope from the header instead of membership. RLS on every new dealer table includes an `OR is_admin(auth.uid())` branch for SELECT. RLS for writes does **not** include the admin branch — admin writes flow through the backend `@dealer_required` path which uses the service role and writes the audit row in the same transaction. This makes the audit non-skippable.

### 2.5 Persistence stack (per memory rule)

Every new listing-like resource is wired into **DB + Redis (read-through cache + invalidation on write) + worker lifecycle jobs**:

- KPI tiles → Redis keyed `(dealership_id, kpi, window)`, 60s TTL, invalidated by listing/lead writes.
- Dealership profile → Redis keyed `dealership:<id>`, invalidated on profile update.
- Daily KPI rollups → `dealer_kpi_daily` table populated by nightly worker, read by dashboard for ranges > 7 days.
- Market snapshots → `dealer_market_snapshots`, rebuilt hourly by worker per active listing.
- Inventory import → `dealer_inventory_jobs` lifecycle managed by background worker; status streamed back via Supabase realtime.
- Webhook delivery → worker with exponential-backoff retries, dead-letter after final attempt.

---

## 3. Data model

### 3.1 New tables

```sql
CREATE TABLE dealerships (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  slug              text UNIQUE NOT NULL,
  legal_name        text,
  trade_license_no  text,
  emirate           text,
  address           text,
  phone             text,
  whatsapp          text,
  logo_url          text,
  cover_url         text,
  website           text,
  bio               text,
  owner_user_id     uuid NOT NULL REFERENCES users(id),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE dealership_members (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealership_id     uuid NOT NULL REFERENCES dealerships(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role              text NOT NULL CHECK (role IN ('owner','manager','sales_rep')),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','invited','revoked')),
  invited_by        uuid REFERENCES users(id),
  invited_at        timestamptz,
  joined_at         timestamptz,
  UNIQUE(dealership_id, user_id),
  UNIQUE(user_id) -- v1: one dealership per user
);

CREATE TABLE dealership_invitations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealership_id     uuid NOT NULL REFERENCES dealerships(id) ON DELETE CASCADE,
  email             text NOT NULL,
  role              text NOT NULL CHECK (role IN ('manager','sales_rep')),
  token             text UNIQUE NOT NULL,
  invited_by        uuid NOT NULL REFERENCES users(id),
  expires_at        timestamptz NOT NULL,
  accepted_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE dealer_admin_audit (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id     uuid NOT NULL REFERENCES users(id),
  dealership_id     uuid NOT NULL REFERENCES dealerships(id) ON DELETE CASCADE,
  http_method       text NOT NULL,
  endpoint          text NOT NULL,
  payload_digest    text,           -- sha256 of redacted payload; never raw body
  result_status     int,
  user_agent        text,
  ip_address        text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_dealer_admin_audit_admin ON dealer_admin_audit(admin_user_id, created_at DESC);
CREATE INDEX idx_dealer_admin_audit_dealership ON dealer_admin_audit(dealership_id, created_at DESC);

CREATE TABLE dealer_kpi_daily (
  dealership_id     uuid NOT NULL REFERENCES dealerships(id) ON DELETE CASCADE,
  date              date NOT NULL,
  listing_id        text,
  listing_type      text,
  impressions       int NOT NULL DEFAULT 0,
  detail_views      int NOT NULL DEFAULT 0,
  call_clicks       int NOT NULL DEFAULT 0,
  whatsapp_clicks   int NOT NULL DEFAULT 0,
  vin_reveals       int NOT NULL DEFAULT 0,
  saves             int NOT NULL DEFAULT 0,
  PRIMARY KEY (dealership_id, date, listing_id, listing_type)
);

CREATE TABLE dealer_market_snapshots (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealership_id     uuid NOT NULL REFERENCES dealerships(id) ON DELETE CASCADE,
  listing_type      text NOT NULL,
  listing_id        text NOT NULL,
  snapshot_at       timestamptz NOT NULL DEFAULT now(),
  comp_count        int NOT NULL,
  median_price      numeric,
  p25_price         numeric,
  p75_price         numeric,
  median_days_on_market int,
  percentile_rank   numeric,
  signals           jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (listing_type, listing_id, snapshot_at)
);

-- P2 tables
CREATE TABLE dealer_leads (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealership_id     uuid NOT NULL REFERENCES dealerships(id) ON DELETE CASCADE,
  listing_type      text NOT NULL,
  listing_id        text NOT NULL,
  source            text NOT NULL CHECK (source IN ('call','whatsapp','vin_open','form')),
  first_event_at    timestamptz NOT NULL,
  last_event_at     timestamptz NOT NULL,
  event_count       int NOT NULL DEFAULT 1,
  visitor_id        text,
  contact_phone     text,
  contact_name      text,
  assigned_to       uuid REFERENCES users(id),
  status            text NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','quoted','test_drive','won','lost')),
  lost_reason       text CHECK (lost_reason IN ('price','financing','stock','unreachable','other')),
  sale_price        numeric,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE dealer_lead_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id           uuid NOT NULL REFERENCES dealer_leads(id) ON DELETE CASCADE,
  actor_user_id     uuid REFERENCES users(id),
  kind              text NOT NULL CHECK (kind IN ('status_change','note','assignment','inbound_contact')),
  payload           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- P3 tables
CREATE TABLE dealer_inventory_jobs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealership_id     uuid NOT NULL REFERENCES dealerships(id) ON DELETE CASCADE,
  kind              text NOT NULL CHECK (kind IN ('csv_import','xml_import','api_pull','csv_export')),
  source            text,
  status            text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','partial','succeeded','failed')),
  rows_total        int NOT NULL DEFAULT 0,
  rows_created      int NOT NULL DEFAULT 0,
  rows_updated      int NOT NULL DEFAULT 0,
  rows_skipped      int NOT NULL DEFAULT 0,
  rows_failed       int NOT NULL DEFAULT 0,
  error_summary     jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at        timestamptz,
  finished_at       timestamptz,
  triggered_by      uuid REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE dealer_inventory_row_errors (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id            uuid NOT NULL REFERENCES dealer_inventory_jobs(id) ON DELETE CASCADE,
  row_index         int NOT NULL,
  external_id       text,
  error_code        text NOT NULL,
  error_message     text NOT NULL,
  raw_row           jsonb
);

CREATE TABLE dealer_api_sources (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealership_id     uuid NOT NULL REFERENCES dealerships(id) ON DELETE CASCADE,
  adapter           text NOT NULL,
  endpoint_url      text NOT NULL,
  auth_type         text NOT NULL CHECK (auth_type IN ('bearer','basic','hmac','none')),
  credentials_enc   text,
  field_mapping     jsonb NOT NULL DEFAULT '{}'::jsonb,
  poll_interval_min int NOT NULL DEFAULT 60,
  last_pulled_at    timestamptz,
  last_status       text,
  last_error        text,
  enabled           bool NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- P4 tables
CREATE TABLE dealer_webhooks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealership_id     uuid NOT NULL REFERENCES dealerships(id) ON DELETE CASCADE,
  url               text NOT NULL,
  secret_enc        text NOT NULL,
  events            text[] NOT NULL,
  enabled           bool NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE dealer_webhook_deliveries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id        uuid NOT NULL REFERENCES dealer_webhooks(id) ON DELETE CASCADE,
  event_type        text NOT NULL,
  payload           jsonb NOT NULL,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','succeeded','failed','dead_letter')),
  attempt_count     int NOT NULL DEFAULT 0,
  next_retry_at     timestamptz,
  last_response_code int,
  last_response_body text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  delivered_at      timestamptz
);
```

### 3.2 Changes to existing tables

- `cars`, `bikes`, `license_plates`, `car_parts`:
  - Add `dealership_id uuid REFERENCES dealerships(id)` (nullable). Backfill from `users.is_dealer`. Add composite index `(dealership_id, status, created_at desc)`.
  - Add `external_id text` (nullable) — the dealer's own ID for this listing in their DMS / CSV feed. Required by P3 bulk import / API ingest as the upsert key. Composite unique index `(dealership_id, external_id) WHERE external_id IS NOT NULL`. Left NULL for manually-posted listings.
- `lead_events`: add denormalised `dealership_id uuid` populated on insert via the existing event-write path; backfill once for historical rows. Index `(dealership_id, created_at desc)`.
- `users`: no schema change.

### 3.3 RLS policies

All new dealer tables get RLS enabled:

- **Read**: `auth.uid()` must appear in `dealership_members` with `status='active'` for the row's `dealership_id`, **OR** `is_admin(auth.uid()) = true`. Service role bypasses (used by workers).
- **Write**: same membership check, plus `role IN ('owner','manager')` for all writes except `dealer_leads.status/assigned_to/notes` updates where `role='sales_rep'` is allowed when `assigned_to = auth.uid()`. Admins are permitted writes *only* via the backend `@dealer_required` path (which writes an audit row in the same transaction) — direct-via-RLS admin writes are disabled to force the audit. (RLS policies for writes do **not** include the `is_admin` branch; the backend uses the service role on behalf of audited admin actions.)

`dealer_admin_audit` itself: read-only for admins; insert-only via service role; never updatable or deletable.

Pre-existing tables (`cars`, etc.) keep their current RLS; the new `dealership_id` column is exposed read-only to dealer members through a new policy. Service role retains full access.

### 3.4 Migration ordering

1. Create `dealerships` + `dealership_members` + `dealership_invitations`.
2. Backfill: for each user with `is_dealer=true`, create one dealership (owner = themselves; slug = sanitized username/email); insert their membership row with role=`owner`.
3. Add `dealership_id` columns to listings tables (nullable). Backfill from `users.is_dealer`.
4. Add denormalised `dealership_id` to `lead_events`; backfill.
5. Create the remaining new tables (admin_audit, kpi_daily, market_snapshots, leads, lead_events, inventory_*, api_sources, webhooks, deliveries).
6. Enable RLS + policies.
7. Deploy backend with the dealer blueprint behind a feature flag (`ENABLE_DEALER_PANEL`).
8. Deploy frontend with `/dealer/*` routes gated by the same flag.
9. Smoke-test with one dealership before lifting the flag.

---

## 4. Dashboard, KPIs & per-listing analytics (Phase 1)

### 4.1 Dashboard layout

Top to bottom:

1. **Header strip** — dealership name, logo, "verified dealer" badge, plan status (greyed "Free during beta").
2. **KPI row** (six tiles, window selector `7d | 30d | 90d | YTD | custom` top-right; all tiles obey the window):
   - Active listings (count + delta vs prior window)
   - Impressions (deduped by visitor+listing+day)
   - Detail-page views (subset where `page_kind='listing_detail'`)
   - Leads (`lead_events` count: call_click + whatsapp_click + vin_reveal, deduped by visitor+listing+action+24h)
   - Lead conversion % (leads ÷ detail views)
   - Sold on platform (`sold_status='sold_on_dph'` count in window)
3. **Trend charts** — impressions/day, leads/day (line); leads-by-source (call vs WhatsApp vs VIN, stacked bar). Use the chart library already in `AdminMetrics.js` (verify Recharts at implementation; fall back to chart.js if not).
4. **Funnel chart** — Impressions → detail views → leads → won. Conversion % between each.
5. **Top performers** — top 5 by impressions, top 5 by lead-conversion; click → per-listing analytics.
6. **Underperformers** — 5 with worst impressions-per-day-listed; 5 with views-but-zero-leads; click → diagnostic page.

### 4.2 Per-listing analytics (`/dealer/listings/:id/analytics`)

- Header card: thumbnail, title, price, status, days_on_market, listed-on, last-edited.
- KPI tiles: impressions, detail views, calls, WhatsApp clicks, VIN reveals, saves, conversion %.
- Time series: impressions / detail views / leads on one chart, toggleable series.
- Source breakdown: pie of how viewers arrived (search vs browse vs home vs direct vs referrer), from `platform_events.metadata.referrer` and prior page in session.
- Visitor depth: avg time on page, scroll depth (if tracked), image-tab interactions.
- "Engagement-but-no-contact": count of sessions where viewer spent >30s OR viewed >3 images but did not call/WhatsApp/reveal-VIN. Seeds the diagnostic engine.

### 4.3 Backend

`backend/routes/dealer_analytics.py` blueprint, scoped by `dealership_id`. Each KPI tile is its own endpoint so the dashboard can fan-out load (mirrors `AdminMetrics` pattern). Dedupe SQL reuses the patterns from the recent admin-stats refactor (windowed, deduped by actor/visitor).

### 4.4 Cache + worker

- Per-listing aggregates and dealership-level KPIs cached in Redis, keyed `(dealership_id, window, kpi)`, TTL 60s. Invalidated by listing/lead writes via existing cache-invalidation helper.
- Nightly `dealer_kpi_aggregator` worker pre-computes daily rollups into `dealer_kpi_daily`. Long-window chart endpoints serve from rollups instead of scanning raw `platform_events`.

---

## 5. "Why isn't this car selling?" diagnostic (Phase 1)

### 5.1 Diagnostic page (`/dealer/listings/:id/diagnostic`)

A single page that combines this listing's metrics, listing-quality signals, and market position into a prioritised checklist of suggested actions.

**Sections:**

1. **Verdict band** — one of:
   - `Not yet enough data` (listed <72h or <100 impressions)
   - `Underperforming on visibility` (impressions/day < 50% of cohort median)
   - `Visibility OK, not converting` (impressions ≥ cohort median but lead-conversion < 50% of cohort median)
   - `Performing on par`
   - `Top performer`
2. **Why this verdict** — 3–6 ranked findings, each with: a one-line problem, an evidence number, a suggested action. Examples:
   - *"Your asking price is in the 90th percentile vs 12 comparable listings (median AED 78,000 / yours AED 95,000). Listings within the 25–75th percentile sell 2.3× faster."* → suggested action: "Adjust price to AED 73,000–83,000 (fair band)."
   - *"Listing has 3 photos; comparable sold listings averaged 14."* → "Add at least 8 more photos including interior, dashboard, and engine bay."
   - *"Title is missing trim (e.g. 'XLE', 'Sport'). 78% of comparable listings include trim."*
   - *"VIN not provided. Listings with VIN convert 1.8× better in this segment."*
   - *"Description is 45 words. Top-quartile sold listings have 200+ words."*
   - *"Days-on-market is 47, vs 22 median. 65% of comparable listings that sell do so within 30 days."*
3. **Re-list / boost CTA** — "If you make these changes, your listing will be re-indexed and re-recommended." Hooks into existing recommendation refresh.

### 5.2 Rule engine

A **rule-based** engine for v1 — no ML. Each rule is a Python class with:
- `applies_to(listing)` — type guard.
- `evaluate(listing, kpi_snapshot, market_snapshot) -> Finding | None` — returns `Finding(problem, evidence, action, severity, rank_weight)` or None.

Rules (v1 set):
- `PriceVsMarketRule` — uses `dealer_market_snapshots`. Severity scales with percentile.
- `PhotoCountRule` — count of rows in the listing's images table (e.g. `car_images.car_id = listing.id`) vs cohort median. For listings whose images are stored as an array column (verify per type at implementation), use the array length.
- `PhotoQualityRule` — flags missing canonical shots (interior, dashboard, engine, rear). Heuristic via image filenames + count alone in v1; image-classification deferred.
- `TitleCompletenessRule` — checks for trim, year, make in title via dictionary lookup against `cars.car_model` + known trim list.
- `VinRule` — flags missing `vin` field; cites VIN-listed conversion uplift in cohort.
- `DescriptionLengthRule` — word count vs cohort 75th percentile.
- `DaysOnMarketRule` — flags if DoM > cohort 75th percentile.
- `EngagementWithoutContactRule` — flags when engagement-but-no-contact ratio > cohort + 1σ; signals "price is the friction" or "contact CTA is hidden", asks dealer to verify phone number is live.
- `StalePhotosRule` — flags if no listing edits in >30 days AND DoM > 30; suggests refresh to bump recommendation.
- `MissingFieldsRule` — flags missing mileage, year, transmission, body_type, exterior_color.

Findings are ranked by `severity × rank_weight`. Top 3–6 shown.

### 5.3 Cohort definition

For each listing the diagnostic runs against, the **cohort** is the same set as the market-eval comps (Section 6). Computed once per snapshot.

### 5.4 Backend

`backend/services/dealer_diagnostic.py`:
- `build_findings(listing, dealership_id)` — fetch KPI snapshot (from `dealer_kpi_daily` + recent rolling counts), fetch latest `dealer_market_snapshot`, build cohort metrics, run all applicable rules, sort, return top N.

Endpoint: `GET /api/dealer/listings/:id/diagnostic` — returns `{verdict, findings: [...], cohort_meta: {...}}`. Cached in Redis 5 min; invalidated on listing edit.

### 5.5 Worker

The diagnostic itself runs on-demand (cheap once snapshots exist). The market-snapshot worker (Section 6) is the heavy lift.

---

## 6. Market evaluation (Phase 1)

### 6.1 Goal

Tell the dealer where each listing sits in the platform's market for its segment: median, p25, p75, percentile rank, comparable count, median days-on-market for sold comps.

### 6.2 Comp selection

For **cars** (most common):
- Same `make` (string equality, case-insensitive).
- Same `car_model` (case-insensitive).
- `make_year` within ±1.
- Mileage within ±20% (if listing has mileage; else skip mileage filter).
- Active listings OR listings sold within last 90 days (sold_status='sold_on_dph' or 'sold_elsewhere').
- Exclude the listing itself; exclude the same dealership's other copies of the same model to avoid self-correlation.
- Require ≥5 comps. If <5, widen progressively: drop mileage filter → widen year to ±2 → drop trim. If still <5, return `insufficient_comps`.

For **bikes / plates / parts**: same shape, different fields (plates: format+digit-count; parts: category+make+model).

### 6.3 Outputs (per snapshot)

```
comp_count
median_price, p25_price, p75_price
median_days_on_market (sold comps only)
percentile_rank (this listing's price among comps, 0..1)
fair_price_band (p25..p75)
signals: {
  by_mileage_bucket: [...],
  by_year: [...],
  recently_sold_avg_price: ...,
  price_elasticity_hint: ...   // optional: among sold comps, do lower-priced ones sell faster? simple regression slope.
}
```

### 6.4 Backend

`backend/services/dealer_market.py`:
- `compute_snapshot(listing_type, listing_id) -> Snapshot`.
- `MarketDataSource` interface implemented by `PlatformMarketDataSource` (own DB). Future scrapers/paid feeds slot in.

`market_snapshot_worker`: every hour, iterate over active dealership listings, recompute snapshot, upsert into `dealer_market_snapshots`. Older snapshots retained 90 days for trend; older purged nightly.

Endpoint: `GET /api/dealer/listings/:id/market` — returns the latest snapshot.

### 6.5 Dashboard surface

A "Market position" tab on the per-listing analytics page with:
- Big number: percentile rank, e.g. "Priced higher than 87% of comparable listings".
- Fair price band visualisation (p25–p75 with this listing's mark).
- Sold-comps table: last 10 sold comps with price, mileage, DoM.
- "Apply suggested price" inline action (manager+ only) → pre-fills the edit form.

---

## 7. Lead inbox & pipeline (Phase 2)

### 7.1 What constitutes a lead

A `dealer_leads` row is created (or its `last_event_at`/`event_count` updated) when a `lead_events` row lands for a listing whose `dealership_id` is set. **Dedupe key**: `(dealership_id, listing_id, listing_type, visitor_id, source)` within a rolling 24h window — same visitor calling twice in the same day is one lead.

If `visitor_id` is null (anonymous), fall back to `(ip_address, user_agent_hash)` — but only within a 30-min window since collisions are higher.

### 7.2 Inbox page (`/dealer/leads`)

- List view with sort (recency / status / value) and filters (status, assigned-to, source, listing).
- Each row: listing thumbnail + title, source icon, time, status pill, assignee avatar, action count.
- Bulk actions: assign to rep, mark contacted, mark lost.
- Realtime updates via Supabase realtime channel scoped by `dealership_id`.

### 7.3 Lead detail (`/dealer/leads/:id`)

- Listing card (link to the listing).
- Visitor session history: how they arrived (referrer chain), other listings they viewed in this session, time on this listing, image interactions. Pulled from `platform_events` filtered by `visitor_id` + session window.
- Timeline: status changes, notes, assignments, every event (call_click etc.) — from `dealer_lead_events` + the original `lead_events`.
- Actions: status dropdown (`new → contacted → quoted → test_drive → won/lost`), assign-to-rep, add note, mark won (captures sale price), mark lost (captures reason).

### 7.4 Notifications

- In-app toast via Supabase realtime: "New lead for [listing]" to dealership members.
- Optional email to the assignee on assignment (uses existing `send_email` infra).
- WhatsApp notification deferred (would need WhatsApp Business API — Phase 4 or later).

### 7.5 Backend

`backend/routes/dealer_leads.py`:
- `GET /api/dealer/leads` — paginated list.
- `GET /api/dealer/leads/:id` — detail with timeline.
- `PATCH /api/dealer/leads/:id` — status / assignee / notes / sale_price / lost_reason.
- `POST /api/dealer/leads/:id/note` — adds a `dealer_lead_events` row of kind `note`.

`dealer_lead_aggregator` worker: subscribes to `lead_events` inserts (or polls), creates/updates `dealer_leads`, writes `dealer_lead_events`. Idempotent (uses dedupe key).

---

## 8. Bulk inventory feed & DMS ingest (Phase 3)

### 8.1 CSV / XML import

UI: drag-drop file, choose schema template (or "Auto-detect"), preview first 10 rows with column mapping, confirm → job submitted.

Backend:
- `POST /api/dealer/inventory/imports` — accepts file (multipart) + mapping JSON. Stores file in Supabase storage `dealer-imports/<dealership_id>/<job_id>/<filename>`. Creates `dealer_inventory_jobs` row with `status='queued'`.
- Background worker `inventory_import_worker` pulls queued jobs:
  - Parses file (CSV via stdlib, XML via `defusedxml`).
  - For each row: applies field mapping, validates required fields, checks `external_id` against existing dealership listings.
    - If exists → update.
    - If not → create. Image URLs are fetched, validated, uploaded to our storage. Skipped if image fails to fetch (logged in row_errors).
  - Per-row errors do **not** fail the job. Job ends with `succeeded`, `partial`, or `failed` (if file is unparseable).
- Job detail page (`/dealer/inventory/jobs/:id`) shows real-time progress (Supabase realtime), final counts, downloadable row-errors CSV.

**Idempotency**: `(dealership_id, external_id)` is the upsert key. Re-importing the same file is a no-op except for true field changes.

**Removed-from-feed** (optional): a flag per `dealer_api_sources` configuration — auto-deactivate listings absent from feed for N consecutive polls. Off by default.

### 8.2 CSV export

`POST /api/dealer/inventory/exports` → creates a `csv_export` job → worker writes file to `dealer-exports/...` → user gets signed download URL. Single canonical column set.

### 8.3 DMS API ingest

UI: "Add API source" form — adapter dropdown (`generic_json` for v1), endpoint URL, auth type + credentials, field mapping editor, test connection, save.

Credentials encrypted at rest with envelope encryption (KMS key reference in env). Decrypted only inside the worker.

Worker `dealer_api_pull_worker` runs on a schedule:
- For each enabled `dealer_api_sources`, if `last_pulled_at + poll_interval_min` is in the past, fetch.
- Treat fetch response as a virtual file → same pipeline as CSV/XML import (creates a `dealer_inventory_jobs` row with `kind='api_pull'`).
- Update `last_pulled_at`, `last_status`, `last_error`.

`generic_json` adapter accepts arbitrary JSON arrays + JSONPath field mappings. Named adapters can be added later as Python classes implementing a `DMSAdapter` interface (`fetch() -> Iterable[dict]`).

---

## 9. Webhooks (Phase 4)

### 9.1 UI

`/dealer/integrations` → list webhooks → add/edit/delete. Add form: URL, event subscriptions (multi-select), enabled toggle. On save: backend generates a fresh signing secret, returns it **once** for the dealer to copy. Subsequent reads never reveal the secret.

Per-webhook delivery log (paginated, last 100): event, status, timestamp, response code, "redeliver" button.

### 9.2 Events emitted (v1)

- `lead.created`
- `lead.status_changed`
- `lead.assigned`
- `listing.created`
- `listing.updated`
- `listing.sold`
- `listing.view_milestone` (every 100 impressions)
- `inventory.job_completed`

### 9.3 Delivery

`webhook_delivery_worker`:
- On event emission, enqueue a `dealer_webhook_deliveries` row per matching enabled webhook.
- Worker picks pending deliveries, signs payload with HMAC-SHA256 (`X-DPH-Signature: t=<unix>, v1=<hex>`), POSTs with 10s timeout.
- 2xx → mark `succeeded`.
- Non-2xx / timeout → schedule next retry. Backoff: 1m, 5m, 15m, 1h, 6h. After 5 failed attempts → `dead_letter`.
- Dealer can "Redeliver" any past delivery from the UI (creates a fresh row).

### 9.4 Payload shape

```
{
  "id": "<delivery uuid>",
  "type": "lead.created",
  "occurred_at": "<iso8601>",
  "dealership_id": "<uuid>",
  "data": { ...event-specific... }
}
```

Headers: `X-DPH-Event`, `X-DPH-Signature`, `X-DPH-Delivery-Id`.

---

## 10. Error handling & resilience

- All dealer-panel endpoints return structured JSON errors: `{error: {code, message, details?}}`. Codes machine-readable (`dealer_not_verified`, `dealership_not_found`, `insufficient_role`, `comp_data_unavailable`, etc.).
- Background workers idempotent. Every job has a unique key; reruns are safe.
- Webhook deliveries retried with exponential backoff and dead-letter (above).
- Bulk imports tolerate partial failures; per-row errors logged but never fail the whole job.
- All worker errors logged + alerted via existing logging infra (`logger.error` + Sentry if configured).
- Realtime channels degrade gracefully — if Supabase realtime is unavailable, UI falls back to polling every 30s (existing pattern from `AdminDashboard.js`).

---

## 11. Testing strategy

### 11.1 Unit

- `dealer_kpi`: dedupe logic (`visitor+listing+day` for impressions, `visitor+listing+action+24h` for leads).
- `dealer_diagnostic`: each rule independently — given a synthetic listing + cohort, assert findings.
- `dealer_market`: comp-selection widening logic; percentile + p25/p75 math.
- `webhook_signing`: HMAC payload + verifier roundtrip.
- `inventory_import`: row parser, field-mapping engine, image URL validator.

### 11.2 Integration

- **Cross-dealership isolation**: as user A (dealership X), every dealer endpoint must return only X's data, never Y's. Pytest fixtures create two dealerships.
- **RLS policies**: direct Supabase queries as different roles confirm read/write boundaries.
- **Lead pipeline state machine**: every transition (`new → contacted → ... → won/lost`) writes a `dealer_lead_events` row and is permitted only for allowed roles.
- **Job lifecycle**: import job goes `queued → running → (succeeded | partial | failed)`; errors recorded; resumable on worker restart.
- **Webhook retries**: with a deliberately failing test endpoint, deliveries hit dead-letter exactly after 5 attempts.

### 11.3 End-to-end (happy path, Phase 1)

Manual or playwright: dealer logs in → dashboard loads → opens an underperformer → reads diagnostic → adjusts price → returns to dashboard → sees market snapshot reflect the change after next worker cycle.

### 11.4 Performance

- Dashboard p95 < 800ms for a dealer with 200 active listings, 30d window.
- Per-listing analytics p95 < 500ms.
- Market snapshot worker completes in <30 min for 5,000 active dealership listings.
- KPI rollup worker completes in <10 min nightly.

---

## 12. Open questions / deferred decisions

- WhatsApp Business API integration depth (templated messages, two-way) — left for a post-P4 phase.
- Image quality classification for diagnostic rules — deferred; v1 uses count-only heuristic.
- Multi-dealership membership — v1 explicitly forbids; revisit if customer demand emerges.
- Public dealer storefront page (`/dealer-public/<slug>`) — out of scope here; can be added by reusing the same `dealerships` table.
- ML-based pricing recommendations — explicitly deferred behind the `MarketDataSource` interface.

---

## 13. Acceptance criteria for Phase 1

A verified dealer can:
1. Be auto-onboarded into a single-seat dealership (their existing listings linked).
2. Invite any number of managers / sales_reps (no seat cap in v1); invitees accept via signed email link, become a `dealership_members` row.
3. Land on `/dealer/dashboard` and see 6 KPI tiles, two trend charts, funnel, top/under performer tables, all scoped to their dealership.
4. Click any listing → see per-listing analytics with time series, sources, engagement-no-contact count, and market position.
5. Click "diagnostic" on a listing → see verdict + 3–6 ranked findings → click "apply suggested price" → pre-filled edit form opens.
6. All RLS policies verified — a curl with another dealer's JWT returns 0 rows from any dealer endpoint.
7. A user with `is_admin = true` can: see the new "Dealerships" entry in the existing admin sidebar; open `/admin/dealerships` and see the cross-dealership overview; click "Open panel" on any dealership to land in `/dealer/dashboard?as=<id>`; see the orange "Admin view — acting as …" banner on every dealer page; perform any owner-equivalent write and have it recorded in `dealer_admin_audit`; review the audit log at `/admin/dealerships/audit-log`.
8. Performance budgets met on a seeded dealership with 200 listings.

Phase 1 ships when all of the above is true and a smoke test passes against the seeded staging dealership.
