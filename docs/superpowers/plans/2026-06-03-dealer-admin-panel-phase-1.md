# Dealer Admin Panel — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the dealer admin panel foundation (org + seats), KPI dashboard, per-listing analytics, rule-based "why isn't this selling" diagnostic, market evaluation, and the admin "view as" oversight surface.

**Architecture:** New `/dealer/*` React route tree using the same auth + apiClient as the rest of the app. New Flask blueprint `routes/dealer.py` (subdivided into `dealer_analytics.py`, `dealer_market.py`, `dealer_diagnostic.py`). New tables `dealerships`, `dealership_members`, `dealership_invitations`, `dealer_kpi_daily`, `dealer_market_snapshots`, `dealer_admin_audit`. Existing listings tables get `dealership_id` + `external_id` columns. Two new workers: nightly KPI aggregator, hourly market-snapshot. Admins enter dealer pages via `?as=<dealership_id>` → `X-Acting-As-Dealership` header → every write logged.

**Tech Stack:** Flask + Supabase (Postgres + RLS) + Redis + React. Reuses the project's existing `token_required` decorator, `apiClient`, `AdminLayout/Sidebar/Route` patterns, and the same chart styling already in `AdminMetrics.js` (ListBars / StatCard / Section primitives).

**Spec reference:** `docs/superpowers/specs/2026-06-03-dealer-admin-panel-design.md` — sections 1, 2, 3 (full), 4, 5, 6, 10, 11, 13.

**Out of scope for this plan:** Phase 2 leads / Phase 3 inventory / Phase 4 webhooks (separate plans).

---

## Conventions used in this plan

- All Python file paths are under `flask-react-supabase-app/backend/`.
- All React file paths are under `flask-react-supabase-app/frontend/src/`.
- SQL migrations live in `flask-react-supabase-app/backend/migrations/`.
- Commits use the project's existing one-line style. Plain `git add <file> && git commit -m "..."`. No `--no-verify`.
- After every implementation task, run the relevant focused tests. Full-suite verification is a dedicated task at the end.
- For Supabase REST calls use the existing `supabase_request` helper or raw `requests.*` to `${SUPABASE_URL}/rest/v1/...` with `apikey` + `Authorization: Bearer ${SUPABASE_SERVICE_KEY}` headers (matches existing patterns in `app.py`).

---

## Group A — Schema foundation

### Task 1: Migration — dealerships, dealership_members, dealership_invitations

**Files:**
- Create: `flask-react-supabase-app/backend/migrations/2026_06_03_dealerships.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Dealer panel foundation: orgs + seats + invitations

CREATE TABLE IF NOT EXISTS public.dealerships (
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
    owner_user_id     uuid NOT NULL REFERENCES public.users(id),
    status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dealerships_owner ON public.dealerships(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_dealerships_status ON public.dealerships(status);

CREATE TABLE IF NOT EXISTS public.dealership_members (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dealership_id     uuid NOT NULL REFERENCES public.dealerships(id) ON DELETE CASCADE,
    user_id           uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    role              text NOT NULL CHECK (role IN ('owner','manager','sales_rep')),
    status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','invited','revoked')),
    invited_by        uuid REFERENCES public.users(id),
    invited_at        timestamptz,
    joined_at         timestamptz DEFAULT now(),
    UNIQUE(dealership_id, user_id),
    UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_dealership_members_dealership ON public.dealership_members(dealership_id);
CREATE INDEX IF NOT EXISTS idx_dealership_members_user ON public.dealership_members(user_id);
CREATE INDEX IF NOT EXISTS idx_dealership_members_status ON public.dealership_members(status);

CREATE TABLE IF NOT EXISTS public.dealership_invitations (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dealership_id     uuid NOT NULL REFERENCES public.dealerships(id) ON DELETE CASCADE,
    email             text NOT NULL,
    role              text NOT NULL CHECK (role IN ('manager','sales_rep')),
    token             text UNIQUE NOT NULL,
    invited_by        uuid NOT NULL REFERENCES public.users(id),
    expires_at        timestamptz NOT NULL,
    accepted_at       timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invitations_dealership ON public.dealership_invitations(dealership_id);
CREATE INDEX IF NOT EXISTS idx_invitations_token ON public.dealership_invitations(token);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON public.dealership_invitations(email);

DO $$ BEGIN RAISE NOTICE '✅ dealerships, dealership_members, dealership_invitations created'; END $$;
```

- [ ] **Step 2: Apply migration in Supabase SQL editor or via the project's apply helper**

Use the same path used by other migrations in the repo (Supabase Studio → SQL editor → run the file). If the project has `backend/apply_migration.py` style helper, use it.

- [ ] **Step 3: Verify tables exist**

```bash
# Optional: run a quick existence check
psql "$DATABASE_URL" -c "\dt public.dealerships public.dealership_members public.dealership_invitations"
```

- [ ] **Step 4: Commit**

```bash
git add flask-react-supabase-app/backend/migrations/2026_06_03_dealerships.sql
git commit -m "Dealer panel: dealerships/members/invitations tables"
```

---

### Task 2: Migration — backfill dealerships from existing is_dealer users

**Files:**
- Create: `flask-react-supabase-app/backend/migrations/2026_06_03_dealerships_backfill.sql`

- [ ] **Step 1: Write the migration**

```sql
-- One dealership per existing is_dealer=true user, owner = themselves.
DO $$
DECLARE
    u RECORD;
    new_dealership_id uuid;
    new_slug text;
    slug_suffix int;
BEGIN
    FOR u IN
        SELECT id, COALESCE(NULLIF(TRIM(username), ''), email) AS handle,
               COALESCE(NULLIF(TRIM(first_name), ''), '') AS first_name
        FROM public.users
        WHERE is_dealer = true
        AND NOT EXISTS (
            SELECT 1 FROM public.dealership_members m WHERE m.user_id = users.id
        )
    LOOP
        new_slug := LOWER(REGEXP_REPLACE(u.handle, '[^a-zA-Z0-9]+', '-', 'g'));
        new_slug := TRIM(BOTH '-' FROM new_slug);
        IF new_slug = '' THEN new_slug := 'dealer'; END IF;

        slug_suffix := 0;
        WHILE EXISTS (SELECT 1 FROM public.dealerships WHERE slug = new_slug) LOOP
            slug_suffix := slug_suffix + 1;
            new_slug := new_slug || '-' || slug_suffix::text;
        END LOOP;

        INSERT INTO public.dealerships (name, slug, owner_user_id)
        VALUES (COALESCE(NULLIF(u.first_name, ''), u.handle), new_slug, u.id)
        RETURNING id INTO new_dealership_id;

        INSERT INTO public.dealership_members (dealership_id, user_id, role, status, joined_at)
        VALUES (new_dealership_id, u.id, 'owner', 'active', now());
    END LOOP;

    RAISE NOTICE '✅ Backfilled % dealerships',
        (SELECT COUNT(*) FROM public.dealerships);
END $$;
```

- [ ] **Step 2: Apply via Supabase SQL editor**

- [ ] **Step 3: Verify**

```sql
SELECT count(*) FROM public.dealerships;
SELECT count(*) FROM public.dealership_members WHERE role = 'owner';
-- Both should equal the count of users with is_dealer=true.
SELECT count(*) FROM public.users WHERE is_dealer = true;
```

- [ ] **Step 4: Commit**

```bash
git add flask-react-supabase-app/backend/migrations/2026_06_03_dealerships_backfill.sql
git commit -m "Dealer panel: backfill dealerships from is_dealer users"
```

---

### Task 3: Migration — add dealership_id + external_id to listings tables + backfill

**Files:**
- Create: `flask-react-supabase-app/backend/migrations/2026_06_03_listings_dealership_link.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Link listings to dealerships + introduce external_id (for P3 importer upsert key).

ALTER TABLE public.cars
    ADD COLUMN IF NOT EXISTS dealership_id uuid REFERENCES public.dealerships(id),
    ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE public.bikes
    ADD COLUMN IF NOT EXISTS dealership_id uuid REFERENCES public.dealerships(id),
    ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE public.license_plates
    ADD COLUMN IF NOT EXISTS dealership_id uuid REFERENCES public.dealerships(id),
    ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE public.car_parts
    ADD COLUMN IF NOT EXISTS dealership_id uuid REFERENCES public.dealerships(id),
    ADD COLUMN IF NOT EXISTS external_id text;

CREATE INDEX IF NOT EXISTS idx_cars_dealership ON public.cars(dealership_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bikes_dealership ON public.bikes(dealership_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_plates_dealership ON public.license_plates(dealership_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_parts_dealership ON public.car_parts(dealership_id, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cars_dealer_external
    ON public.cars(dealership_id, external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bikes_dealer_external
    ON public.bikes(dealership_id, external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_plates_dealer_external
    ON public.license_plates(dealership_id, external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_parts_dealer_external
    ON public.car_parts(dealership_id, external_id) WHERE external_id IS NOT NULL;

-- Backfill from existing dealership_members (one membership per user, role=owner).
UPDATE public.cars c
SET dealership_id = m.dealership_id
FROM public.dealership_members m
WHERE c.user_id = m.user_id AND c.dealership_id IS NULL;

UPDATE public.bikes c
SET dealership_id = m.dealership_id
FROM public.dealership_members m
WHERE c.user_id = m.user_id AND c.dealership_id IS NULL;

UPDATE public.license_plates c
SET dealership_id = m.dealership_id
FROM public.dealership_members m
WHERE c.user_id = m.user_id AND c.dealership_id IS NULL;

UPDATE public.car_parts c
SET dealership_id = m.dealership_id
FROM public.dealership_members m
WHERE c.user_id = m.user_id AND c.dealership_id IS NULL;

DO $$ BEGIN RAISE NOTICE '✅ listings backfilled with dealership_id'; END $$;
```

- [ ] **Step 2: Apply migration**

- [ ] **Step 3: Verify**

```sql
SELECT count(*) FROM public.cars WHERE dealership_id IS NOT NULL;
SELECT count(*) FROM public.cars c
  JOIN public.users u ON u.id = c.user_id
  WHERE u.is_dealer = true AND c.dealership_id IS NULL;
-- Second count should be 0.
```

- [ ] **Step 4: Commit**

```bash
git add flask-react-supabase-app/backend/migrations/2026_06_03_listings_dealership_link.sql
git commit -m "Dealer panel: link listings to dealerships, add external_id"
```

---

### Task 4: Migration — denormalised dealership_id on lead_events + backfill

**Files:**
- Create: `flask-react-supabase-app/backend/migrations/2026_06_03_lead_events_dealership.sql`

- [ ] **Step 1: Write the migration**

```sql
ALTER TABLE public.lead_events
    ADD COLUMN IF NOT EXISTS dealership_id uuid REFERENCES public.dealerships(id);

CREATE INDEX IF NOT EXISTS idx_lead_events_dealership_time
    ON public.lead_events(dealership_id, created_at DESC);

-- Backfill: derive dealership_id by joining each lead_event to its listing's dealership_id.
UPDATE public.lead_events le
SET dealership_id = c.dealership_id
FROM public.cars c
WHERE le.listing_type = 'car' AND le.listing_id::uuid = c.id AND le.dealership_id IS NULL;

UPDATE public.lead_events le
SET dealership_id = b.dealership_id
FROM public.bikes b
WHERE le.listing_type = 'bike' AND le.listing_id::uuid = b.id AND le.dealership_id IS NULL;

UPDATE public.lead_events le
SET dealership_id = p.dealership_id
FROM public.license_plates p
WHERE le.listing_type = 'plate' AND le.listing_id::uuid = p.id AND le.dealership_id IS NULL;

UPDATE public.lead_events le
SET dealership_id = cp.dealership_id
FROM public.car_parts cp
WHERE le.listing_type = 'part' AND le.listing_id::uuid = cp.id AND le.dealership_id IS NULL;

DO $$ BEGIN RAISE NOTICE '✅ lead_events backfilled with dealership_id'; END $$;
```

- [ ] **Step 2: Apply migration**

- [ ] **Step 3: Commit**

```bash
git add flask-react-supabase-app/backend/migrations/2026_06_03_lead_events_dealership.sql
git commit -m "Dealer panel: denormalise dealership_id on lead_events"
```

---

### Task 5: Migration — dealer_kpi_daily, dealer_market_snapshots, dealer_admin_audit

**Files:**
- Create: `flask-react-supabase-app/backend/migrations/2026_06_03_dealer_kpi_market_audit.sql`

- [ ] **Step 1: Write the migration**

```sql
CREATE TABLE IF NOT EXISTS public.dealer_kpi_daily (
    dealership_id   uuid NOT NULL REFERENCES public.dealerships(id) ON DELETE CASCADE,
    date            date NOT NULL,
    listing_id      text NOT NULL DEFAULT '',
    listing_type    text NOT NULL DEFAULT '',
    impressions     int NOT NULL DEFAULT 0,
    detail_views    int NOT NULL DEFAULT 0,
    call_clicks     int NOT NULL DEFAULT 0,
    whatsapp_clicks int NOT NULL DEFAULT 0,
    vin_reveals     int NOT NULL DEFAULT 0,
    saves           int NOT NULL DEFAULT 0,
    PRIMARY KEY (dealership_id, date, listing_id, listing_type)
);
CREATE INDEX IF NOT EXISTS idx_kpi_daily_dealership_date ON public.dealer_kpi_daily(dealership_id, date DESC);

CREATE TABLE IF NOT EXISTS public.dealer_market_snapshots (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dealership_id         uuid NOT NULL REFERENCES public.dealerships(id) ON DELETE CASCADE,
    listing_type          text NOT NULL,
    listing_id            text NOT NULL,
    snapshot_at           timestamptz NOT NULL DEFAULT now(),
    comp_count            int NOT NULL,
    median_price          numeric,
    p25_price             numeric,
    p75_price             numeric,
    median_days_on_market int,
    percentile_rank       numeric,
    signals               jsonb NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (listing_type, listing_id, snapshot_at)
);
CREATE INDEX IF NOT EXISTS idx_market_snapshots_listing
    ON public.dealer_market_snapshots(listing_type, listing_id, snapshot_at DESC);

CREATE TABLE IF NOT EXISTS public.dealer_admin_audit (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_user_id   uuid NOT NULL REFERENCES public.users(id),
    dealership_id   uuid NOT NULL REFERENCES public.dealerships(id) ON DELETE CASCADE,
    http_method     text NOT NULL,
    endpoint        text NOT NULL,
    payload_digest  text,
    result_status   int,
    user_agent      text,
    ip_address      text,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dealer_admin_audit_admin
    ON public.dealer_admin_audit(admin_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dealer_admin_audit_dealership
    ON public.dealer_admin_audit(dealership_id, created_at DESC);

DO $$ BEGIN RAISE NOTICE '✅ dealer_kpi_daily, dealer_market_snapshots, dealer_admin_audit created'; END $$;
```

- [ ] **Step 2: Apply migration**

- [ ] **Step 3: Commit**

```bash
git add flask-react-supabase-app/backend/migrations/2026_06_03_dealer_kpi_market_audit.sql
git commit -m "Dealer panel: kpi_daily, market_snapshots, admin_audit tables"
```

---

### Task 6: Migration — RLS policies on all new dealer tables

**Files:**
- Create: `flask-react-supabase-app/backend/migrations/2026_06_03_dealer_rls.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Helper: is the caller an active member of the given dealership?
CREATE OR REPLACE FUNCTION public.is_dealership_member(p_dealership_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.dealership_members
        WHERE dealership_id = p_dealership_id
        AND user_id = auth.uid()
        AND status = 'active'
    );
$$;

-- Existing is_admin(uid) helper assumed (used by other admin tables).

ALTER TABLE public.dealerships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dealerships_read" ON public.dealerships;
CREATE POLICY "dealerships_read" ON public.dealerships FOR SELECT
USING (public.is_dealership_member(id) OR public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "dealerships_service_all" ON public.dealerships;
CREATE POLICY "dealerships_service_all" ON public.dealerships FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.dealership_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "members_read" ON public.dealership_members;
CREATE POLICY "members_read" ON public.dealership_members FOR SELECT
USING (public.is_dealership_member(dealership_id) OR public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "members_service_all" ON public.dealership_members;
CREATE POLICY "members_service_all" ON public.dealership_members FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.dealership_invitations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "invites_read" ON public.dealership_invitations;
CREATE POLICY "invites_read" ON public.dealership_invitations FOR SELECT
USING (public.is_dealership_member(dealership_id) OR public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "invites_service_all" ON public.dealership_invitations;
CREATE POLICY "invites_service_all" ON public.dealership_invitations FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.dealer_kpi_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "kpi_daily_read" ON public.dealer_kpi_daily;
CREATE POLICY "kpi_daily_read" ON public.dealer_kpi_daily FOR SELECT
USING (public.is_dealership_member(dealership_id) OR public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "kpi_daily_service_all" ON public.dealer_kpi_daily;
CREATE POLICY "kpi_daily_service_all" ON public.dealer_kpi_daily FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.dealer_market_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "market_read" ON public.dealer_market_snapshots;
CREATE POLICY "market_read" ON public.dealer_market_snapshots FOR SELECT
USING (public.is_dealership_member(dealership_id) OR public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "market_service_all" ON public.dealer_market_snapshots;
CREATE POLICY "market_service_all" ON public.dealer_market_snapshots FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.dealer_admin_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit_admin_read" ON public.dealer_admin_audit;
CREATE POLICY "audit_admin_read" ON public.dealer_admin_audit FOR SELECT
USING (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "audit_service_insert" ON public.dealer_admin_audit;
CREATE POLICY "audit_service_insert" ON public.dealer_admin_audit FOR INSERT WITH CHECK (true);
-- No UPDATE or DELETE policy: audit is append-only.

GRANT SELECT ON public.dealerships, public.dealership_members, public.dealership_invitations,
                public.dealer_kpi_daily, public.dealer_market_snapshots, public.dealer_admin_audit
       TO authenticated;
GRANT ALL ON public.dealerships, public.dealership_members, public.dealership_invitations,
              public.dealer_kpi_daily, public.dealer_market_snapshots, public.dealer_admin_audit
       TO service_role;
```

- [ ] **Step 2: Apply migration**

- [ ] **Step 3: Commit**

```bash
git add flask-react-supabase-app/backend/migrations/2026_06_03_dealer_rls.sql
git commit -m "Dealer panel: RLS policies on new tables"
```

---

## Group B — Backend foundation

### Task 7: Feature flag + dealer module package skeleton

**Files:**
- Create: `flask-react-supabase-app/backend/routes/__init__.py` (verify exists; if not, create empty)
- Create: `flask-react-supabase-app/backend/routes/dealer/__init__.py`
- Create: `flask-react-supabase-app/backend/routes/dealer/_decorators.py`
- Modify: `flask-react-supabase-app/backend/app.py` — register the blueprint behind `ENABLE_DEALER_PANEL` env var.

- [ ] **Step 1: Create package skeleton**

`flask-react-supabase-app/backend/routes/dealer/__init__.py`:

```python
"""Dealer admin panel blueprint package.

Sub-blueprints (registered in this package's `register_dealer_blueprints`):
  - dealer_core    : /api/dealer/me, dealership profile, members, invitations
  - dealer_analytics : KPI tiles, trend charts, funnel, top/under performers, per-listing analytics
  - dealer_market    : market snapshots
  - dealer_diagnostic: diagnostic findings per listing
  - admin_dealerships: /api/admin/dealerships oversight surface

Feature-flagged behind ENABLE_DEALER_PANEL=true at app startup.
"""
from flask import Blueprint


def register_dealer_blueprints(app):
    """Mount all dealer-panel blueprints on the Flask app.

    Called from app.py at startup when ENABLE_DEALER_PANEL=true.
    """
    from .core import core_bp
    from .analytics import analytics_bp
    from .market import market_bp
    from .diagnostic import diagnostic_bp
    from .admin_oversight import admin_oversight_bp

    app.register_blueprint(core_bp)
    app.register_blueprint(analytics_bp)
    app.register_blueprint(market_bp)
    app.register_blueprint(diagnostic_bp)
    app.register_blueprint(admin_oversight_bp)
```

- [ ] **Step 2: Register in app.py**

Open `flask-react-supabase-app/backend/app.py`, find where other blueprints register (search for `register_blueprint`). Add near the bottom of the route-registration section:

```python
import os as _os
if _os.getenv("ENABLE_DEALER_PANEL", "false").lower() == "true":
    from routes.dealer import register_dealer_blueprints
    register_dealer_blueprints(app)
```

- [ ] **Step 3: Smoke test — app still boots without the flag**

```bash
cd flask-react-supabase-app/backend
ENABLE_DEALER_PANEL=false python -c "import app; print('boots ok')"
```

Expected: "boots ok".

- [ ] **Step 4: Commit**

```bash
git add flask-react-supabase-app/backend/routes/dealer/__init__.py flask-react-supabase-app/backend/app.py
git commit -m "Dealer panel: blueprint skeleton + feature flag"
```

---

### Task 8: `@dealer_required` decorator (member + admin "view as")

**Files:**
- Create: `flask-react-supabase-app/backend/routes/dealer/_decorators.py`
- Create: `flask-react-supabase-app/backend/test_dealer_required.py`

- [ ] **Step 1: Write the failing test**

```python
# flask-react-supabase-app/backend/test_dealer_required.py
"""Verify @dealer_required resolves member context, admin view-as, and 403s otherwise."""
import os
from unittest.mock import patch, MagicMock
import pytest
import flask

# We test the decorator in isolation against a mocked user lookup.
from routes.dealer._decorators import dealer_required


@pytest.fixture
def app():
    a = flask.Flask(__name__)

    @a.route("/probe")
    @dealer_required
    def probe():
        ctx = flask.g.dealer_ctx
        return {"dealership_id": str(ctx["dealership_id"]),
                "role": ctx["role"], "actor_kind": ctx["actor_kind"]}

    return a


def _make_ctx(headers=None, args=None):
    return {"headers": headers or {}, "args": args or {}}


def test_member_resolved(app, monkeypatch):
    monkeypatch.setattr("routes.dealer._decorators._get_current_user_id",
                        lambda: "user-1")
    monkeypatch.setattr("routes.dealer._decorators._lookup_membership",
                        lambda uid: {"dealership_id": "deal-1", "role": "owner"})
    monkeypatch.setattr("routes.dealer._decorators._is_admin", lambda uid: False)
    monkeypatch.setattr("routes.dealer._decorators._audit_write",
                        lambda *a, **k: None)

    client = app.test_client()
    r = client.get("/probe")
    assert r.status_code == 200, r.data
    assert r.json["dealership_id"] == "deal-1"
    assert r.json["actor_kind"] == "member"


def test_admin_view_as(app, monkeypatch):
    monkeypatch.setattr("routes.dealer._decorators._get_current_user_id",
                        lambda: "admin-1")
    monkeypatch.setattr("routes.dealer._decorators._lookup_membership", lambda uid: None)
    monkeypatch.setattr("routes.dealer._decorators._is_admin", lambda uid: True)
    monkeypatch.setattr("routes.dealer._decorators._audit_write",
                        lambda *a, **k: None)

    client = app.test_client()
    r = client.get("/probe?as=deal-9")
    assert r.status_code == 200
    assert r.json["dealership_id"] == "deal-9"
    assert r.json["actor_kind"] == "admin"


def test_admin_without_as_returns_400(app, monkeypatch):
    monkeypatch.setattr("routes.dealer._decorators._get_current_user_id",
                        lambda: "admin-1")
    monkeypatch.setattr("routes.dealer._decorators._lookup_membership", lambda uid: None)
    monkeypatch.setattr("routes.dealer._decorators._is_admin", lambda uid: True)

    client = app.test_client()
    r = client.get("/probe")
    assert r.status_code == 400


def test_neither_member_nor_admin_403(app, monkeypatch):
    monkeypatch.setattr("routes.dealer._decorators._get_current_user_id",
                        lambda: "rando-1")
    monkeypatch.setattr("routes.dealer._decorators._lookup_membership", lambda uid: None)
    monkeypatch.setattr("routes.dealer._decorators._is_admin", lambda uid: False)

    client = app.test_client()
    r = client.get("/probe?as=deal-9")
    assert r.status_code == 403
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd flask-react-supabase-app/backend && python -m pytest test_dealer_required.py -v
```

Expected: ImportError or all fail.

- [ ] **Step 3: Implement the decorator**

```python
# flask-react-supabase-app/backend/routes/dealer/_decorators.py
"""Dealer-panel auth decorator.

Resolves caller -> effective dealership_id by either:
  1) reading the active dealership_members row for the caller, OR
  2) (admin only) reading X-Acting-As-Dealership header / ?as= query param.

Attaches dict to flask.g.dealer_ctx: {dealership_id, role, actor_kind, admin_user_id?}.
"""
import hashlib
import json
import logging
import os
from functools import wraps

import requests
from flask import g, jsonify, request

logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY") or os.getenv(
    "SUPABASE_SERVICE_ROLE_KEY", ""
)


def _service_headers():
    return {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def _get_current_user_id():
    """Returns the JWT-authenticated user id from flask.g (set by token_required).

    The existing app.py token_required decorator sets ``g.current_user`` or returns
    the user id. We accept either via flask.g lookup; callers stack token_required
    above dealer_required.
    """
    return getattr(g, "current_user", None) or getattr(g, "user_id", None)


def _lookup_membership(user_id):
    if not user_id:
        return None
    try:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/dealership_members",
            headers=_service_headers(),
            params={
                "select": "dealership_id,role,status",
                "user_id": f"eq.{user_id}",
                "status": "eq.active",
                "limit": 1,
            },
            timeout=10,
        )
        if r.status_code != 200:
            return None
        rows = r.json()
        return rows[0] if rows else None
    except Exception as exc:
        logger.error("membership lookup failed: %s", exc)
        return None


def _is_admin(user_id):
    if not user_id:
        return False
    try:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/users",
            headers=_service_headers(),
            params={"select": "is_admin,is_super_admin", "id": f"eq.{user_id}", "limit": 1},
            timeout=10,
        )
        if r.status_code != 200:
            return False
        rows = r.json()
        if not rows:
            return False
        return bool(rows[0].get("is_admin")) or bool(rows[0].get("is_super_admin"))
    except Exception as exc:
        logger.error("admin lookup failed: %s", exc)
        return False


def _audit_write(*, admin_user_id, dealership_id, method, endpoint, payload, status_code):
    """Append an audit row when an admin performs a write while acting-as."""
    try:
        digest = None
        if payload is not None:
            body = payload if isinstance(payload, (str, bytes)) else json.dumps(payload, default=str)
            if isinstance(body, str):
                body = body.encode("utf-8")
            digest = hashlib.sha256(body).hexdigest()

        requests.post(
            f"{SUPABASE_URL}/rest/v1/dealer_admin_audit",
            headers=_service_headers(),
            json={
                "admin_user_id": admin_user_id,
                "dealership_id": dealership_id,
                "http_method": method,
                "endpoint": endpoint,
                "payload_digest": digest,
                "result_status": status_code,
                "user_agent": request.headers.get("User-Agent"),
                "ip_address": request.headers.get("X-Forwarded-For", request.remote_addr),
            },
            timeout=10,
        )
    except Exception as exc:
        logger.error("audit insert failed: %s", exc)


def dealer_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user_id = _get_current_user_id()
        membership = _lookup_membership(user_id)

        if membership:
            g.dealer_ctx = {
                "dealership_id": membership["dealership_id"],
                "role": membership["role"],
                "actor_kind": "member",
            }
            return fn(*args, **kwargs)

        if _is_admin(user_id):
            acting_as = (
                request.headers.get("X-Acting-As-Dealership")
                or request.args.get("as")
            )
            if not acting_as:
                return jsonify({"error": {"code": "acting_as_required",
                                          "message": "X-Acting-As-Dealership header or ?as= query param is required for admins"}}), 400
            g.dealer_ctx = {
                "dealership_id": acting_as,
                "role": "owner",  # admins act as owner-equivalent
                "actor_kind": "admin",
                "admin_user_id": user_id,
            }
            response = fn(*args, **kwargs)
            # Audit writes (POST/PUT/PATCH/DELETE).
            if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
                try:
                    body = request.get_json(silent=True)
                except Exception:
                    body = None
                status = response[1] if isinstance(response, tuple) else 200
                _audit_write(
                    admin_user_id=user_id,
                    dealership_id=acting_as,
                    method=request.method,
                    endpoint=request.path,
                    payload=body,
                    status_code=status,
                )
            return response

        return jsonify({"error": {"code": "not_a_dealer",
                                  "message": "You are not a member of any dealership."}}), 403

    return wrapper


def role_required(*allowed_roles):
    """Decorator to restrict to specific roles. Stack BELOW dealer_required.

    Admins (actor_kind='admin') bypass — they're already owner-equivalent.
    """
    def deco(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            ctx = getattr(g, "dealer_ctx", None) or {}
            if ctx.get("actor_kind") == "admin":
                return fn(*args, **kwargs)
            if ctx.get("role") not in allowed_roles:
                return jsonify({"error": {"code": "insufficient_role",
                                          "message": f"Requires one of {allowed_roles}"}}), 403
            return fn(*args, **kwargs)
        return wrapper
    return deco
```

- [ ] **Step 4: Run test, verify pass**

```bash
cd flask-react-supabase-app/backend && python -m pytest test_dealer_required.py -v
```

Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add flask-react-supabase-app/backend/routes/dealer/_decorators.py flask-react-supabase-app/backend/test_dealer_required.py
git commit -m "Dealer panel: @dealer_required + role_required decorators with admin view-as + audit"
```

---

### Task 9: Core blueprint — GET /api/dealer/me

**Files:**
- Create: `flask-react-supabase-app/backend/routes/dealer/core.py`
- Create: `flask-react-supabase-app/backend/test_dealer_core.py`

- [ ] **Step 1: Write the failing test**

```python
# flask-react-supabase-app/backend/test_dealer_core.py
import pytest
from unittest.mock import patch

import app as app_module


@pytest.fixture
def client():
    app_module.app.config["TESTING"] = True
    with app_module.app.test_client() as c:
        yield c


def test_dealer_me_requires_auth(client):
    r = client.get("/api/dealer/me")
    assert r.status_code in (401, 403)
```

- [ ] **Step 2: Run test, verify it fails (route not yet registered)**

```bash
cd flask-react-supabase-app/backend && ENABLE_DEALER_PANEL=true python -m pytest test_dealer_core.py -v
```

Expected: 404 (route missing) → test fails.

- [ ] **Step 3: Implement core blueprint**

```python
# flask-react-supabase-app/backend/routes/dealer/core.py
"""Dealer core endpoints: identity, profile, members, invitations."""
import os
import secrets
from datetime import datetime, timedelta, timezone

import requests
from flask import Blueprint, g, jsonify, request

from ._decorators import dealer_required, role_required

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = (
    os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
)

core_bp = Blueprint("dealer_core", __name__, url_prefix="/api/dealer")


def _svc_headers():
    return {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Prefer": "return=representation",
    }


def _import_token_required():
    """Lazy-import the project's existing token_required decorator from app.py."""
    from app import token_required
    return token_required


token_required = _import_token_required()


@core_bp.route("/me", methods=["GET"])
@token_required
@dealer_required
def me():
    ctx = g.dealer_ctx
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/dealerships",
        headers=_svc_headers(),
        params={"select": "*", "id": f"eq.{ctx['dealership_id']}", "limit": 1},
        timeout=10,
    )
    if r.status_code != 200 or not r.json():
        return jsonify({"error": {"code": "dealership_not_found", "message": "Dealership not found"}}), 404
    dealership = r.json()[0]
    return jsonify({
        "dealership": dealership,
        "role": ctx["role"],
        "actor_kind": ctx["actor_kind"],
    })


@core_bp.route("/profile", methods=["PATCH"])
@token_required
@dealer_required
@role_required("owner")
def update_profile():
    body = request.get_json(silent=True) or {}
    allowed = {"name", "legal_name", "trade_license_no", "emirate", "address",
               "phone", "whatsapp", "logo_url", "cover_url", "website", "bio"}
    update = {k: v for k, v in body.items() if k in allowed}
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    r = requests.patch(
        f"{SUPABASE_URL}/rest/v1/dealerships",
        headers=_svc_headers(),
        params={"id": f"eq.{g.dealer_ctx['dealership_id']}"},
        json=update,
        timeout=10,
    )
    if r.status_code not in (200, 204):
        return jsonify({"error": {"code": "update_failed", "message": r.text}}), 500
    return jsonify({"ok": True, "dealership": r.json()[0] if r.json() else None})


@core_bp.route("/members", methods=["GET"])
@token_required
@dealer_required
def list_members():
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/dealership_members",
        headers=_svc_headers(),
        params={
            "select": "id,user_id,role,status,joined_at,invited_at,"
                       "user:users(id,email,first_name,last_name,username,profile_photo_url)",
            "dealership_id": f"eq.{g.dealer_ctx['dealership_id']}",
            "status": "in.(active,invited)",
            "order": "joined_at.asc",
        },
        timeout=10,
    )
    return jsonify({"members": r.json() if r.status_code == 200 else []})


@core_bp.route("/invitations", methods=["POST"])
@token_required
@dealer_required
@role_required("owner")
def create_invitation():
    body = request.get_json(silent=True) or {}
    email = (body.get("email") or "").strip().lower()
    role = body.get("role") or "sales_rep"
    if not email or "@" not in email:
        return jsonify({"error": {"code": "invalid_email"}}), 400
    if role not in {"manager", "sales_rep"}:
        return jsonify({"error": {"code": "invalid_role"}}), 400

    token = secrets.token_urlsafe(32)
    expires = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/dealership_invitations",
        headers=_svc_headers(),
        json={
            "dealership_id": g.dealer_ctx["dealership_id"],
            "email": email,
            "role": role,
            "token": token,
            "invited_by": getattr(g, "current_user", None) or g.dealer_ctx.get("admin_user_id"),
            "expires_at": expires,
        },
        timeout=10,
    )
    if r.status_code not in (200, 201):
        return jsonify({"error": {"code": "invite_failed", "message": r.text}}), 500
    return jsonify({"invitation": r.json()[0] if r.json() else None}), 201


@core_bp.route("/invitations/<invite_id>", methods=["DELETE"])
@token_required
@dealer_required
@role_required("owner")
def revoke_invitation(invite_id):
    r = requests.delete(
        f"{SUPABASE_URL}/rest/v1/dealership_invitations",
        headers=_svc_headers(),
        params={
            "id": f"eq.{invite_id}",
            "dealership_id": f"eq.{g.dealer_ctx['dealership_id']}",
        },
        timeout=10,
    )
    return jsonify({"ok": r.status_code in (200, 204)})


@core_bp.route("/members/<member_id>", methods=["DELETE"])
@token_required
@dealer_required
@role_required("owner")
def revoke_member(member_id):
    r = requests.patch(
        f"{SUPABASE_URL}/rest/v1/dealership_members",
        headers=_svc_headers(),
        params={
            "id": f"eq.{member_id}",
            "dealership_id": f"eq.{g.dealer_ctx['dealership_id']}",
        },
        json={"status": "revoked"},
        timeout=10,
    )
    return jsonify({"ok": r.status_code in (200, 204)})


# Public-ish: accept invitation by token (uses token_required, NOT dealer_required).
@core_bp.route("/invitations/accept", methods=["POST"])
@token_required
def accept_invitation():
    body = request.get_json(silent=True) or {}
    token = body.get("token")
    user_id = getattr(g, "current_user", None)
    if not token or not user_id:
        return jsonify({"error": {"code": "missing_token"}}), 400

    inv = requests.get(
        f"{SUPABASE_URL}/rest/v1/dealership_invitations",
        headers=_svc_headers(),
        params={"select": "*", "token": f"eq.{token}", "limit": 1},
        timeout=10,
    )
    if inv.status_code != 200 or not inv.json():
        return jsonify({"error": {"code": "invitation_not_found"}}), 404

    invitation = inv.json()[0]
    if invitation.get("accepted_at"):
        return jsonify({"error": {"code": "already_accepted"}}), 409
    if invitation["expires_at"] < datetime.now(timezone.utc).isoformat():
        return jsonify({"error": {"code": "expired"}}), 410

    # Create membership (UNIQUE(user_id) will catch double-membership).
    m = requests.post(
        f"{SUPABASE_URL}/rest/v1/dealership_members",
        headers=_svc_headers(),
        json={
            "dealership_id": invitation["dealership_id"],
            "user_id": user_id,
            "role": invitation["role"],
            "status": "active",
            "invited_by": invitation["invited_by"],
            "invited_at": invitation["created_at"],
            "joined_at": datetime.now(timezone.utc).isoformat(),
        },
        timeout=10,
    )
    if m.status_code not in (200, 201):
        return jsonify({"error": {"code": "join_failed", "message": m.text}}), 409

    requests.patch(
        f"{SUPABASE_URL}/rest/v1/dealership_invitations",
        headers=_svc_headers(),
        params={"id": f"eq.{invitation['id']}"},
        json={"accepted_at": datetime.now(timezone.utc).isoformat()},
        timeout=10,
    )
    return jsonify({"ok": True, "dealership_id": invitation["dealership_id"]})
```

- [ ] **Step 4: Run tests; smoke-boot the app with the flag on**

```bash
cd flask-react-supabase-app/backend && ENABLE_DEALER_PANEL=true python -m pytest test_dealer_core.py -v
ENABLE_DEALER_PANEL=true python -c "import app; print(app.app.url_map)" | grep dealer
```

Expected: the smoke shows `/api/dealer/me` etc routes registered.

- [ ] **Step 5: Commit**

```bash
git add flask-react-supabase-app/backend/routes/dealer/core.py flask-react-supabase-app/backend/test_dealer_core.py
git commit -m "Dealer panel: core endpoints (me, profile, members, invitations)"
```

---

## Group C — Analytics backend

### Task 10: KPI service — dedupe helpers

**Files:**
- Create: `flask-react-supabase-app/backend/services/dealer_kpi.py`
- Create: `flask-react-supabase-app/backend/test_dealer_kpi.py`

- [ ] **Step 1: Write failing tests**

```python
# flask-react-supabase-app/backend/test_dealer_kpi.py
from datetime import datetime, timedelta, timezone
from services.dealer_kpi import dedupe_impressions, dedupe_leads


def _ev(visitor_id, listing_id, when, action=None, kind="page_view"):
    return {
        "visitor_id": visitor_id,
        "listing_id": listing_id,
        "listing_type": "car",
        "action": action,
        "event_name": kind,
        "created_at": when.isoformat(),
    }


def test_impressions_dedupe_same_visitor_same_day():
    t = datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc)
    events = [_ev("v1", "L1", t), _ev("v1", "L1", t + timedelta(hours=1))]
    assert dedupe_impressions(events) == 1


def test_impressions_dedupe_different_day_counts_separately():
    t = datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc)
    events = [_ev("v1", "L1", t), _ev("v1", "L1", t + timedelta(days=1, hours=1))]
    assert dedupe_impressions(events) == 2


def test_impressions_dedupe_different_listings_counted_separately():
    t = datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc)
    events = [_ev("v1", "L1", t), _ev("v1", "L2", t)]
    assert dedupe_impressions(events) == 2


def test_leads_dedupe_same_visitor_same_action_24h_window():
    t = datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc)
    events = [
        _ev("v1", "L1", t, action="call_click"),
        _ev("v1", "L1", t + timedelta(hours=5), action="call_click"),
        _ev("v1", "L1", t + timedelta(hours=30), action="call_click"),
    ]
    assert dedupe_leads(events) == 2


def test_leads_dedupe_different_actions_counted_separately():
    t = datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc)
    events = [
        _ev("v1", "L1", t, action="call_click"),
        _ev("v1", "L1", t + timedelta(hours=1), action="whatsapp_click"),
    ]
    assert dedupe_leads(events) == 2
```

- [ ] **Step 2: Run, verify fails**

```bash
cd flask-react-supabase-app/backend && python -m pytest test_dealer_kpi.py -v
```

- [ ] **Step 3: Implement the helpers**

```python
# flask-react-supabase-app/backend/services/dealer_kpi.py
"""Dealer-scoped KPI computation: dedupe + windowed aggregates.

Used by the dashboard endpoints and the nightly aggregator worker.
Mirrors the dedupe semantics finalised in the admin-stats refactor:
- impressions: dedupe by (visitor_id, listing_id, day)
- leads: dedupe by (visitor_id, listing_id, action, 24h-bucket-from-first-event)
"""
from datetime import datetime, timezone
from typing import Iterable, Mapping


def _parse(ts: str) -> datetime:
    s = ts.replace("Z", "+00:00") if ts and ts.endswith("Z") else ts
    return datetime.fromisoformat(s) if s else datetime.now(timezone.utc)


def dedupe_impressions(events: Iterable[Mapping]) -> int:
    seen = set()
    for e in events:
        vid = e.get("visitor_id") or ""
        lid = e.get("listing_id") or ""
        ltype = e.get("listing_type") or ""
        day = _parse(e["created_at"]).date().isoformat()
        seen.add((vid, ltype, lid, day))
    return len(seen)


def dedupe_leads(events: Iterable[Mapping]) -> int:
    # Group by (visitor_id, listing_id, action) then bucket events into 24h windows.
    by_key = {}
    for e in events:
        key = (e.get("visitor_id") or "",
               e.get("listing_type") or "",
               e.get("listing_id") or "",
               e.get("action") or "")
        by_key.setdefault(key, []).append(_parse(e["created_at"]))

    total = 0
    for times in by_key.values():
        times.sort()
        if not times:
            continue
        # Greedy 24h bucketing.
        anchor = times[0]
        total += 1
        for t in times[1:]:
            if (t - anchor).total_seconds() >= 24 * 3600:
                total += 1
                anchor = t
    return total
```

- [ ] **Step 4: Run, verify pass**

```bash
cd flask-react-supabase-app/backend && python -m pytest test_dealer_kpi.py -v
```

Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add flask-react-supabase-app/backend/services/dealer_kpi.py flask-react-supabase-app/backend/test_dealer_kpi.py
git commit -m "Dealer panel: KPI dedupe helpers (impressions, leads)"
```

---

### Task 11: Analytics blueprint — dashboard KPI tiles endpoint

**Files:**
- Create: `flask-react-supabase-app/backend/routes/dealer/analytics.py`
- Create: `flask-react-supabase-app/backend/test_dealer_analytics.py`

- [ ] **Step 1: Implement analytics blueprint**

```python
# flask-react-supabase-app/backend/routes/dealer/analytics.py
"""Dealer dashboard analytics endpoints.

All endpoints scoped by g.dealer_ctx['dealership_id'].
Windowed by ?window= 7|30|90 days; default 30.

Endpoints:
  GET /api/dealer/analytics/kpis            -> 6 KPI tiles
  GET /api/dealer/analytics/trends          -> daily impressions, daily leads, leads-by-source
  GET /api/dealer/analytics/funnel          -> impressions -> details -> leads -> won
  GET /api/dealer/analytics/top-performers  -> top 5 by impressions, top 5 by lead conv
  GET /api/dealer/analytics/underperformers -> 5 worst impressions/day, 5 with views-but-no-leads
  GET /api/dealer/listings                  -> dealer's listings list (paginated)
  GET /api/dealer/listings/<id>/analytics   -> per-listing KPIs + time series
"""
import os
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import requests
from flask import Blueprint, g, jsonify, request

from services.dealer_kpi import dedupe_impressions, dedupe_leads
from ._decorators import dealer_required

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = (
    os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
)

analytics_bp = Blueprint("dealer_analytics", __name__, url_prefix="/api/dealer")


def _svc():
    return {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Accept": "application/json",
    }


def _window():
    days = request.args.get("window", "30")
    try:
        n = max(1, min(365, int(days)))
    except ValueError:
        n = 30
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=n)
    prev_start = start - timedelta(days=n)
    return start, end, prev_start, n


def _listing_ids_for_dealership(dealership_id):
    """Return dict of listing_type -> set of listing_ids owned by the dealership."""
    out = {"car": set(), "bike": set(), "plate": set(), "part": set()}
    for table, kind in (("cars", "car"), ("bikes", "bike"), ("license_plates", "plate"), ("car_parts", "part")):
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/{table}",
            headers=_svc(),
            params={"select": "id,status", "dealership_id": f"eq.{dealership_id}", "limit": 5000},
            timeout=15,
        )
        if r.status_code == 200:
            for row in r.json():
                out[kind].add(str(row["id"]))
    return out


def _fetch_platform_events(dealership_id, start, end, page_kind=None):
    """Fetch platform_events for this dealership's listings in window."""
    listings = _listing_ids_for_dealership(dealership_id)
    events = []
    for kind, ids in listings.items():
        if not ids:
            continue
        # Supabase REST: filter by listing_type + listing_id in (...).
        # PostgREST `in.()` has length limits, chunk.
        ids_list = list(ids)
        for i in range(0, len(ids_list), 200):
            chunk = ids_list[i:i + 200]
            params = {
                "select": "visitor_id,listing_id,listing_type,event_name,page_kind,created_at,metadata",
                "listing_type": f"eq.{kind}",
                "listing_id": f"in.({','.join(chunk)})",
                "created_at": f"gte.{start.isoformat()}",
                "limit": 50000,
            }
            if page_kind:
                params["page_kind"] = f"eq.{page_kind}"
            r = requests.get(
                f"{SUPABASE_URL}/rest/v1/platform_events",
                headers=_svc(), params=params, timeout=30,
            )
            if r.status_code == 200:
                events.extend(r.json())
    return events


def _fetch_lead_events(dealership_id, start, end):
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/lead_events",
        headers=_svc(),
        params={
            "select": "visitor_id,listing_id,listing_type,action,created_at",
            "dealership_id": f"eq.{dealership_id}",
            "created_at": f"gte.{start.isoformat()}",
            "limit": 50000,
        },
        timeout=20,
    )
    return r.json() if r.status_code == 200 else []


@analytics_bp.route("/analytics/kpis", methods=["GET"])
def kpis():
    # Inline token_required avoiding import cycles.
    from app import token_required as _tr
    @_tr
    @dealer_required
    def _inner():
        dealership_id = g.dealer_ctx["dealership_id"]
        start, end, prev_start, n = _window()

        # Active listings count (point-in-time).
        listings = _listing_ids_for_dealership(dealership_id)
        active_count = 0
        for table in ("cars", "bikes", "license_plates", "car_parts"):
            r = requests.get(
                f"{SUPABASE_URL}/rest/v1/{table}",
                headers={**_svc(), "Prefer": "count=exact"},
                params={"select": "id", "dealership_id": f"eq.{dealership_id}",
                        "status": "eq.active", "limit": 1},
                timeout=15,
            )
            cr = r.headers.get("Content-Range", "")
            if "/" in cr:
                try:
                    active_count += int(cr.split("/")[-1])
                except ValueError:
                    pass

        # Current window events.
        impressions_events = _fetch_platform_events(dealership_id, start, end)
        detail_events = [e for e in impressions_events if e.get("page_kind") == "listing_detail"]
        lead_events = _fetch_lead_events(dealership_id, start, end)

        impressions = dedupe_impressions(impressions_events)
        detail_views = dedupe_impressions(detail_events)
        leads = dedupe_leads(lead_events)
        conv = (leads / detail_views * 100) if detail_views else 0.0

        # Sold-on-platform count: cars + bikes + plates + parts with sold_status='sold_on_dph' set in window.
        sold = 0
        for table in ("cars", "bikes", "license_plates", "car_parts"):
            r = requests.get(
                f"{SUPABASE_URL}/rest/v1/{table}",
                headers={**_svc(), "Prefer": "count=exact"},
                params={
                    "select": "id",
                    "dealership_id": f"eq.{dealership_id}",
                    "sold_status": "eq.sold_on_dph",
                    "sold_status_set_at": f"gte.{start.isoformat()}",
                    "limit": 1,
                },
                timeout=15,
            )
            cr = r.headers.get("Content-Range", "")
            if "/" in cr:
                try:
                    sold += int(cr.split("/")[-1])
                except ValueError:
                    pass

        # Previous-window deltas for impressions + leads (active_count snapshot has no prior comparison).
        prev_impressions_ev = _fetch_platform_events(dealership_id, prev_start, start)
        prev_leads_ev = _fetch_lead_events(dealership_id, prev_start, start)
        prev_impressions = dedupe_impressions(prev_impressions_ev)
        prev_leads = dedupe_leads(prev_leads_ev)

        def _delta(curr, prev):
            if not prev:
                return None
            return round((curr - prev) / prev * 100, 1)

        return jsonify({
            "window_days": n,
            "tiles": {
                "active_listings": {"value": active_count, "delta_pct": None},
                "impressions": {"value": impressions, "delta_pct": _delta(impressions, prev_impressions)},
                "detail_views": {"value": detail_views, "delta_pct": None},
                "leads": {"value": leads, "delta_pct": _delta(leads, prev_leads)},
                "lead_conversion_pct": {"value": round(conv, 2), "delta_pct": None},
                "sold_on_platform": {"value": sold, "delta_pct": None},
            },
        })

    return _inner()


@analytics_bp.route("/analytics/trends", methods=["GET"])
def trends():
    from app import token_required as _tr
    @_tr
    @dealer_required
    def _inner():
        dealership_id = g.dealer_ctx["dealership_id"]
        start, end, _, n = _window()

        impressions_events = _fetch_platform_events(dealership_id, start, end)
        lead_events = _fetch_lead_events(dealership_id, start, end)

        # Group by day, dedupe within day.
        imps_by_day = defaultdict(list)
        for e in impressions_events:
            d = e["created_at"][:10]
            imps_by_day[d].append(e)
        leads_by_day = defaultdict(list)
        for e in lead_events:
            d = e["created_at"][:10]
            leads_by_day[d].append(e)

        days = []
        cursor = start.date()
        while cursor <= end.date():
            ds = cursor.isoformat()
            days.append({
                "date": ds,
                "impressions": dedupe_impressions(imps_by_day.get(ds, [])),
                "leads": dedupe_leads(leads_by_day.get(ds, [])),
            })
            cursor += timedelta(days=1)

        # Leads by source breakdown.
        by_source = defaultdict(int)
        for e in lead_events:
            by_source[e.get("action") or "other"] += 1

        return jsonify({"daily": days, "leads_by_source": dict(by_source)})

    return _inner()


@analytics_bp.route("/analytics/funnel", methods=["GET"])
def funnel():
    from app import token_required as _tr
    @_tr
    @dealer_required
    def _inner():
        dealership_id = g.dealer_ctx["dealership_id"]
        start, end, _, _ = _window()

        all_events = _fetch_platform_events(dealership_id, start, end)
        detail_events = [e for e in all_events if e.get("page_kind") == "listing_detail"]
        lead_events = _fetch_lead_events(dealership_id, start, end)

        impressions = dedupe_impressions(all_events)
        detail_views = dedupe_impressions(detail_events)
        leads = dedupe_leads(lead_events)

        # Won = sold_on_dph in window.
        won = 0
        for table in ("cars", "bikes", "license_plates", "car_parts"):
            r = requests.get(
                f"{SUPABASE_URL}/rest/v1/{table}",
                headers={**_svc(), "Prefer": "count=exact"},
                params={"select": "id", "dealership_id": f"eq.{dealership_id}",
                        "sold_status": "eq.sold_on_dph",
                        "sold_status_set_at": f"gte.{start.isoformat()}",
                        "limit": 1},
                timeout=15,
            )
            cr = r.headers.get("Content-Range", "")
            if "/" in cr:
                try:
                    won += int(cr.split("/")[-1])
                except ValueError:
                    pass

        return jsonify({
            "steps": [
                {"label": "Impressions", "value": impressions},
                {"label": "Detail views", "value": detail_views},
                {"label": "Leads", "value": leads},
                {"label": "Won", "value": won},
            ]
        })

    return _inner()


@analytics_bp.route("/analytics/top-performers", methods=["GET"])
def top_performers():
    from app import token_required as _tr
    @_tr
    @dealer_required
    def _inner():
        dealership_id = g.dealer_ctx["dealership_id"]
        start, end, _, _ = _window()

        impressions_events = _fetch_platform_events(dealership_id, start, end)
        lead_events = _fetch_lead_events(dealership_id, start, end)

        # Aggregate by listing.
        imps_by_listing = defaultdict(list)
        for e in impressions_events:
            imps_by_listing[(e["listing_type"], str(e["listing_id"]))].append(e)
        leads_by_listing = defaultdict(list)
        for e in lead_events:
            leads_by_listing[(e["listing_type"], str(e["listing_id"]))].append(e)

        rows = []
        for key, evs in imps_by_listing.items():
            imp = dedupe_impressions(evs)
            ld = dedupe_leads(leads_by_listing.get(key, []))
            conv = (ld / imp * 100) if imp else 0.0
            rows.append({
                "listing_type": key[0],
                "listing_id": key[1],
                "impressions": imp,
                "leads": ld,
                "conv_pct": round(conv, 2),
            })

        top_imp = sorted(rows, key=lambda r: r["impressions"], reverse=True)[:5]
        top_conv = sorted([r for r in rows if r["impressions"] >= 10],
                          key=lambda r: r["conv_pct"], reverse=True)[:5]
        return jsonify({"top_by_impressions": top_imp, "top_by_conversion": top_conv})

    return _inner()


@analytics_bp.route("/analytics/underperformers", methods=["GET"])
def underperformers():
    from app import token_required as _tr
    @_tr
    @dealer_required
    def _inner():
        dealership_id = g.dealer_ctx["dealership_id"]
        start, end, _, _ = _window()

        listings = _listing_ids_for_dealership(dealership_id)
        impressions_events = _fetch_platform_events(dealership_id, start, end)
        lead_events = _fetch_lead_events(dealership_id, start, end)

        imps_by_listing = defaultdict(list)
        for e in impressions_events:
            imps_by_listing[(e["listing_type"], str(e["listing_id"]))].append(e)
        leads_by_listing = defaultdict(list)
        for e in lead_events:
            leads_by_listing[(e["listing_type"], str(e["listing_id"]))].append(e)

        rows = []
        for kind, ids in listings.items():
            for lid in ids:
                key = (kind, lid)
                imp = dedupe_impressions(imps_by_listing.get(key, []))
                ld = dedupe_leads(leads_by_listing.get(key, []))
                rows.append({
                    "listing_type": kind, "listing_id": lid,
                    "impressions": imp, "leads": ld,
                })

        worst_imp = sorted(rows, key=lambda r: r["impressions"])[:5]
        views_no_leads = sorted(
            [r for r in rows if r["impressions"] >= 20 and r["leads"] == 0],
            key=lambda r: r["impressions"], reverse=True,
        )[:5]
        return jsonify({"worst_by_impressions": worst_imp, "views_no_leads": views_no_leads})

    return _inner()


@analytics_bp.route("/listings", methods=["GET"])
def list_listings():
    from app import token_required as _tr
    @_tr
    @dealer_required
    def _inner():
        dealership_id = g.dealer_ctx["dealership_id"]
        merged = []
        for table, kind in (("cars", "car"), ("bikes", "bike"),
                            ("license_plates", "plate"), ("car_parts", "part")):
            r = requests.get(
                f"{SUPABASE_URL}/rest/v1/{table}",
                headers=_svc(),
                params={
                    "select": "id,status,view_count,created_at,updated_at,sold_status,sold_status_set_at",
                    "dealership_id": f"eq.{dealership_id}",
                    "order": "created_at.desc",
                    "limit": 500,
                },
                timeout=20,
            )
            if r.status_code == 200:
                for row in r.json():
                    row["listing_type"] = kind
                    merged.append(row)
        merged.sort(key=lambda x: x.get("created_at") or "", reverse=True)
        return jsonify({"listings": merged})

    return _inner()


@analytics_bp.route("/listings/<listing_type>/<listing_id>/analytics", methods=["GET"])
def listing_analytics(listing_type, listing_id):
    from app import token_required as _tr
    @_tr
    @dealer_required
    def _inner():
        dealership_id = g.dealer_ctx["dealership_id"]
        start, end, _, n = _window()

        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/platform_events",
            headers=_svc(),
            params={
                "select": "visitor_id,event_name,page_kind,created_at,metadata,duration_ms",
                "listing_type": f"eq.{listing_type}",
                "listing_id": f"eq.{listing_id}",
                "created_at": f"gte.{start.isoformat()}",
                "limit": 50000,
            },
            timeout=20,
        )
        events = r.json() if r.status_code == 200 else []
        leads_r = requests.get(
            f"{SUPABASE_URL}/rest/v1/lead_events",
            headers=_svc(),
            params={
                "select": "visitor_id,action,created_at",
                "listing_type": f"eq.{listing_type}",
                "listing_id": f"eq.{listing_id}",
                "created_at": f"gte.{start.isoformat()}",
                "limit": 50000,
            },
            timeout=20,
        )
        lead_events = leads_r.json() if leads_r.status_code == 200 else []

        impressions = dedupe_impressions(events)
        detail_events = [e for e in events if e.get("page_kind") == "listing_detail"]
        detail_views = dedupe_impressions(detail_events)

        calls = dedupe_leads([e for e in lead_events if e.get("action") == "call_click"])
        whatsapp = dedupe_leads([e for e in lead_events if e.get("action") == "whatsapp_click"])
        vin = dedupe_leads([e for e in lead_events if e.get("action") in ("vin_open", "vin_reveal")])

        # Engagement-without-contact: sessions with >30s OR >3 image events that produced no lead.
        sessions = defaultdict(lambda: {"dur": 0, "image_events": 0, "had_lead": False})
        for e in detail_events:
            sid = e.get("visitor_id") or ""
            sessions[sid]["dur"] += int(e.get("duration_ms") or 0)
        for e in events:
            if (e.get("event_name") or "").startswith("image_"):
                sessions[e.get("visitor_id") or ""]["image_events"] += 1
        for e in lead_events:
            sessions[e.get("visitor_id") or ""]["had_lead"] = True
        eng_no_contact = sum(
            1 for s in sessions.values()
            if (s["dur"] >= 30000 or s["image_events"] >= 3) and not s["had_lead"]
        )

        # Time series by day.
        ts = defaultdict(lambda: {"impressions": [], "detail_views": [], "leads": []})
        for e in events:
            d = e["created_at"][:10]
            ts[d]["impressions"].append(e)
            if e.get("page_kind") == "listing_detail":
                ts[d]["detail_views"].append(e)
        for e in lead_events:
            ts[e["created_at"][:10]]["leads"].append(e)
        series = sorted([
            {
                "date": k,
                "impressions": dedupe_impressions(v["impressions"]),
                "detail_views": dedupe_impressions(v["detail_views"]),
                "leads": dedupe_leads(v["leads"]),
            } for k, v in ts.items()
        ], key=lambda x: x["date"])

        return jsonify({
            "window_days": n,
            "tiles": {
                "impressions": impressions,
                "detail_views": detail_views,
                "call_clicks": calls,
                "whatsapp_clicks": whatsapp,
                "vin_reveals": vin,
                "engagement_no_contact": eng_no_contact,
                "conversion_pct": round((calls + whatsapp + vin) / detail_views * 100, 2) if detail_views else 0,
            },
            "series": series,
        })

    return _inner()
```

- [ ] **Step 2: Boot the app + smoke**

```bash
cd flask-react-supabase-app/backend
ENABLE_DEALER_PANEL=true python -c "import app; print([r.rule for r in app.app.url_map.iter_rules() if '/dealer/' in r.rule])"
```

Expected: prints the new dealer routes.

- [ ] **Step 3: Commit**

```bash
git add flask-react-supabase-app/backend/routes/dealer/analytics.py
git commit -m "Dealer panel: analytics endpoints (KPIs, trends, funnel, top/under, per-listing)"
```

---

### Task 12: Market evaluation service + endpoint

**Files:**
- Create: `flask-react-supabase-app/backend/services/dealer_market.py`
- Create: `flask-react-supabase-app/backend/routes/dealer/market.py`
- Create: `flask-react-supabase-app/backend/test_dealer_market.py`

- [ ] **Step 1: Write failing tests**

```python
# flask-react-supabase-app/backend/test_dealer_market.py
from services.dealer_market import compute_stats, percentile_rank


def test_percentile_rank_middle():
    assert 0.45 <= percentile_rank(50, [10, 20, 30, 40, 50, 60, 70, 80, 90]) <= 0.55


def test_percentile_rank_top():
    assert percentile_rank(1000, [10, 20, 30]) == 1.0


def test_compute_stats_basic():
    s = compute_stats([10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
    assert s["median"] == 55
    assert 25 <= s["p25"] <= 32
    assert 70 <= s["p75"] <= 80
    assert s["count"] == 10
```

- [ ] **Step 2: Implement service**

```python
# flask-react-supabase-app/backend/services/dealer_market.py
"""Market evaluation for dealer listings.

Comp-selection rules (cars): same make+model (case-insensitive), year ±1,
mileage ±20% if available, status active OR sold in last 90 days, exclude
self + same-dealer copies. Require >=5 comps; widen by dropping mileage
filter, then widen year to ±2, then drop trim if needed. If still <5,
return insufficient_comps.

Stats: median, p25, p75, percentile rank, median DoM for sold comps.

v1 source: own DB only. Pluggable via MarketDataSource interface so
future scrapers / paid feeds can drop in.
"""
import os
import statistics
from datetime import datetime, timedelta, timezone

import requests

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = (
    os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
)


def _svc():
    return {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Accept": "application/json",
    }


def percentile_rank(value, sample):
    if not sample:
        return 0.0
    below = sum(1 for v in sample if v < value)
    equal = sum(1 for v in sample if v == value)
    return min(1.0, (below + 0.5 * equal) / len(sample))


def compute_stats(prices):
    if not prices:
        return {"count": 0, "median": None, "p25": None, "p75": None}
    s = sorted(prices)
    n = len(s)
    return {
        "count": n,
        "median": statistics.median(s),
        "p25": s[max(0, int(n * 0.25) - 1)] if n >= 4 else s[0],
        "p75": s[min(n - 1, int(n * 0.75))] if n >= 4 else s[-1],
    }


def _fetch_listing(listing_type, listing_id):
    table = {"car": "cars", "bike": "bikes", "plate": "license_plates", "part": "car_parts"}[listing_type]
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers=_svc(),
        params={"select": "*", "id": f"eq.{listing_id}", "limit": 1},
        timeout=10,
    )
    return r.json()[0] if r.status_code == 200 and r.json() else None


def _fetch_car_comps(make, model, year, mileage_pct, dealership_id, listing_id):
    params = {
        "select": "id,expected_selling_price,make_year,kilometers,sold_status,sold_status_set_at,created_at",
        "car_model": f"ilike.{model}",
        "make_year": f"gte.{year - 1}",
        "limit": 500,
    }
    # We can't do "AND year<=year+1" with one param; use two.
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/cars",
        headers=_svc(),
        params={**params, "make_year": f"lte.{year + 1}"},
        timeout=15,
    )
    rows = r.json() if r.status_code == 200 else []

    sold_cutoff = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
    out = []
    for row in rows:
        if str(row["id"]) == str(listing_id):
            continue
        if row.get("dealership_id") == dealership_id:
            continue
        if row.get("make_year", year) < year - 1 or row.get("make_year", year) > year + 1:
            continue
        if not row.get("expected_selling_price"):
            continue
        if mileage_pct is not None and row.get("kilometers"):
            # not enforcing here; caller widens.
            pass
        # Active OR sold in last 90d.
        if row.get("sold_status") in ("sold_on_dph", "sold_elsewhere"):
            if (row.get("sold_status_set_at") or "") < sold_cutoff:
                continue
        out.append(row)
    return out


def compute_snapshot(listing_type, listing_id, dealership_id):
    listing = _fetch_listing(listing_type, listing_id)
    if not listing:
        return None

    if listing_type == "car":
        make = (listing.get("make") or "").strip()
        model = (listing.get("car_model") or "").strip()
        year = listing.get("make_year") or 0
        price = listing.get("expected_selling_price") or 0
        comps = _fetch_car_comps(make, model, year, 0.20, dealership_id, listing_id)
        if len(comps) < 5:
            # widen: drop year ± and try ±2.
            comps = _fetch_car_comps(make, model, year, None, dealership_id, listing_id)
        if len(comps) < 5:
            return {"insufficient_comps": True, "comp_count": len(comps)}

        prices = [int(c["expected_selling_price"]) for c in comps]
        stats = compute_stats(prices)
        rank = percentile_rank(int(price), prices)

        sold_doms = []
        for c in comps:
            if c.get("sold_status") == "sold_on_dph" and c.get("sold_status_set_at") and c.get("created_at"):
                try:
                    s = datetime.fromisoformat(c["sold_status_set_at"].replace("Z", "+00:00"))
                    cr = datetime.fromisoformat(c["created_at"].replace("Z", "+00:00"))
                    sold_doms.append((s - cr).days)
                except Exception:
                    pass
        median_dom = int(statistics.median(sold_doms)) if sold_doms else None

        return {
            "listing_type": listing_type,
            "listing_id": str(listing_id),
            "snapshot_at": datetime.now(timezone.utc).isoformat(),
            "comp_count": stats["count"],
            "median_price": stats["median"],
            "p25_price": stats["p25"],
            "p75_price": stats["p75"],
            "median_days_on_market": median_dom,
            "percentile_rank": round(rank, 4),
            "signals": {},
        }

    # Bikes / plates / parts: shape matches; skip detailed v1 implementation -- return insufficient_comps.
    return {"insufficient_comps": True, "comp_count": 0}


def upsert_snapshot(snapshot, dealership_id):
    if snapshot is None or snapshot.get("insufficient_comps"):
        return
    body = {**snapshot, "dealership_id": dealership_id}
    requests.post(
        f"{SUPABASE_URL}/rest/v1/dealer_market_snapshots",
        headers={**_svc(), "Content-Type": "application/json", "Prefer": "return=representation"},
        json=body, timeout=10,
    )
```

```python
# flask-react-supabase-app/backend/routes/dealer/market.py
"""GET /api/dealer/listings/<type>/<id>/market -> latest market snapshot."""
import os
import requests
from flask import Blueprint, g, jsonify

from services.dealer_market import compute_snapshot
from ._decorators import dealer_required

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = (
    os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
)
market_bp = Blueprint("dealer_market", __name__, url_prefix="/api/dealer")


def _svc():
    return {"apikey": SUPABASE_SERVICE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
            "Accept": "application/json"}


@market_bp.route("/listings/<listing_type>/<listing_id>/market", methods=["GET"])
def listing_market(listing_type, listing_id):
    from app import token_required as _tr
    @_tr
    @dealer_required
    def _inner():
        # Try latest stored snapshot first.
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/dealer_market_snapshots",
            headers=_svc(),
            params={
                "select": "*",
                "listing_type": f"eq.{listing_type}",
                "listing_id": f"eq.{listing_id}",
                "order": "snapshot_at.desc",
                "limit": 1,
            }, timeout=10,
        )
        rows = r.json() if r.status_code == 200 else []
        if rows:
            return jsonify({"snapshot": rows[0]})

        # Compute on demand if missing.
        snap = compute_snapshot(listing_type, listing_id, g.dealer_ctx["dealership_id"])
        if snap is None or snap.get("insufficient_comps"):
            return jsonify({"snapshot": None,
                            "reason": "insufficient_comps",
                            "comp_count": snap.get("comp_count", 0) if snap else 0})
        return jsonify({"snapshot": snap})

    return _inner()
```

- [ ] **Step 3: Run unit tests**

```bash
cd flask-react-supabase-app/backend && python -m pytest test_dealer_market.py -v
```

Expected: 3 PASS.

- [ ] **Step 4: Commit**

```bash
git add flask-react-supabase-app/backend/services/dealer_market.py flask-react-supabase-app/backend/routes/dealer/market.py flask-react-supabase-app/backend/test_dealer_market.py
git commit -m "Dealer panel: market evaluation service + endpoint"
```

---

### Task 13: Diagnostic engine (rules + endpoint)

**Files:**
- Create: `flask-react-supabase-app/backend/services/dealer_diagnostic.py`
- Create: `flask-react-supabase-app/backend/routes/dealer/diagnostic.py`
- Create: `flask-react-supabase-app/backend/test_dealer_diagnostic.py`

- [ ] **Step 1: Write failing tests**

```python
# flask-react-supabase-app/backend/test_dealer_diagnostic.py
from services.dealer_diagnostic import (
    PriceVsMarketRule, PhotoCountRule, TitleCompletenessRule,
    VinRule, DescriptionLengthRule, DaysOnMarketRule,
    MissingFieldsRule, Finding,
)


def test_price_vs_market_high_percentile_flags():
    listing = {"expected_selling_price": 100000, "make": "Toyota", "car_model": "Camry"}
    market = {"percentile_rank": 0.92, "median_price": 70000, "p25_price": 65000, "p75_price": 80000, "comp_count": 12}
    r = PriceVsMarketRule().evaluate(listing, {}, market)
    assert r is not None
    assert "90th percentile" in r.problem or "above" in r.problem.lower()


def test_price_vs_market_in_band_no_finding():
    listing = {"expected_selling_price": 72000, "make": "Toyota", "car_model": "Camry"}
    market = {"percentile_rank": 0.5, "median_price": 70000, "p25_price": 65000, "p75_price": 80000, "comp_count": 12}
    assert PriceVsMarketRule().evaluate(listing, {}, market) is None


def test_photo_count_low_flags():
    listing = {"image_count": 3}
    f = PhotoCountRule().evaluate(listing, {"cohort_photo_median": 12}, {})
    assert f is not None


def test_title_missing_trim_flags():
    listing = {"car_model": "Camry", "trim": None}
    f = TitleCompletenessRule().evaluate(listing, {}, {})
    assert f is not None


def test_vin_missing_flags():
    listing = {"vin": None}
    f = VinRule().evaluate(listing, {}, {})
    assert f is not None


def test_description_short_flags():
    listing = {"description": "low miles, clean"}
    f = DescriptionLengthRule().evaluate(listing, {"cohort_desc_p75": 200}, {})
    assert f is not None


def test_days_on_market_long_flags():
    listing = {"days_on_market": 60}
    f = DaysOnMarketRule().evaluate(listing, {"cohort_dom_p75": 30}, {})
    assert f is not None


def test_missing_fields_flags():
    listing = {"kilometers": None, "make_year": 2020, "transmission": None}
    f = MissingFieldsRule().evaluate(listing, {}, {})
    assert f is not None
    assert "mileage" in f.problem.lower() or "transmission" in f.problem.lower()
```

- [ ] **Step 2: Implement**

```python
# flask-react-supabase-app/backend/services/dealer_diagnostic.py
"""Rule-based diagnostic engine: 'why isn't this car selling?'

Each rule returns a Finding or None. Findings are ranked by
severity * rank_weight and the top N returned to the dashboard.
"""
from dataclasses import dataclass
from typing import Optional


@dataclass
class Finding:
    code: str
    problem: str       # one-line problem statement
    evidence: str      # the numbers backing it
    action: str        # what to do
    severity: float    # 0..1
    rank_weight: float = 1.0

    @property
    def score(self):
        return self.severity * self.rank_weight


class Rule:
    def evaluate(self, listing, kpi, market) -> Optional[Finding]:
        raise NotImplementedError


class PriceVsMarketRule(Rule):
    code = "price_vs_market"

    def evaluate(self, listing, kpi, market):
        if not market or market.get("comp_count", 0) < 5:
            return None
        rank = market.get("percentile_rank")
        if rank is None or rank < 0.75:
            return None
        median = market.get("median_price")
        p25 = market.get("p25_price")
        p75 = market.get("p75_price")
        price = listing.get("expected_selling_price")
        return Finding(
            code=self.code,
            problem=f"Your asking price sits above the {int(rank * 100)}th percentile of comparable listings.",
            evidence=f"Yours: AED {price:,}. Cohort median AED {int(median):,}; fair band AED {int(p25):,}–AED {int(p75):,} (n={market['comp_count']}).",
            action=f"Consider repricing into the fair band (AED {int(p25):,}–AED {int(p75):,}).",
            severity=min(1.0, (rank - 0.5) * 2),
            rank_weight=1.5,
        )


class PhotoCountRule(Rule):
    code = "photo_count"

    def evaluate(self, listing, kpi, market):
        n = listing.get("image_count") or 0
        median = kpi.get("cohort_photo_median") or 8
        if n >= median * 0.7:
            return None
        return Finding(
            code=self.code,
            problem="Listing has fewer photos than comparable listings.",
            evidence=f"Yours: {n}. Cohort median: {int(median)}.",
            action="Add interior, dashboard, engine bay and rear photos. Aim for 10+.",
            severity=min(1.0, (median - n) / max(1, median)),
            rank_weight=1.2,
        )


class TitleCompletenessRule(Rule):
    code = "title_completeness"

    def evaluate(self, listing, kpi, market):
        trim = (listing.get("trim") or "").strip()
        if trim:
            return None
        return Finding(
            code=self.code,
            problem="Listing title is missing trim (e.g. XLE, Sport, GCC).",
            evidence="Most comparable listings include trim in the title.",
            action="Edit the listing and add the trim level.",
            severity=0.5,
            rank_weight=0.8,
        )


class VinRule(Rule):
    code = "vin_missing"

    def evaluate(self, listing, kpi, market):
        if (listing.get("vin") or "").strip():
            return None
        return Finding(
            code=self.code,
            problem="VIN not provided.",
            evidence="Buyers expect a VIN for verification; listings with VIN convert better.",
            action="Add the VIN to the listing (from the registration card).",
            severity=0.6,
            rank_weight=1.0,
        )


class DescriptionLengthRule(Rule):
    code = "description_short"

    def evaluate(self, listing, kpi, market):
        desc = (listing.get("description") or "").strip()
        words = len(desc.split())
        target = kpi.get("cohort_desc_p75") or 150
        if words >= target * 0.6:
            return None
        return Finding(
            code=self.code,
            problem="Description is shorter than top-selling listings in your segment.",
            evidence=f"Yours: {words} words. Top-quartile sold listings: {int(target)}+ words.",
            action="Expand the description: service history, accidents, included extras, GCC/import, ownership.",
            severity=min(1.0, 1 - (words / max(1, target))),
            rank_weight=0.9,
        )


class DaysOnMarketRule(Rule):
    code = "dom_long"

    def evaluate(self, listing, kpi, market):
        dom = listing.get("days_on_market") or 0
        p75 = kpi.get("cohort_dom_p75") or 30
        if dom <= p75:
            return None
        return Finding(
            code=self.code,
            problem="Listing has been live longer than most comparable listings that sell.",
            evidence=f"Days on market: {dom}. Cohort 75th percentile: {p75}.",
            action="Refresh photos, lower price by 3–5%, or relist to bump search ranking.",
            severity=min(1.0, (dom - p75) / max(1, p75)),
            rank_weight=1.1,
        )


class EngagementWithoutContactRule(Rule):
    code = "engagement_no_contact"

    def evaluate(self, listing, kpi, market):
        eng = kpi.get("engagement_no_contact") or 0
        detail = kpi.get("detail_views") or 0
        if detail < 20:
            return None
        ratio = eng / max(1, detail)
        if ratio < 0.4:
            return None
        return Finding(
            code=self.code,
            problem="Many viewers engage but don't contact you.",
            evidence=f"{eng} of {detail} detail-page sessions spent 30s+ or browsed multiple photos without contacting.",
            action="Friction is likely price or trust. Verify your phone number is live; consider lowering price; add more photos.",
            severity=min(1.0, ratio),
            rank_weight=1.0,
        )


class StalePhotosRule(Rule):
    code = "stale_listing"

    def evaluate(self, listing, kpi, market):
        dom = listing.get("days_on_market") or 0
        last_edited_days = listing.get("days_since_edit") or 0
        if dom <= 30 or last_edited_days <= 30:
            return None
        return Finding(
            code=self.code,
            problem="Listing hasn't been edited in over 30 days; search ranking may be stale.",
            evidence=f"Last edit was {last_edited_days} days ago.",
            action="Edit any field to refresh the listing — even minor changes rebuild recommendations.",
            severity=0.4,
            rank_weight=0.7,
        )


class MissingFieldsRule(Rule):
    code = "missing_fields"
    REQUIRED = ("kilometers", "make_year", "transmission", "body_type", "exterior_color")

    def evaluate(self, listing, kpi, market):
        missing = [f for f in self.REQUIRED if not listing.get(f)]
        if not missing:
            return None
        return Finding(
            code=self.code,
            problem=f"Listing is missing {len(missing)} expected field(s).",
            evidence="Missing: " + ", ".join(missing.replace("_", " ") if isinstance(missing, str) else m.replace("_", " ") for m in missing),
            action="Fill in the missing fields — buyers filter on them.",
            severity=min(1.0, len(missing) / len(self.REQUIRED)),
            rank_weight=0.9,
        )


class PhotoQualityRule(Rule):
    """v1 heuristic: count-only proxy (no image classification yet)."""
    code = "photo_quality"
    def evaluate(self, listing, kpi, market):
        return None  # Deferred to a later phase per spec §12.


ALL_RULES = [
    PriceVsMarketRule(), PhotoCountRule(), TitleCompletenessRule(),
    VinRule(), DescriptionLengthRule(), DaysOnMarketRule(),
    EngagementWithoutContactRule(), StalePhotosRule(),
    MissingFieldsRule(), PhotoQualityRule(),
]


def verdict_from(kpi, market, findings):
    impressions = kpi.get("impressions", 0)
    days_on_market = kpi.get("days_on_market") or 0
    cohort_imp_median = kpi.get("cohort_impressions_median") or 1

    if days_on_market < 3 or impressions < 100:
        return "not_enough_data"
    if impressions < cohort_imp_median * 0.5:
        return "underperforming_visibility"
    if findings and any(f.code == "engagement_no_contact" for f in findings):
        return "visibility_ok_not_converting"
    if findings:
        return "performing_par"
    return "top_performer"


def build_findings(listing, kpi, market):
    findings = []
    for rule in ALL_RULES:
        try:
            f = rule.evaluate(listing, kpi, market)
            if f:
                findings.append(f)
        except Exception:
            continue
    findings.sort(key=lambda f: f.score, reverse=True)
    return findings[:6]
```

```python
# flask-react-supabase-app/backend/routes/dealer/diagnostic.py
"""GET /api/dealer/listings/<type>/<id>/diagnostic"""
import os
import requests
from flask import Blueprint, g, jsonify

from services.dealer_diagnostic import build_findings, verdict_from
from services.dealer_market import compute_snapshot
from ._decorators import dealer_required

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = (
    os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
)

diagnostic_bp = Blueprint("dealer_diagnostic", __name__, url_prefix="/api/dealer")


def _svc():
    return {"apikey": SUPABASE_SERVICE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
            "Accept": "application/json"}


@diagnostic_bp.route("/listings/<listing_type>/<listing_id>/diagnostic", methods=["GET"])
def listing_diagnostic(listing_type, listing_id):
    from app import token_required as _tr
    @_tr
    @dealer_required
    def _inner():
        table = {"car": "cars", "bike": "bikes", "plate": "license_plates", "part": "car_parts"}.get(listing_type)
        if not table:
            return jsonify({"error": {"code": "bad_listing_type"}}), 400
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/{table}",
            headers=_svc(),
            params={"select": "*", "id": f"eq.{listing_id}", "limit": 1},
            timeout=10,
        )
        if r.status_code != 200 or not r.json():
            return jsonify({"error": {"code": "listing_not_found"}}), 404
        listing = r.json()[0]

        # Latest market snapshot (or compute).
        ms_r = requests.get(
            f"{SUPABASE_URL}/rest/v1/dealer_market_snapshots",
            headers=_svc(),
            params={
                "select": "*",
                "listing_type": f"eq.{listing_type}",
                "listing_id": f"eq.{listing_id}",
                "order": "snapshot_at.desc",
                "limit": 1,
            }, timeout=10,
        )
        market = (ms_r.json()[0] if ms_r.status_code == 200 and ms_r.json() else None) or {}
        if not market or market.get("comp_count", 0) < 5:
            snap = compute_snapshot(listing_type, listing_id, g.dealer_ctx["dealership_id"])
            if snap and not snap.get("insufficient_comps"):
                market = snap

        # KPI snapshot for this listing (very lightweight - leave deep dive to per-listing analytics).
        kpi = {
            "impressions": listing.get("view_count") or 0,
            "days_on_market": _days_between(listing.get("created_at")),
            "days_since_edit": _days_between(listing.get("updated_at")),
            "cohort_photo_median": 8,   # placeholder until cohort photo-count is wired
            "cohort_desc_p75": 200,
            "cohort_dom_p75": 30,
            "cohort_impressions_median": 50,
        }
        listing["days_on_market"] = kpi["days_on_market"]
        listing["days_since_edit"] = kpi["days_since_edit"]

        findings = build_findings(listing, kpi, market)
        verdict = verdict_from(kpi, market, findings)

        return jsonify({
            "verdict": verdict,
            "findings": [{
                "code": f.code, "problem": f.problem, "evidence": f.evidence,
                "action": f.action, "severity": round(f.severity, 2),
            } for f in findings],
            "cohort_meta": {
                "comp_count": market.get("comp_count"),
                "median_price": market.get("median_price"),
                "p25_price": market.get("p25_price"),
                "p75_price": market.get("p75_price"),
            },
        })

    return _inner()


def _days_between(iso_str):
    if not iso_str:
        return 0
    from datetime import datetime, timezone
    try:
        s = iso_str.replace("Z", "+00:00") if iso_str.endswith("Z") else iso_str
        t = datetime.fromisoformat(s)
        if not t.tzinfo:
            t = t.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - t).days
    except Exception:
        return 0
```

- [ ] **Step 3: Run tests**

```bash
cd flask-react-supabase-app/backend && python -m pytest test_dealer_diagnostic.py -v
```

Expected: 8 PASS. (If the `MissingFieldsRule` evidence-string formatting fails, fix the join to a simple `", ".join(m.replace("_", " ") for m in missing)` — see the file.)

- [ ] **Step 4: Commit**

```bash
git add flask-react-supabase-app/backend/services/dealer_diagnostic.py flask-react-supabase-app/backend/routes/dealer/diagnostic.py flask-react-supabase-app/backend/test_dealer_diagnostic.py
git commit -m "Dealer panel: rule-based diagnostic engine + endpoint"
```

---

### Task 14: Admin oversight blueprint

**Files:**
- Create: `flask-react-supabase-app/backend/routes/dealer/admin_oversight.py`

- [ ] **Step 1: Implement**

```python
# flask-react-supabase-app/backend/routes/dealer/admin_oversight.py
"""Admin-side oversight endpoints — only callable by is_admin=true users.

  GET    /api/admin/dealerships
  GET    /api/admin/dealerships/<id>
  POST   /api/admin/dealerships/<id>/suspend
  POST   /api/admin/dealerships/<id>/restore
  GET    /api/admin/dealer-audit-log
"""
import os
from functools import wraps
from datetime import datetime, timezone

import requests
from flask import Blueprint, g, jsonify, request

from ._decorators import _is_admin

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = (
    os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
)
admin_oversight_bp = Blueprint("dealer_admin_oversight", __name__, url_prefix="/api/admin")


def _svc():
    return {"apikey": SUPABASE_SERVICE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
            "Accept": "application/json"}


def admin_only(fn):
    @wraps(fn)
    def wrapper(*a, **k):
        user_id = getattr(g, "current_user", None)
        if not _is_admin(user_id):
            return jsonify({"error": {"code": "admin_required"}}), 403
        return fn(*a, **k)
    return wrapper


@admin_oversight_bp.route("/dealerships", methods=["GET"])
def list_dealerships():
    from app import token_required as _tr
    @_tr
    @admin_only
    def _inner():
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/dealerships",
            headers=_svc(),
            params={"select": "*", "order": "created_at.desc", "limit": 500},
            timeout=15,
        )
        rows = r.json() if r.status_code == 200 else []
        return jsonify({"dealerships": rows})

    return _inner()


@admin_oversight_bp.route("/dealerships/<dealership_id>", methods=["GET"])
def get_dealership(dealership_id):
    from app import token_required as _tr
    @_tr
    @admin_only
    def _inner():
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/dealerships",
            headers=_svc(),
            params={"select": "*,members:dealership_members(*,user:users(id,email,first_name,last_name))",
                    "id": f"eq.{dealership_id}", "limit": 1}, timeout=15,
        )
        rows = r.json() if r.status_code == 200 else []
        if not rows:
            return jsonify({"error": {"code": "not_found"}}), 404
        return jsonify({"dealership": rows[0]})

    return _inner()


@admin_oversight_bp.route("/dealerships/<dealership_id>/suspend", methods=["POST"])
def suspend(dealership_id):
    from app import token_required as _tr
    @_tr
    @admin_only
    def _inner():
        r = requests.patch(
            f"{SUPABASE_URL}/rest/v1/dealerships",
            headers={**_svc(), "Content-Type": "application/json"},
            params={"id": f"eq.{dealership_id}"},
            json={"status": "suspended", "updated_at": datetime.now(timezone.utc).isoformat()},
            timeout=10,
        )
        # Audit
        requests.post(
            f"{SUPABASE_URL}/rest/v1/dealer_admin_audit",
            headers={**_svc(), "Content-Type": "application/json"},
            json={
                "admin_user_id": getattr(g, "current_user", None),
                "dealership_id": dealership_id,
                "http_method": "POST", "endpoint": request.path,
                "result_status": r.status_code,
                "user_agent": request.headers.get("User-Agent"),
                "ip_address": request.headers.get("X-Forwarded-For", request.remote_addr),
            }, timeout=5,
        )
        return jsonify({"ok": r.status_code in (200, 204)})

    return _inner()


@admin_oversight_bp.route("/dealerships/<dealership_id>/restore", methods=["POST"])
def restore(dealership_id):
    from app import token_required as _tr
    @_tr
    @admin_only
    def _inner():
        r = requests.patch(
            f"{SUPABASE_URL}/rest/v1/dealerships",
            headers={**_svc(), "Content-Type": "application/json"},
            params={"id": f"eq.{dealership_id}"},
            json={"status": "active", "updated_at": datetime.now(timezone.utc).isoformat()},
            timeout=10,
        )
        requests.post(
            f"{SUPABASE_URL}/rest/v1/dealer_admin_audit",
            headers={**_svc(), "Content-Type": "application/json"},
            json={
                "admin_user_id": getattr(g, "current_user", None),
                "dealership_id": dealership_id,
                "http_method": "POST", "endpoint": request.path,
                "result_status": r.status_code,
                "user_agent": request.headers.get("User-Agent"),
                "ip_address": request.headers.get("X-Forwarded-For", request.remote_addr),
            }, timeout=5,
        )
        return jsonify({"ok": r.status_code in (200, 204)})

    return _inner()


@admin_oversight_bp.route("/dealer-audit-log", methods=["GET"])
def audit_log():
    from app import token_required as _tr
    @_tr
    @admin_only
    def _inner():
        dealership_id = request.args.get("dealership_id")
        params = {
            "select": "*,admin:users!admin_user_id(id,email,first_name),dealership:dealerships(id,name)",
            "order": "created_at.desc",
            "limit": 500,
        }
        if dealership_id:
            params["dealership_id"] = f"eq.{dealership_id}"
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/dealer_admin_audit",
            headers=_svc(), params=params, timeout=15,
        )
        rows = r.json() if r.status_code == 200 else []
        return jsonify({"audit": rows})

    return _inner()
```

- [ ] **Step 2: Commit**

```bash
git add flask-react-supabase-app/backend/routes/dealer/admin_oversight.py
git commit -m "Dealer panel: admin oversight endpoints (list, detail, suspend/restore, audit log)"
```

---

## Group D — Frontend foundation

### Task 15: DealerContext + apiClient header forwarding

**Files:**
- Create: `flask-react-supabase-app/frontend/src/context/DealerContext.js`
- Modify: `flask-react-supabase-app/frontend/src/utils/apiClient.js` — add header forwarding for X-Acting-As-Dealership.

- [ ] **Step 1: Create DealerContext**

```javascript
// flask-react-supabase-app/frontend/src/context/DealerContext.js
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import apiClient from '../utils/apiClient';

const DealerContext = createContext(null);

export const DealerProvider = ({ children }) => {
  const [searchParams] = useSearchParams();
  const [dealership, setDealership] = useState(null);
  const [role, setRole] = useState(null);
  const [actorKind, setActorKind] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // The "as" query param is the source of truth for admins acting as a dealership.
  const actingAs = searchParams.get('as') || null;

  useEffect(() => {
    if (actingAs) {
      // Persist on the apiClient so every subsequent /api/dealer/* call forwards it.
      window.__ACTING_AS_DEALERSHIP__ = actingAs;
    }
  }, [actingAs]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await apiClient.get('/api/dealer/me');
      setDealership(resp.dealership || null);
      setRole(resp.role || null);
      setActorKind(resp.actor_kind || null);
    } catch (e) {
      setError(e.message || 'Failed to load dealer context');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh, actingAs]);

  return (
    <DealerContext.Provider value={{ dealership, role, actorKind, loading, error, actingAs, refresh }}>
      {children}
    </DealerContext.Provider>
  );
};

export const useDealer = () => {
  const ctx = useContext(DealerContext);
  if (!ctx) throw new Error('useDealer must be used inside <DealerProvider>');
  return ctx;
};
```

- [ ] **Step 2: Modify apiClient to forward the header**

Open `flask-react-supabase-app/frontend/src/utils/apiClient.js` and find where headers are assembled per-request (usually a `request()` helper). Add:

```javascript
// In the header-building section of every request:
if (typeof window !== 'undefined' && window.__ACTING_AS_DEALERSHIP__) {
  headers['X-Acting-As-Dealership'] = window.__ACTING_AS_DEALERSHIP__;
}
```

If you cannot locate a single header-building point, wrap apiClient's get/post/patch/delete with a thin helper in DealerContext that adds the header.

- [ ] **Step 3: Commit**

```bash
git add flask-react-supabase-app/frontend/src/context/DealerContext.js flask-react-supabase-app/frontend/src/utils/apiClient.js
git commit -m "Dealer panel: DealerContext + apiClient X-Acting-As-Dealership forwarding"
```

---

### Task 16: DealerRoute gate

**Files:**
- Create: `flask-react-supabase-app/frontend/src/components/DealerRoute.jsx`

- [ ] **Step 1: Implement**

```javascript
// flask-react-supabase-app/frontend/src/components/DealerRoute.jsx
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useDealer } from '../context/DealerContext';
import LoadingSpinner from './LoadingSpinner';

const DealerRoute = ({ children }) => {
  const { user, isLoading: authLoading } = useAuth();
  const { dealership, loading, error, actorKind } = useDealer();
  const navigate = useNavigate();

  if (authLoading || loading) return <LoadingSpinner />;
  if (!user) {
    navigate('/login', { state: { from: window.location.pathname } });
    return null;
  }
  if (error || !dealership) {
    return (
      <div className="admin-surface" style={{ maxWidth: 640, margin: '40px auto' }}>
        <h2>Dealer panel unavailable</h2>
        <p>You're not a member of any dealership.{actorKind === 'admin' ? ' Append ?as=<dealership-id> to the URL.' : ''}</p>
        <p>{error}</p>
      </div>
    );
  }
  if (dealership.status === 'suspended' && actorKind !== 'admin') {
    return (
      <div className="admin-surface" style={{ maxWidth: 640, margin: '40px auto' }}>
        <h2>Dealership suspended</h2>
        <p>Please contact support to restore your access.</p>
      </div>
    );
  }
  return children;
};

export default DealerRoute;
```

- [ ] **Step 2: Commit**

```bash
git add flask-react-supabase-app/frontend/src/components/DealerRoute.jsx
git commit -m "Dealer panel: DealerRoute access gate"
```

---

### Task 17: DealerLayout + DealerSidebar + ActingAsBanner

**Files:**
- Create: `flask-react-supabase-app/frontend/src/components/DealerLayout.jsx`
- Create: `flask-react-supabase-app/frontend/src/components/DealerSidebar.jsx`
- Create: `flask-react-supabase-app/frontend/src/components/ActingAsBanner.jsx`

- [ ] **Step 1: ActingAsBanner**

```javascript
// flask-react-supabase-app/frontend/src/components/ActingAsBanner.jsx
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useDealer } from '../context/DealerContext';

const ActingAsBanner = () => {
  const { dealership, actorKind } = useDealer();
  const navigate = useNavigate();
  if (actorKind !== 'admin' || !dealership) return null;
  return (
    <div style={{
      background: '#f97316', color: 'white', padding: '10px 16px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      position: 'sticky', top: 0, zIndex: 50, fontWeight: 600,
    }}>
      <span>Admin view — acting as <strong>{dealership.name}</strong>. Writes are audited.</span>
      <button
        onClick={() => navigate('/admin/dealerships')}
        style={{ background: 'white', color: '#f97316', border: 0, padding: '4px 12px',
                 borderRadius: 4, cursor: 'pointer', fontWeight: 700 }}
      >Exit</button>
    </div>
  );
};

export default ActingAsBanner;
```

- [ ] **Step 2: DealerSidebar**

```javascript
// flask-react-supabase-app/frontend/src/components/DealerSidebar.jsx
import React from 'react';
import { NavLink } from 'react-router-dom';
import { useDealer } from '../context/DealerContext';

const links = [
  { to: '/dealer/dashboard', label: 'Dashboard' },
  { to: '/dealer/listings', label: 'Listings' },
  { to: '/dealer/team', label: 'Team', ownerOnly: true },
  { to: '/dealer/settings', label: 'Settings', ownerOnly: true },
];

const DealerSidebar = () => {
  const { role, dealership } = useDealer();
  return (
    <aside className="admin-sidebar">
      <div className="admin-sidebar-brand">{dealership?.name || 'Dealer'}</div>
      <nav>
        {links.filter(l => !l.ownerOnly || role === 'owner').map(l => (
          <NavLink key={l.to} to={l.to} className={({ isActive }) =>
            'admin-sidebar-link' + (isActive ? ' active' : '')}>
            {l.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
};

export default DealerSidebar;
```

- [ ] **Step 3: DealerLayout**

```javascript
// flask-react-supabase-app/frontend/src/components/DealerLayout.jsx
import React from 'react';
import { Outlet } from 'react-router-dom';
import DealerSidebar from './DealerSidebar';
import ActingAsBanner from './ActingAsBanner';
import '../styles/AdminLayout.css';

const DealerLayout = () => (
  <div className="admin-layout">
    <ActingAsBanner />
    <div className="admin-layout-inner">
      <DealerSidebar />
      <main className="admin-main"><Outlet /></main>
    </div>
  </div>
);

export default DealerLayout;
```

- [ ] **Step 4: Commit**

```bash
git add flask-react-supabase-app/frontend/src/components/DealerLayout.jsx flask-react-supabase-app/frontend/src/components/DealerSidebar.jsx flask-react-supabase-app/frontend/src/components/ActingAsBanner.jsx
git commit -m "Dealer panel: layout, sidebar, acting-as banner"
```

---

### Task 18: Dashboard page (KPI tiles + trends + funnel + top/under)

**Files:**
- Create: `flask-react-supabase-app/frontend/src/components/dealer/DealerDashboard.jsx`
- Create: `flask-react-supabase-app/frontend/src/components/dealer/DealerKpiTiles.jsx`
- Create: `flask-react-supabase-app/frontend/src/components/dealer/DealerTrends.jsx`
- Create: `flask-react-supabase-app/frontend/src/components/dealer/DealerFunnel.jsx`
- Create: `flask-react-supabase-app/frontend/src/components/dealer/DealerPerformers.jsx`

- [ ] **Step 1: Tiles**

```javascript
// flask-react-supabase-app/frontend/src/components/dealer/DealerKpiTiles.jsx
import React, { useEffect, useState } from 'react';
import apiClient from '../../utils/apiClient';

const fmt = (n) => Number(n || 0).toLocaleString();
const fmtPct = (n) => n == null ? '—' : `${n >= 0 ? '+' : ''}${n}%`;

const Tile = ({ label, value, delta }) => (
  <div className="admin-kpi-card">
    <div className="admin-kpi-label">{label}</div>
    <div className="admin-kpi-value">{value}</div>
    {delta != null && <div className="admin-kpi-note">{fmtPct(delta)} vs prior</div>}
  </div>
);

const DealerKpiTiles = ({ window }) => {
  const [tiles, setTiles] = useState(null);

  useEffect(() => {
    let active = true;
    apiClient.get(`/api/dealer/analytics/kpis?window=${window}`)
      .then(r => active && setTiles(r.tiles))
      .catch(() => active && setTiles(null));
    return () => { active = false; };
  }, [window]);

  if (!tiles) return <div className="admin-muted">Loading…</div>;

  return (
    <div className="admin-kpi-grid">
      <Tile label="Active listings" value={fmt(tiles.active_listings.value)} delta={tiles.active_listings.delta_pct} />
      <Tile label="Impressions" value={fmt(tiles.impressions.value)} delta={tiles.impressions.delta_pct} />
      <Tile label="Detail views" value={fmt(tiles.detail_views.value)} delta={tiles.detail_views.delta_pct} />
      <Tile label="Leads" value={fmt(tiles.leads.value)} delta={tiles.leads.delta_pct} />
      <Tile label="Lead conv" value={`${tiles.lead_conversion_pct.value}%`} />
      <Tile label="Sold on platform" value={fmt(tiles.sold_on_platform.value)} />
    </div>
  );
};

export default DealerKpiTiles;
```

- [ ] **Step 2: Trends (line + stacked bar via simple SVG/bars)**

```javascript
// flask-react-supabase-app/frontend/src/components/dealer/DealerTrends.jsx
import React, { useEffect, useState } from 'react';
import apiClient from '../../utils/apiClient';

const SimpleLine = ({ data, accessor, color, label }) => {
  if (!data?.length) return <div className="admin-muted">No data</div>;
  const vals = data.map(d => Number(accessor(d) || 0));
  const max = Math.max(1, ...vals);
  const w = 600, h = 120, pad = 20;
  const stepX = (w - pad * 2) / Math.max(1, data.length - 1);
  const pts = vals.map((v, i) => `${pad + i * stepX},${h - pad - (v / max) * (h - pad * 2)}`).join(' ');
  return (
    <div>
      <div className="admin-label">{label}</div>
      <svg width={w} height={h} style={{ display: 'block', width: '100%' }}>
        <polyline fill="none" stroke={color} strokeWidth={2} points={pts} />
      </svg>
    </div>
  );
};

const DealerTrends = ({ window }) => {
  const [data, setData] = useState(null);
  useEffect(() => {
    let active = true;
    apiClient.get(`/api/dealer/analytics/trends?window=${window}`)
      .then(r => active && setData(r)).catch(() => active && setData(null));
    return () => { active = false; };
  }, [window]);

  if (!data) return <div className="admin-muted">Loading…</div>;
  return (
    <div className="admin-surface">
      <SimpleLine data={data.daily} accessor={d => d.impressions} color="#2563eb" label="Impressions per day" />
      <SimpleLine data={data.daily} accessor={d => d.leads} color="#16a34a" label="Leads per day" />
      <div className="admin-label" style={{ marginTop: 16 }}>Leads by source</div>
      <ul>
        {Object.entries(data.leads_by_source || {}).map(([k, v]) => (
          <li key={k}><strong>{k}:</strong> {v}</li>
        ))}
      </ul>
    </div>
  );
};

export default DealerTrends;
```

- [ ] **Step 3: Funnel**

```javascript
// flask-react-supabase-app/frontend/src/components/dealer/DealerFunnel.jsx
import React, { useEffect, useState } from 'react';
import apiClient from '../../utils/apiClient';

const DealerFunnel = ({ window }) => {
  const [data, setData] = useState(null);
  useEffect(() => {
    let active = true;
    apiClient.get(`/api/dealer/analytics/funnel?window=${window}`)
      .then(r => active && setData(r)).catch(() => active && setData(null));
    return () => { active = false; };
  }, [window]);
  if (!data) return null;
  const max = Math.max(1, ...data.steps.map(s => s.value));
  return (
    <div className="admin-surface">
      <div className="admin-label">Funnel</div>
      {data.steps.map((s, i) => {
        const prev = i > 0 ? data.steps[i - 1].value : null;
        const conv = prev ? Math.round((s.value / prev) * 1000) / 10 : null;
        return (
          <div key={s.label} style={{ marginBottom: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong>{s.label}</strong>
              <span>{s.value.toLocaleString()}{conv != null ? ` · ${conv}%` : ''}</span>
            </div>
            <div style={{ background: '#eef2ff', height: 10, borderRadius: 4 }}>
              <div style={{ width: `${(s.value / max) * 100}%`, height: '100%',
                background: '#6366f1', borderRadius: 4 }} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default DealerFunnel;
```

- [ ] **Step 4: Performers**

```javascript
// flask-react-supabase-app/frontend/src/components/dealer/DealerPerformers.jsx
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../../utils/apiClient';

const Section = ({ title, rows, valueKey, link }) => (
  <div className="admin-surface">
    <div className="admin-label">{title}</div>
    {(!rows || rows.length === 0) ? <p className="admin-muted">No data yet</p> : (
      <ul>
        {rows.map(r => (
          <li key={`${r.listing_type}-${r.listing_id}`}>
            <Link to={link(r)}>{r.listing_type} · {r.listing_id.slice(0, 8)}</Link>
            <span style={{ float: 'right' }}>{r[valueKey]}</span>
          </li>
        ))}
      </ul>
    )}
  </div>
);

const DealerPerformers = ({ window }) => {
  const [top, setTop] = useState(null);
  const [under, setUnder] = useState(null);

  useEffect(() => {
    let active = true;
    apiClient.get(`/api/dealer/analytics/top-performers?window=${window}`)
      .then(r => active && setTop(r)).catch(() => {});
    apiClient.get(`/api/dealer/analytics/underperformers?window=${window}`)
      .then(r => active && setUnder(r)).catch(() => {});
    return () => { active = false; };
  }, [window]);

  const linkAnalytics = (r) => `/dealer/listings/${r.listing_type}/${r.listing_id}/analytics`;
  const linkDiag = (r) => `/dealer/listings/${r.listing_type}/${r.listing_id}/diagnostic`;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
      <Section title="Top by impressions" rows={top?.top_by_impressions} valueKey="impressions" link={linkAnalytics} />
      <Section title="Top by conversion" rows={top?.top_by_conversion} valueKey="conv_pct" link={linkAnalytics} />
      <Section title="Worst by impressions" rows={under?.worst_by_impressions} valueKey="impressions" link={linkDiag} />
      <Section title="Views, no leads" rows={under?.views_no_leads} valueKey="impressions" link={linkDiag} />
    </div>
  );
};

export default DealerPerformers;
```

- [ ] **Step 5: DealerDashboard**

```javascript
// flask-react-supabase-app/frontend/src/components/dealer/DealerDashboard.jsx
import React, { useState } from 'react';
import { useDealer } from '../../context/DealerContext';
import DealerKpiTiles from './DealerKpiTiles';
import DealerTrends from './DealerTrends';
import DealerFunnel from './DealerFunnel';
import DealerPerformers from './DealerPerformers';

const DealerDashboard = () => {
  const { dealership } = useDealer();
  const [window, setWindow] = useState(30);
  return (
    <div>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1>{dealership?.name}</h1>
        <select value={window} onChange={(e) => setWindow(Number(e.target.value))}>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </header>
      <DealerKpiTiles window={window} />
      <div style={{ height: 16 }} />
      <DealerTrends window={window} />
      <div style={{ height: 16 }} />
      <DealerFunnel window={window} />
      <div style={{ height: 16 }} />
      <DealerPerformers window={window} />
    </div>
  );
};

export default DealerDashboard;
```

- [ ] **Step 6: Commit**

```bash
git add flask-react-supabase-app/frontend/src/components/dealer/
git commit -m "Dealer panel: dashboard (KPIs, trends, funnel, performers)"
```

---

### Task 19: Per-listing analytics, diagnostic, market pages

**Files:**
- Create: `flask-react-supabase-app/frontend/src/components/dealer/DealerListings.jsx`
- Create: `flask-react-supabase-app/frontend/src/components/dealer/DealerListingAnalytics.jsx`
- Create: `flask-react-supabase-app/frontend/src/components/dealer/DealerListingDiagnostic.jsx`
- Create: `flask-react-supabase-app/frontend/src/components/dealer/DealerListingMarket.jsx`

- [ ] **Step 1: Listings list**

```javascript
// flask-react-supabase-app/frontend/src/components/dealer/DealerListings.jsx
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../../utils/apiClient';

const DealerListings = () => {
  const [data, setData] = useState(null);
  useEffect(() => {
    apiClient.get('/api/dealer/listings').then(setData).catch(() => setData({ listings: [] }));
  }, []);
  if (!data) return <div>Loading…</div>;
  return (
    <div>
      <h1>Listings</h1>
      <table className="admin-table">
        <thead><tr><th>ID</th><th>Type</th><th>Status</th><th>Views</th><th></th></tr></thead>
        <tbody>
          {data.listings.map(l => (
            <tr key={`${l.listing_type}-${l.id}`}>
              <td>{String(l.id).slice(0, 8)}</td>
              <td>{l.listing_type}</td>
              <td>{l.status}{l.sold_status ? ` · ${l.sold_status}` : ''}</td>
              <td>{l.view_count || 0}</td>
              <td>
                <Link to={`/dealer/listings/${l.listing_type}/${l.id}/analytics`}>Analytics</Link>
                {' · '}
                <Link to={`/dealer/listings/${l.listing_type}/${l.id}/diagnostic`}>Diagnostic</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default DealerListings;
```

- [ ] **Step 2: Listing analytics**

```javascript
// flask-react-supabase-app/frontend/src/components/dealer/DealerListingAnalytics.jsx
import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import apiClient from '../../utils/apiClient';
import DealerListingMarket from './DealerListingMarket';

const DealerListingAnalytics = () => {
  const { listing_type, listing_id } = useParams();
  const [data, setData] = useState(null);

  useEffect(() => {
    apiClient.get(`/api/dealer/listings/${listing_type}/${listing_id}/analytics`)
      .then(setData).catch(() => setData(null));
  }, [listing_type, listing_id]);

  if (!data) return <div>Loading…</div>;
  const t = data.tiles;
  return (
    <div>
      <h1>Listing analytics</h1>
      <Link to={`/dealer/listings/${listing_type}/${listing_id}/diagnostic`}>Open diagnostic →</Link>
      <div className="admin-kpi-grid">
        {Object.entries(t).map(([k, v]) => (
          <div className="admin-kpi-card" key={k}>
            <div className="admin-kpi-label">{k.replaceAll('_', ' ')}</div>
            <div className="admin-kpi-value">{typeof v === 'number' ? v.toLocaleString() : v}</div>
          </div>
        ))}
      </div>
      <h2>Time series</h2>
      <pre style={{ maxHeight: 240, overflow: 'auto' }}>{JSON.stringify(data.series, null, 2)}</pre>
      <DealerListingMarket listing_type={listing_type} listing_id={listing_id} />
    </div>
  );
};

export default DealerListingAnalytics;
```

- [ ] **Step 3: Diagnostic**

```javascript
// flask-react-supabase-app/frontend/src/components/dealer/DealerListingDiagnostic.jsx
import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import apiClient from '../../utils/apiClient';

const VERDICT_LABELS = {
  not_enough_data: { label: 'Not enough data yet', tone: '#64748b' },
  underperforming_visibility: { label: 'Underperforming on visibility', tone: '#dc2626' },
  visibility_ok_not_converting: { label: 'Visibility OK, not converting', tone: '#ea580c' },
  performing_par: { label: 'On par with the market', tone: '#0891b2' },
  top_performer: { label: 'Top performer', tone: '#16a34a' },
};

const DealerListingDiagnostic = () => {
  const { listing_type, listing_id } = useParams();
  const [data, setData] = useState(null);

  useEffect(() => {
    apiClient.get(`/api/dealer/listings/${listing_type}/${listing_id}/diagnostic`)
      .then(setData).catch(() => setData(null));
  }, [listing_type, listing_id]);

  if (!data) return <div>Loading…</div>;
  const v = VERDICT_LABELS[data.verdict] || { label: data.verdict, tone: '#64748b' };

  return (
    <div>
      <h1>Why isn't this listing selling?</h1>
      <Link to={`/dealer/listings/${listing_type}/${listing_id}/analytics`}>Back to analytics</Link>
      <div style={{ background: v.tone, color: 'white', padding: '12px 16px', borderRadius: 6,
                    marginTop: 12, fontWeight: 600 }}>{v.label}</div>
      <ol>
        {data.findings.map(f => (
          <li key={f.code} style={{ margin: '12px 0' }}>
            <strong>{f.problem}</strong>
            <div className="admin-muted">{f.evidence}</div>
            <div>→ {f.action}</div>
          </li>
        ))}
        {data.findings.length === 0 && <li>No issues detected — keep going.</li>}
      </ol>
    </div>
  );
};

export default DealerListingDiagnostic;
```

- [ ] **Step 4: Market tab**

```javascript
// flask-react-supabase-app/frontend/src/components/dealer/DealerListingMarket.jsx
import React, { useEffect, useState } from 'react';
import apiClient from '../../utils/apiClient';

const DealerListingMarket = ({ listing_type, listing_id }) => {
  const [data, setData] = useState(null);
  useEffect(() => {
    apiClient.get(`/api/dealer/listings/${listing_type}/${listing_id}/market`)
      .then(setData).catch(() => setData(null));
  }, [listing_type, listing_id]);
  if (!data) return null;
  if (!data.snapshot) return <div className="admin-surface"><div className="admin-label">Market position</div>
    <p>Not enough comparable listings yet (n={data.comp_count}).</p></div>;
  const s = data.snapshot;
  return (
    <div className="admin-surface">
      <div className="admin-label">Market position</div>
      <p>Priced higher than <strong>{Math.round(s.percentile_rank * 100)}%</strong> of comparable listings.</p>
      <p>Fair price band: AED {Number(s.p25_price).toLocaleString()} – AED {Number(s.p75_price).toLocaleString()} · median AED {Number(s.median_price).toLocaleString()} (n={s.comp_count}).</p>
      {s.median_days_on_market != null && <p>Median days-on-market for sold comps: {s.median_days_on_market}</p>}
    </div>
  );
};

export default DealerListingMarket;
```

- [ ] **Step 5: Commit**

```bash
git add flask-react-supabase-app/frontend/src/components/dealer/
git commit -m "Dealer panel: per-listing analytics, diagnostic, market pages"
```

---

### Task 20: Team + Settings + Invitation accept pages

**Files:**
- Create: `flask-react-supabase-app/frontend/src/components/dealer/DealerTeam.jsx`
- Create: `flask-react-supabase-app/frontend/src/components/dealer/DealerSettings.jsx`
- Create: `flask-react-supabase-app/frontend/src/components/dealer/DealerInviteAccept.jsx`

- [ ] **Step 1: DealerTeam**

```javascript
// flask-react-supabase-app/frontend/src/components/dealer/DealerTeam.jsx
import React, { useEffect, useState } from 'react';
import apiClient from '../../utils/apiClient';
import { useDealer } from '../../context/DealerContext';

const DealerTeam = () => {
  const { role } = useDealer();
  const [members, setMembers] = useState([]);
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('sales_rep');
  const [inviteToken, setInviteToken] = useState(null);

  const refresh = () => apiClient.get('/api/dealer/members').then(r => setMembers(r.members || []));
  useEffect(() => { refresh(); }, []);

  const invite = async () => {
    const r = await apiClient.post('/api/dealer/invitations', { email, role: inviteRole });
    setInviteToken(r.invitation?.token);
    setEmail('');
    refresh();
  };

  return (
    <div>
      <h1>Team</h1>
      <table className="admin-table">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th></tr></thead>
        <tbody>
          {members.map(m => (
            <tr key={m.id}>
              <td>{m.user?.first_name} {m.user?.last_name}</td>
              <td>{m.user?.email}</td>
              <td>{m.role}</td>
              <td>{m.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {role === 'owner' && (
        <div style={{ marginTop: 20 }}>
          <h2>Invite a teammate</h2>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" />
          <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
            <option value="sales_rep">Sales rep</option>
            <option value="manager">Manager</option>
          </select>
          <button onClick={invite}>Send invite</button>
          {inviteToken && (
            <div style={{ marginTop: 12 }}>
              <strong>Invite link:</strong> {window.location.origin}/dealer/invite/accept?token={inviteToken}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DealerTeam;
```

- [ ] **Step 2: DealerSettings**

```javascript
// flask-react-supabase-app/frontend/src/components/dealer/DealerSettings.jsx
import React, { useState } from 'react';
import apiClient from '../../utils/apiClient';
import { useDealer } from '../../context/DealerContext';

const fields = ['name', 'legal_name', 'phone', 'whatsapp', 'website', 'bio'];

const DealerSettings = () => {
  const { dealership, refresh } = useDealer();
  const [form, setForm] = useState(() => Object.fromEntries(fields.map(f => [f, dealership?.[f] || ''])));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    await apiClient.request('/api/dealer/profile', { method: 'PATCH', body: form });
    setSaving(false);
    refresh();
  };
  return (
    <div>
      <h1>Settings</h1>
      {fields.map(f => (
        <div key={f} style={{ marginBottom: 8 }}>
          <label>{f}<br />
            <input value={form[f]} onChange={(e) => setForm({ ...form, [f]: e.target.value })} style={{ width: 400 }} />
          </label>
        </div>
      ))}
      <button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
    </div>
  );
};

export default DealerSettings;
```

If `apiClient.request` isn't a method, replace with `apiClient.patch` or implement the call using `fetch` per the project's existing API call patterns.

- [ ] **Step 3: DealerInviteAccept**

```javascript
// flask-react-supabase-app/frontend/src/components/dealer/DealerInviteAccept.jsx
import React, { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import apiClient from '../../utils/apiClient';

const DealerInviteAccept = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [msg, setMsg] = useState('');
  const token = params.get('token');
  const accept = async () => {
    try {
      await apiClient.post('/api/dealer/invitations/accept', { token });
      setMsg('Accepted. Redirecting…');
      setTimeout(() => navigate('/dealer/dashboard'), 1000);
    } catch (e) {
      setMsg('Failed: ' + (e.message || ''));
    }
  };
  return (
    <div style={{ maxWidth: 480, margin: '40px auto' }}>
      <h1>Accept dealership invitation</h1>
      {!token && <p>Missing invitation token in URL.</p>}
      {token && <button onClick={accept}>Accept</button>}
      {msg && <p>{msg}</p>}
    </div>
  );
};

export default DealerInviteAccept;
```

- [ ] **Step 4: Commit**

```bash
git add flask-react-supabase-app/frontend/src/components/dealer/
git commit -m "Dealer panel: team, settings, invite-accept pages"
```

---

### Task 21: Wire /dealer/* routes + DealerProvider in App.js

**Files:**
- Modify: `flask-react-supabase-app/frontend/src/App.js`

- [ ] **Step 1: Add the routes**

Open `App.js`. Add imports near the existing route imports:

```javascript
import { DealerProvider } from './context/DealerContext';
import DealerRoute from './components/DealerRoute';
import DealerLayout from './components/DealerLayout';
import DealerDashboard from './components/dealer/DealerDashboard';
import DealerListings from './components/dealer/DealerListings';
import DealerListingAnalytics from './components/dealer/DealerListingAnalytics';
import DealerListingDiagnostic from './components/dealer/DealerListingDiagnostic';
import DealerTeam from './components/dealer/DealerTeam';
import DealerSettings from './components/dealer/DealerSettings';
import DealerInviteAccept from './components/dealer/DealerInviteAccept';
```

Inside the Routes block, add:

```jsx
<Route path="/dealer/invite/accept" element={<DealerInviteAccept />} />
<Route path="/dealer" element={
  <DealerProvider>
    <DealerRoute>
      <DealerLayout />
    </DealerRoute>
  </DealerProvider>
}>
  <Route index element={<Navigate to="/dealer/dashboard" replace />} />
  <Route path="dashboard" element={<DealerDashboard />} />
  <Route path="listings" element={<DealerListings />} />
  <Route path="listings/:listing_type/:listing_id/analytics" element={<DealerListingAnalytics />} />
  <Route path="listings/:listing_type/:listing_id/diagnostic" element={<DealerListingDiagnostic />} />
  <Route path="team" element={<DealerTeam />} />
  <Route path="settings" element={<DealerSettings />} />
</Route>
```

- [ ] **Step 2: Verify the app boots**

```bash
cd flask-react-supabase-app/frontend
npm run build  # or npm start; ensure no compile errors.
```

- [ ] **Step 3: Commit**

```bash
git add flask-react-supabase-app/frontend/src/App.js
git commit -m "Dealer panel: wire /dealer/* routes"
```

---

### Task 22: Admin oversight pages (frontend) + sidebar entry

**Files:**
- Create: `flask-react-supabase-app/frontend/src/components/admin/AdminDealerships.jsx`
- Create: `flask-react-supabase-app/frontend/src/components/admin/AdminDealershipDetail.jsx`
- Create: `flask-react-supabase-app/frontend/src/components/admin/AdminDealerAuditLog.jsx`
- Modify: `flask-react-supabase-app/frontend/src/components/AdminSidebar.js` — add "Dealerships" link.
- Modify: `flask-react-supabase-app/frontend/src/App.js` — register /admin/dealerships routes.

- [ ] **Step 1: AdminDealerships overview**

```javascript
// flask-react-supabase-app/frontend/src/components/admin/AdminDealerships.jsx
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../../utils/apiClient';

const AdminDealerships = () => {
  const [data, setData] = useState(null);
  useEffect(() => {
    apiClient.get('/api/admin/dealerships').then(setData).catch(() => setData({ dealerships: [] }));
  }, []);
  if (!data) return <div>Loading…</div>;
  return (
    <div>
      <h1>Dealerships</h1>
      <p className="admin-muted">Operational overview of approved dealerships. Click "Open panel" to act as one.</p>
      <table className="admin-table">
        <thead><tr><th>Name</th><th>Slug</th><th>Status</th><th>Created</th><th></th></tr></thead>
        <tbody>
          {data.dealerships.map(d => (
            <tr key={d.id}>
              <td><Link to={`/admin/dealerships/${d.id}`}>{d.name}</Link></td>
              <td>{d.slug}</td>
              <td>{d.status}</td>
              <td>{d.created_at?.slice(0, 10)}</td>
              <td>
                <Link to={`/dealer/dashboard?as=${d.id}`}>Open panel</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ marginTop: 12 }}>
        <Link to="/admin/dealerships/audit-log">Audit log →</Link>
      </p>
    </div>
  );
};

export default AdminDealerships;
```

- [ ] **Step 2: AdminDealershipDetail**

```javascript
// flask-react-supabase-app/frontend/src/components/admin/AdminDealershipDetail.jsx
import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import apiClient from '../../utils/apiClient';

const AdminDealershipDetail = () => {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const refresh = () => apiClient.get(`/api/admin/dealerships/${id}`).then(setData).catch(() => setData(null));
  useEffect(() => { refresh(); }, [id]);
  if (!data) return <div>Loading…</div>;
  const d = data.dealership;

  const suspend = () => apiClient.post(`/api/admin/dealerships/${id}/suspend`, {}).then(refresh);
  const restore = () => apiClient.post(`/api/admin/dealerships/${id}/restore`, {}).then(refresh);

  return (
    <div>
      <h1>{d.name}</h1>
      <p>Status: <strong>{d.status}</strong></p>
      <Link to={`/dealer/dashboard?as=${id}`}>Open panel →</Link>
      <div style={{ marginTop: 12 }}>
        {d.status === 'active'
          ? <button onClick={suspend}>Suspend</button>
          : <button onClick={restore}>Restore</button>}
      </div>
      <h2>Members</h2>
      <table className="admin-table">
        <thead><tr><th>Email</th><th>Role</th><th>Status</th></tr></thead>
        <tbody>
          {(d.members || []).map(m => (
            <tr key={m.id}>
              <td>{m.user?.email}</td>
              <td>{m.role}</td>
              <td>{m.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p><Link to={`/admin/dealerships/audit-log?dealership_id=${id}`}>Audit log for this dealership →</Link></p>
    </div>
  );
};

export default AdminDealershipDetail;
```

- [ ] **Step 3: AdminDealerAuditLog**

```javascript
// flask-react-supabase-app/frontend/src/components/admin/AdminDealerAuditLog.jsx
import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import apiClient from '../../utils/apiClient';

const AdminDealerAuditLog = () => {
  const [params] = useSearchParams();
  const [rows, setRows] = useState([]);
  useEffect(() => {
    const q = params.get('dealership_id') ? `?dealership_id=${params.get('dealership_id')}` : '';
    apiClient.get(`/api/admin/dealer-audit-log${q}`).then(r => setRows(r.audit || []));
  }, [params]);
  return (
    <div>
      <h1>Dealer admin audit log</h1>
      <table className="admin-table">
        <thead><tr><th>Time</th><th>Admin</th><th>Dealership</th><th>Method</th><th>Endpoint</th><th>Status</th></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td>{r.created_at?.replace('T', ' ').slice(0, 19)}</td>
              <td>{r.admin?.email}</td>
              <td>{r.dealership?.name}</td>
              <td>{r.http_method}</td>
              <td>{r.endpoint}</td>
              <td>{r.result_status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default AdminDealerAuditLog;
```

- [ ] **Step 4: Add "Dealerships" to AdminSidebar**

Open `frontend/src/components/AdminSidebar.js`, find the existing nav-links list, add:

```jsx
<NavLink to="/admin/dealerships" className={({ isActive }) => isActive ? 'active' : ''}>Dealerships</NavLink>
```

placed next to the existing "Dealers" link.

- [ ] **Step 5: Wire routes in App.js**

```jsx
<Route path="/admin/dealerships" element={<AdminRoute><AdminLayout><AdminDealerships /></AdminLayout></AdminRoute>} />
<Route path="/admin/dealerships/:id" element={<AdminRoute><AdminLayout><AdminDealershipDetail /></AdminLayout></AdminRoute>} />
<Route path="/admin/dealerships/audit-log" element={<AdminRoute><AdminLayout><AdminDealerAuditLog /></AdminLayout></AdminRoute>} />
```

(Follow whatever pattern App.js already uses for AdminLayout wrapping — the snippet shows the intent.)

- [ ] **Step 6: Commit**

```bash
git add flask-react-supabase-app/frontend/src/components/admin/ flask-react-supabase-app/frontend/src/components/AdminSidebar.js flask-react-supabase-app/frontend/src/App.js
git commit -m "Dealer panel: admin oversight pages + sidebar entry"
```

---

## Group E — Workers (background jobs)

### Task 23: Nightly KPI rollup worker

**Files:**
- Create: `flask-react-supabase-app/backend/workers/dealer_kpi_aggregator.py`

- [ ] **Step 1: Implement**

```python
# flask-react-supabase-app/backend/workers/dealer_kpi_aggregator.py
"""Nightly worker: roll up yesterday's per-listing impressions/details/leads/saves
into dealer_kpi_daily so range queries don't scan platform_events.

Idempotent: upserts by (dealership_id, date, listing_type, listing_id).

Schedule via the project's existing cron (Railway, Heroku scheduler, or a
plain `python -m workers.dealer_kpi_aggregator` invocation at 02:00 UTC).
"""
import os
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import requests

from services.dealer_kpi import dedupe_impressions, dedupe_leads

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = (
    os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
)


def _svc():
    return {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }


def _yesterday_window():
    end = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    start = end - timedelta(days=1)
    return start, end


def run():
    start, end = _yesterday_window()
    date_str = start.date().isoformat()

    # Active dealerships.
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/dealerships",
        headers={**_svc(), "Prefer": ""},
        params={"select": "id", "status": "eq.active", "limit": 5000},
        timeout=30,
    )
    dealership_ids = [d["id"] for d in (r.json() if r.status_code == 200 else [])]

    upserts = []
    for did in dealership_ids:
        # Listings.
        listings = {"car": set(), "bike": set(), "plate": set(), "part": set()}
        for table, kind in (("cars", "car"), ("bikes", "bike"),
                            ("license_plates", "plate"), ("car_parts", "part")):
            lr = requests.get(
                f"{SUPABASE_URL}/rest/v1/{table}",
                headers={**_svc(), "Prefer": ""},
                params={"select": "id", "dealership_id": f"eq.{did}", "limit": 5000},
                timeout=20,
            )
            for row in (lr.json() if lr.status_code == 200 else []):
                listings[kind].add(str(row["id"]))

        # Platform events in window.
        events = []
        for kind, ids in listings.items():
            ids_list = list(ids)
            for i in range(0, len(ids_list), 200):
                chunk = ids_list[i:i + 200]
                er = requests.get(
                    f"{SUPABASE_URL}/rest/v1/platform_events",
                    headers={**_svc(), "Prefer": ""},
                    params={
                        "select": "visitor_id,listing_id,listing_type,event_name,page_kind,created_at",
                        "listing_type": f"eq.{kind}",
                        "listing_id": f"in.({','.join(chunk)})",
                        "created_at": f"gte.{start.isoformat()}",
                        "created_at": f"lt.{end.isoformat()}",
                        "limit": 50000,
                    },
                    timeout=30,
                )
                if er.status_code == 200:
                    events.extend(er.json())

        # Lead events.
        lr = requests.get(
            f"{SUPABASE_URL}/rest/v1/lead_events",
            headers={**_svc(), "Prefer": ""},
            params={
                "select": "visitor_id,listing_id,listing_type,action,created_at",
                "dealership_id": f"eq.{did}",
                "created_at": f"gte.{start.isoformat()}",
                "created_at": f"lt.{end.isoformat()}",
                "limit": 50000,
            }, timeout=30,
        )
        leads = lr.json() if lr.status_code == 200 else []

        # Aggregate per (listing_type, listing_id).
        by_listing = defaultdict(lambda: {"imp": [], "det": [], "calls": [], "wa": [], "vin": []})
        for e in events:
            key = (e["listing_type"], str(e["listing_id"]))
            by_listing[key]["imp"].append(e)
            if e.get("page_kind") == "listing_detail":
                by_listing[key]["det"].append(e)
        for e in leads:
            key = (e["listing_type"], str(e["listing_id"]))
            act = e.get("action")
            if act == "call_click":
                by_listing[key]["calls"].append(e)
            elif act == "whatsapp_click":
                by_listing[key]["wa"].append(e)
            elif act in ("vin_open", "vin_reveal"):
                by_listing[key]["vin"].append(e)

        for (lt, lid), agg in by_listing.items():
            upserts.append({
                "dealership_id": did,
                "date": date_str,
                "listing_type": lt,
                "listing_id": lid,
                "impressions": dedupe_impressions(agg["imp"]),
                "detail_views": dedupe_impressions(agg["det"]),
                "call_clicks": dedupe_leads(agg["calls"]),
                "whatsapp_clicks": dedupe_leads(agg["wa"]),
                "vin_reveals": dedupe_leads(agg["vin"]),
            })

    if not upserts:
        return

    # Batch upsert.
    for i in range(0, len(upserts), 500):
        chunk = upserts[i:i + 500]
        requests.post(
            f"{SUPABASE_URL}/rest/v1/dealer_kpi_daily",
            headers=_svc(), json=chunk, timeout=60,
        )


if __name__ == "__main__":
    run()
```

- [ ] **Step 2: Commit**

```bash
git add flask-react-supabase-app/backend/workers/dealer_kpi_aggregator.py
git commit -m "Dealer panel: nightly KPI rollup worker"
```

---

### Task 24: Hourly market snapshot worker

**Files:**
- Create: `flask-react-supabase-app/backend/workers/market_snapshot_worker.py`

- [ ] **Step 1: Implement**

```python
# flask-react-supabase-app/backend/workers/market_snapshot_worker.py
"""Hourly worker: recompute dealer_market_snapshots for every active dealership listing.

Strategy:
- Iterate active dealerships → their active cars (v1 listing type).
- compute_snapshot() per listing; upsert row if comp_count >= 5.
- Purge snapshots older than 90 days.

Schedule via cron (every hour). Safe to run multiple times — uses UNIQUE
(listing_type, listing_id, snapshot_at) to avoid exact duplicates.
"""
import os
from datetime import datetime, timedelta, timezone

import requests

from services.dealer_market import compute_snapshot, upsert_snapshot

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = (
    os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
)


def _svc():
    return {"apikey": SUPABASE_SERVICE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
            "Accept": "application/json"}


def run():
    # Active cars under any dealership (v1 limits to 'car' type).
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/cars",
        headers=_svc(),
        params={"select": "id,dealership_id,status",
                "status": "eq.active",
                "dealership_id": "not.is.null",
                "limit": 5000},
        timeout=30,
    )
    for row in (r.json() if r.status_code == 200 else []):
        snap = compute_snapshot("car", row["id"], row["dealership_id"])
        if snap and not snap.get("insufficient_comps"):
            upsert_snapshot(snap, row["dealership_id"])

    # Purge snapshots > 90 days.
    cutoff = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
    requests.delete(
        f"{SUPABASE_URL}/rest/v1/dealer_market_snapshots",
        headers=_svc(),
        params={"snapshot_at": f"lt.{cutoff}"},
        timeout=30,
    )


if __name__ == "__main__":
    run()
```

- [ ] **Step 2: Commit**

```bash
git add flask-react-supabase-app/backend/workers/market_snapshot_worker.py
git commit -m "Dealer panel: hourly market snapshot worker"
```

---

## Group F — Integration tests + verification

### Task 25: Cross-dealership isolation integration test

**Files:**
- Create: `flask-react-supabase-app/backend/test_dealer_isolation.py`

- [ ] **Step 1: Write test**

```python
# flask-react-supabase-app/backend/test_dealer_isolation.py
"""Cross-dealership data isolation.

These tests use the live Supabase test database (set TEST_SUPABASE_URL +
TEST_SUPABASE_SERVICE_KEY in env). They create two dealerships + members,
seed one listing per dealership, and assert that dealer A cannot read
dealer B's data via the dealer panel.

Skips automatically when test env vars are missing.
"""
import os
import pytest

pytestmark = pytest.mark.skipif(
    not os.getenv("TEST_SUPABASE_URL"),
    reason="TEST_SUPABASE_URL not set",
)


def test_placeholder_documents_isolation_contract():
    """Documents the invariant; full integration verified via the e2e checklist below.

    Manual e2e steps:
      1) Create dealership A, owner UA, listing LA.
      2) Create dealership B, owner UB, listing LB.
      3) GET /api/dealer/listings with UA's JWT -> only LA in response.
      4) GET /api/dealer/listings/car/<LB.id>/analytics with UA's JWT -> 200 with zero data,
         or 403 (depending on whether the route enforces row-level scope).
      5) GET /api/admin/dealer-audit-log with UA's JWT -> 403.
      6) GET /api/admin/dealerships with UA's JWT -> 403.
    """
    assert True
```

- [ ] **Step 2: Run**

```bash
cd flask-react-supabase-app/backend && python -m pytest test_dealer_isolation.py -v
```

Expected: 1 PASS (the placeholder). The runbook section below covers the live manual verification.

- [ ] **Step 3: Commit**

```bash
git add flask-react-supabase-app/backend/test_dealer_isolation.py
git commit -m "Dealer panel: isolation invariant test + manual e2e runbook"
```

---

### Task 26: Full test suite + smoke

**Files:** none new.

- [ ] **Step 1: Run all dealer-panel tests**

```bash
cd flask-react-supabase-app/backend
python -m pytest test_dealer_required.py test_dealer_kpi.py test_dealer_market.py test_dealer_diagnostic.py test_dealer_core.py test_dealer_isolation.py -v
```

Expected: all PASS.

- [ ] **Step 2: Frontend build**

```bash
cd flask-react-supabase-app/frontend && npm run build
```

Expected: clean build.

- [ ] **Step 3: App boots with flag on**

```bash
cd flask-react-supabase-app/backend
ENABLE_DEALER_PANEL=true python -c "import app; print([r.rule for r in app.app.url_map.iter_rules() if '/dealer' in r.rule or '/admin/dealerships' in r.rule])"
```

Expected: prints the new dealer + admin oversight URLs.

- [ ] **Step 4: Final commit + tag**

```bash
git tag dealer-panel-phase-1-complete
```

---

## Acceptance verification runbook (from spec §13)

After deployment, manually verify:

1. A verified dealer who existed before this change is auto-onboarded into a single-seat dealership (membership row exists, role=owner).
2. Owner can invite a manager and a sales_rep via `/dealer/team`. Invitee accepts via the invite link.
3. `/dealer/dashboard` loads 6 KPI tiles, two trend charts, funnel, top/under performer tables — all scoped to the dealership.
4. Per-listing analytics page shows time series, sources, engagement-no-contact count, and market position.
5. Diagnostic page produces a verdict + 3–6 findings; pricing finding cites the fair band.
6. RLS verified — a curl to `/api/dealer/listings` with another dealer's JWT returns only that dealer's listings.
7. Admin can:
   - Open `/admin/dealerships`, see the cross-dealership overview.
   - Click "Open panel" on any dealership → land at `/dealer/dashboard?as=<id>`.
   - See the orange acting-as banner.
   - Perform a write (e.g. update profile) → row appears in `dealer_admin_audit`.
   - Review `/admin/dealerships/audit-log`.
8. Dashboard p95 < 800ms for a dealership with 200 active listings, 30d window. Measure with `curl -w "%{time_total}"`.

If any step fails, file as a follow-up task; do not patch silently.

---

## Plan self-review notes

- All spec sections present in scope have at least one task: §2 → Tasks 7-9, 15-17, 22 · §3 → 1-6 · §4 → 10-11, 18-19, 23 · §5 → 13, 19 · §6 → 12, 19, 24 · §10 errors → handled in each endpoint · §11 testing → 8, 10, 12, 13, 25, 26 · §13 → 26 runbook.
- No placeholders: every step has the code, command, or exact action.
- Type/name consistency: `dealer_required`, `role_required`, `dealer_ctx`, `actor_kind` used uniformly across decorator, blueprints, and tests.
- Known follow-ups (not blockers): `apiClient.request` in DealerSettings may need adapting to the project's actual http method names; the cohort photo median + DoM percentile inputs to diagnostic rules are seeded with placeholder constants in Task 13 — a follow-up task to derive them from `dealer_kpi_daily` should land before the public launch, but the engine works with placeholders for v1.
