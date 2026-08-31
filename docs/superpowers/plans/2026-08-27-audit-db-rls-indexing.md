# Audit Remediation: Database Schema, RLS & Indexing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every confirmed CRITICAL/HIGH database, RLS, and indexing finding from `docs/audits/AUDIT_REPORT.md` §5 (S-DB1 through S-DB6 and the supporting HIGH items in §6.3). Specific focus: tenant-table RLS, conflicting function definitions, missing CHECK constraints, admin-stats pagination, browse-page indexes, N+1 user-listings query.

**Architecture:** Schema-level fixes via additive, idempotent migrations. Each migration is independently runnable; tests verify the new shape via raw SQL probes (Supabase REST is not sufficient — we need to inspect `pg_policies`, `pg_indexes`, etc.). Where code is implicated (e.g. `_fetch_listing_lifecycle_rows`), we pair the migration with a code refactor and an integration test.

**Tech Stack:**
- SQL applied in Supabase SQL Editor (via saved `*.sql` files in this repo)
- Python 3 backend: `supabase_request`, `app.py` lifecycle stats + N+1 fixes
- `pytest` for backend regression tests
- `psycopg2` (already in `requirements.txt`, no new dep) for the handful of tests that
  read `pg_policies`/`pg_proc`/`pg_constraint` directly — PostgREST cannot expose
  `pg_catalog`, and this project has no SQLAlchemy/ORM layer anywhere else, so these
  tests get a small shared helper (`backend/test_pg.py`, added in Task 1) rather than
  inventing a new ORM dependency. Requires `DATABASE_URL` (the direct Postgres
  connection string from Supabase Dashboard → Settings → Database → Connection
  string → URI — NOT the `SUPABASE_URL` REST endpoint) exported before running these
  specific tests; they `SkipTest` cleanly if it's unset.

**Reference spec:** `docs/audits/AUDIT_REPORT.md` §5.1–5.3 (S-DB1 through S-DB6, M1–M10).

---

## File structure

| File | Responsibility | Change |
|---|---|---|
| `backend/test_pg.py` | Shared `get_conn()` helper: direct `psycopg2` connection via `DATABASE_URL`, `SkipTest` if unset | New (Task 1) |
| `backend/migrations/2026-08-27_service_role_qualifier.sql` | Rewrite `FOR ALL USING (true)` policies on tenant tables to `TO service_role` only | New |
| `backend/migrations/2026-08-27_canonical_is_admin.sql` | Drop conflicting `is_admin(uuid)`; standardise on no-arg `public.is_admin()` | New |
| `backend/migrations/2026-08-27_users_update_with_check.sql` | Add `WITH CHECK` to `users` UPDATE policy; column-level REVOKE on admin columns | New |
| `backend/migrations/2026-08-27_dealer_application_status_check.sql` | Canonical CHECK constraint on `users.dealer_application_status` | New |
| `backend/migrations/2026-08-27_listing_active_partial_indexes.sql` | `(status, created_at DESC) WHERE deleted_at IS NULL AND is_approved = true` on each listing table | New |
| `supabase/migrations/2026-08-27_cars_model_trgm.sql` | GIN trigram index on `cars.car_model` | New |
| `backend/app.py:1151-1185` | `_fetch_listing_lifecycle_rows` | Replace full-table paginate with server-side aggregate via RPC |
| `backend/app.py:2689-2697` | N+1 images query | Use PostgREST embed |
| `backend/app.py:2657-2683` | `user_dismissed_at` retry-fallback | Assert column exists at startup; remove the catch |
| `backend/supabase/migrations/` (multiple, consolidate) | Duplicate / `_FINAL` / `_v2` migration files | Move to `archive/` subdirectory |
| `backend/migrations/2026-06-03_dealer_kpi_market_audit.sql:36` | Missing `ON DELETE` on `admin_user_id` FK | New migration: `ON DELETE SET NULL` |

Untouched: every test that depends on the existing migration state; existing service-role code paths.

---

## Task 1: Add `TO service_role` qualifier to tenant-table policies

**Files:**
- Create: `backend/test_pg.py` (one-time shared helper for this whole plan)
- Create: `backend/migrations/2026-08-27_service_role_qualifier.sql`
- Test: `backend/test_service_role_policies.py`

> **Note:** This project has no SQLAlchemy/ORM layer and no `backend.supabase.get_engine` —
> the app talks to Postgres exclusively through PostgREST (`supabase_request`), confirmed
> by grepping `backend/` for `sqlalchemy`/`get_engine` (zero hits) and by every existing
> `backend/test_*.py` file (86 of them), which mock `supabase_request`, never open a raw
> DB connection. `pg_policies`/`pg_proc`/`pg_constraint` introspection is not reachable
> through PostgREST, so this plan adds one small helper (`psycopg2`, already in
> `requirements.txt`) instead of inventing a new dependency. Every task below imports it.

- [ ] **Step 1: Create the shared `psycopg2` connection helper**

Create `backend/test_pg.py`:

```python
"""Shared direct-Postgres connection helper for RLS/schema introspection tests.

App code never talks to Postgres directly (everything goes through PostgREST
via `supabase_request`), so there is no existing connection helper to reuse.
These tests read `pg_policies` / `pg_proc` / `pg_constraint`, which PostgREST
cannot expose. Requires `DATABASE_URL` — the direct connection string from
Supabase Dashboard -> Settings -> Database -> Connection string -> URI (NOT
the `SUPABASE_URL` REST endpoint already in `.env`).
"""
import os
import unittest

import psycopg2


def get_conn():
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        raise unittest.SkipTest(
            "DATABASE_URL not set — export the direct Postgres connection "
            "string (Supabase Dashboard -> Settings -> Database -> Connection "
            "string -> URI) to run this schema/RLS introspection test."
        )
    return psycopg2.connect(dsn)
```

- [ ] **Step 2: Write the failing test**

Create `backend/test_service_role_policies.py`:

```python
import unittest

from test_pg import get_conn


class TestServiceRolePolicies(unittest.TestCase):
    TENANT_TABLES = [
        "dealerships", "dealership_members", "dealership_invitations",
        "dealer_kpi_daily", "dealer_market_snapshots",
        "dealer_leads", "dealer_lead_events",
        "dealer_webhooks", "dealer_webhook_deliveries",
        "dealer_api_sources", "dealer_inventory_jobs", "dealer_inventory_row_errors",
        "dealer_info_requests", "dealer_info_request_uploads",
    ]

    def _unqualified(self):
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT tablename, policyname, qual::text, array_to_string(roles, ',')
                FROM pg_policies WHERE schemaname='public'
            """)
            rows = cur.fetchall()
        bad = []
        for r in rows:
            if r[0] not in self.TENANT_TABLES:
                continue
            qual = (r[2] or "").strip()
            roles = r[3] or ""
            if qual == "(true)" and (not roles or roles in ("public", "")):
                bad.append((r[0], r[1]))
        return bad

    def test_no_unqualified_using_true_on_tenant_tables(self):
        bad = self._unqualified()
        self.assertEqual(bad, [],
            f"these policies need TO service_role: {bad}")
```

- [ ] **Step 3: Run and verify failure**

Run: `DATABASE_URL=<from Supabase dashboard> python -m pytest backend/test_service_role_policies.py -v 2>&1 | tail -10`
Expected: FAIL with a non-empty list (12+ currently-open policies per the audit §5.1 S-DB1). (If `DATABASE_URL` is unset the test SKIPs instead of failing — that's a signal to set it, not a pass.)

- [ ] **Step 4: Apply the migration**

Create `backend/migrations/2026-08-27_service_role_qualifier.sql`:

```sql
-- Restricted POLICIES for tenant-scoped dealer tables.
-- Every policy currently using FOR ALL USING (true) WITH CHECK (true)
-- without a TO clause is open to anon and authenticated.
-- Re-qualify them to TO service_role.
DO $$
DECLARE
  p RECORD;
  sql_text TEXT;
BEGIN
  FOR p IN
    SELECT tablename, policyname, cmd, qual::text AS qual, check_clause::text AS check_text, array_to_string(roles, ',') AS roles_csv
    FROM pg_policies
    WHERE schemaname='public'
      AND tablename IN (
        'dealerships','dealership_members','dealership_invitations',
        'dealer_kpi_daily','dealer_market_snapshots',
        'dealer_leads','dealer_lead_events',
        'dealer_webhooks','dealer_webhook_deliveries',
        'dealer_api_sources','dealer_inventory_jobs','dealer_inventory_row_errors',
        'dealer_info_requests','dealer_info_request_uploads'
      )
  LOOP
    IF p.qual = '(true)' AND (p.roles_csv IS NULL OR p.roles_csv IN ('public', '')) THEN
      sql_text := format(
        'DROP POLICY %I ON public.%I; '
        'CREATE POLICY %I ON public.%I FOR %s TO service_role '
        'USING (%s) WITH CHECK (%s);',
        p.policyname, p.tablename,
        p.policyname, p.tablename,
        p.cmd, p.qual, COALESCE(p.check_text, 'true')
      );
      RAISE NOTICE 'Re-qualifying: %.%', p.tablename, p.policyname;
      EXECUTE sql_text;
    END IF;
  END LOOP;
END $$;
```

- [ ] **Step 5: Re-run and verify**

Run: `DATABASE_URL=<from Supabase dashboard> python -m pytest backend/test_service_role_policies.py -v 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 6: Smoke-test dealer-panel routes**

Run:
```bash
python -m pytest backend/test_dealer_leads_routes.py \
                backend/test_dealer_inventory_routes.py \
                backend/test_dealer_webhooks_routes.py \
                -q 2>&1 | tail -10
```
Expected: same pass/fail counts as before this migration. If any new failure, the route was relying on the open policy — investigate before merging.

- [ ] **Step 7: Commit**

```bash
git add backend/test_pg.py backend/migrations/2026-08-27_service_role_qualifier.sql backend/test_service_role_policies.py
git commit -m "fix(rls): restrict tenant-table policies to service_role only"
```

---

## Task 2: Canonicalize `is_admin()` to a no-arg signature

**Files:**
- Create: `backend/migrations/2026-08-27_canonical_is_admin.sql`
- Test: `backend/test_is_admin_canonical.py`

- [ ] **Step 1: Write the failing test**

Create `backend/test_is_admin_canonical.py`:

```python
import unittest

from test_pg import get_conn


class TestIsAdminCanonical(unittest.TestCase):
    def test_no_arg_signature_exists(self):
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT pronargs FROM pg_proc "
                "WHERE proname='is_admin' AND pronamespace=(SELECT oid FROM pg_namespace WHERE nspname='public')"
            )
            noparams = cur.fetchall()
        arities = sorted([r[0] for r in noparams])
        self.assertEqual(arities, [0],
            f"public.is_admin must be no-arg only; found arities: {arities}")
```

- [ ] **Step 2: Run and verify failure**

Run: `DATABASE_URL=<from Supabase dashboard> python -m pytest backend/test_is_admin_canonical.py -v 2>&1 | tail -10`
Expected: FAIL — `is_admin(user_id UUID)` still exists (`create_users_table.sql:36`, `fix_security_issues_FINAL.sql:104`) so arities are `[0, 1]`.

- [ ] **Step 3: Apply the migration**

Create `backend/migrations/2026-08-27_canonical_is_admin.sql`:

```sql
-- Canonical signature: public.is_admin() RETURNS boolean (no args).
-- Drops every variant that takes a parameter and recreates the canonical form.

DROP FUNCTION IF EXISTS public.is_admin(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.is_admin() CASCADE;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND is_admin = true
  );
$$;

-- Re-create any policies that USED is_admin(uuid) to use is_admin() instead.
DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN
    SELECT tablename, policyname, cmd, COALESCE(qual::text, 'true') AS qual, COALESCE(check_clause::text, 'true') AS check_text
    FROM pg_policies
    WHERE schemaname='public'
      AND (qual::text LIKE '%is_admin(%' OR check_clause::text LIKE '%is_admin(%')
  LOOP
    EXECUTE format(
      'DROP POLICY %I ON public.%I; '
      'CREATE POLICY %I ON public.%I FOR %s '
      'USING (%s) WITH CHECK (%s);',
      p.policyname, p.tablename,
      p.policyname, p.tablename, p.cmd,
      replace(p.qual, 'public.is_admin(auth.uid())', 'public.is_admin()'),
      replace(p.check_text, 'public.is_admin(auth.uid())', 'public.is_admin()')
    );
  END LOOP;
END $$;
```

- [ ] **Step 4: Re-run the test**

Run: `DATABASE_URL=<from Supabase dashboard> python -m pytest backend/test_is_admin_canonical.py -v 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Run admin smoke tests**

Run:
```bash
python -m pytest backend/test_admin_route_guards.py \
                backend/test_admin_hub_routes_smoke.py \
                -q 2>&1 | tail -10
```
Expected: same counts as before this migration. If any new failure, an admin route returned 500 because its RLS lookup errored; investigate before merging.

- [ ] **Step 6: Commit**

```bash
git add backend/migrations/2026-08-27_canonical_is_admin.sql backend/test_is_admin_canonical.py
git commit -m "fix(rls): canonical public.is_admin() no-arg signature"
```

---

## Task 3: Add `WITH CHECK` to `users` UPDATE policy + column-level REVOKE

**Files:**
- Create: `backend/migrations/2026-08-27_users_update_with_check.sql`
- Test: `backend/test_users_update_with_check.py`

- [ ] **Step 1: Write the failing test**

Create `backend/test_users_update_with_check.py`:

```python
import unittest

from test_pg import get_conn


class TestUsersUpdateWithCheck(unittest.TestCase):
    def test_users_update_policy_has_with_check(self):
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT qual, with_check FROM pg_policies
                WHERE schemaname='public' AND tablename='users' AND cmd='UPDATE'
                LIMIT 1
            """)
            row = cur.fetchone()
        self.assertIsNotNone(row, "no UPDATE policy on public.users found")
        self.assertTrue(
            row[1] and 'is_admin' in (row[1] or '').lower(),
            f"UPDATE policy on public.users must constrain is_admin writes; with_check={row[1]!r}"
        )

    def test_admin_columns_not_updateable_by_authenticated(self):
        # Probe pg_attribute to confirm REVOKE UPDATE (is_admin) FROM authenticated
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT HAS_COLUMN_PRIVILEGE('authenticated', 'public.users', 'UPDATE, is_admin')
            """)
            row = cur.fetchone()[0]
        # After REVOKE, the privilege should be False
        self.assertFalse(row, "authenticated should not retain UPDATE on is_admin column")
```

- [ ] **Step 2: Run and verify failure**

Run: `python -m pytest backend/test_users_update_with_check.py -v 2>&1 | tail -10`
Expected: FAIL on both assertions.

- [ ] **Step 3: Apply the migration**

Create `backend/migrations/2026-08-27_users_update_with_check.sql`:

```sql
-- Replace open "Users can update own profile" policy with a column-restricted one.
DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
CREATE POLICY "Users can update own profile" ON public.users
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND is_admin         = (SELECT is_admin         FROM public.users WHERE id = auth.uid())
    AND is_super_admin   = (SELECT is_super_admin   FROM public.users WHERE id = auth.uid())
    AND dealer_verified  = (SELECT dealer_verified  FROM public.users WHERE id = auth.uid())
  );

-- Defense in depth: revoke column-level UPDATE on privileged columns.
REVOKE UPDATE (is_admin, is_super_admin, dealer_verified) ON public.users FROM authenticated;
```

- [ ] **Step 4: Re-run tests**

Run: `python -m pytest backend/test_users_update_with_check.py -v 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/migrations/2026-08-27_users_update_with_check.sql backend/test_users_update_with_check.py
git commit -m "fix(rls): users UPDATE policy WITH CHECK blocks self-promotion"
```

---

## Task 4: Canonicalize the `dealer_application_status` CHECK constraint

**Files:**
- Create: `backend/migrations/2026-08-27_dealer_application_status_check.sql`
- Test: `backend/test_dealer_application_status_check.py`

- [ ] **Step 1: Write the failing test**

Create `backend/test_dealer_application_status_check.py`:

```python
import unittest

from test_pg import get_conn


class TestDealerApplicationStatusCheck(unittest.TestCase):
    EXPECTED = {'draft', 'ready_to_submit', 'submitted', 'under_review',
                'action_required', 'approved', 'rejected'}

    def test_status_check_constraint_matches_canonical_set(self):
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT con.conname, pg_get_constraintdef(con.oid)
                FROM pg_constraint con
                JOIN pg_class rel ON rel.oid = con.conrelid
                WHERE rel.relname = 'users' AND con.contype='c'
                  AND pg_get_constraintdef(con.oid) LIKE '%dealer_application_status%'
            """)
            rows = cur.fetchall()
        self.assertTrue(rows, "no dealer_application_status CHECK found on public.users")
        # At least one constraint should mention 'under_review'
        for name, defn in rows:
            if 'under_review' in defn:
                return  # pass
        self.fail(f"no CHECK allows 'under_review'; constraints: {[(n, d) for n, d in rows]}")
```

- [ ] **Step 2: Run and verify failure**

Run: `python -m pytest backend/test_dealer_application_status_check.py -v 2>&1 | tail -10`
Expected: FAIL — the constraint in `add_dealer_kyc_columns.sql:17-29` allows only 4 values; the lifecycle SQL at `2026_08_13_dealer_verification_lifecycle.sql:10-15` added `under_review` (which wins depending on apply order).

- [ ] **Step 3: Apply the migration**

Create `backend/migrations/2026-08-27_dealer_application_status_check.sql`:

```sql
-- Canonical CHECK for users.dealer_application_status.
-- Drops all variants and recreates the lifecycle value set.

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_dealer_application_status_check;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS dealer_application_status_check;

ALTER TABLE public.users ADD CONSTRAINT users_dealer_application_status_check
  CHECK (dealer_application_status IS NULL OR dealer_application_status IN (
    'draft', 'ready_to_submit', 'submitted', 'under_review',
    'action_required', 'approved', 'rejected'
  )) NOT VALID;

-- After data is verified clean, run:
-- ALTER TABLE public.users VALIDATE CONSTRAINT users_dealer_application_status_check;
-- (run that as a separate task once the data review is complete)
```

The `NOT VALID` flag lets the constraint apply to new rows without a full table scan; the `VALIDATE CONSTRAINT` step is done after data cleansing.

- [ ] **Step 4: Re-run and verify**

Run: `python -m pytest backend/test_dealer_application_status_check.py -v 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/migrations/2026-08-27_dealer_application_status_check.sql backend/test_dealer_application_status_check.py
git commit -m "fix(schema): canonical CHECK on users.dealer_application_status"
```

---

## Task 5: Add `(status, created_at DESC) WHERE deleted_at IS NULL AND is_approved = true` partial indexes

**Files:**
- Create: `backend/migrations/2026-08-27_listing_active_partial_indexes.sql`
- Test: `backend/test_listing_indexes.py`

- [ ] **Step 1: Write the failing test that fails on the current state**

Create `backend/test_listing_indexes.py`:

```python
import unittest

from test_pg import get_conn


class TestListingActivePartialIndexes(unittest.TestCase):
    def test_partial_index_present_on_every_listing_table(self):
        # The audit flagged: existing idx_*_status_created doesn't include
        # is_approved=true in the predicate.
        expected_predicate = "is_approved"
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT indexname, indexdef FROM pg_indexes
                WHERE schemaname='public'
                  AND tablename IN ('cars','bikes','car_parts','license_plates')
            """)
            rows = cur.fetchall()
        active = [name for name, defn in rows
                  if 'created_at' in defn and expected_predicate in defn.lower()]
        # Need at least one per listing table
        tables_with_index = set()
        for name, defn in rows:
            for tbl in ('cars','bikes','car_parts','license_plates'):
                if name.startswith(f'idx_{tbl.rstrip("s").rstrip("_parts")}') and 'is_approved' in defn:
                    tables_with_index.add(tbl)
        missing = {'cars','bikes','car_parts','license_plates'} - tables_with_index
        self.assertFalse(missing, f"missing partial indexes on tables: {missing}")
```

(Adjust the predicate check if your project's index names follow a different convention.)

- [ ] **Step 2: Run and verify failure**

Run: `python -m pytest backend/test_listing_indexes.py -v 2>&1 | tail -10`
Expected: FAIL with at least one table missing an active partial index.

- [ ] **Step 3: Apply the migration**

Create `backend/migrations/2026-08-27_listing_active_partial_indexes.sql`:

```sql
-- Add partial indexes for the active-listing browse path.
-- Query shape: WHERE status='approved' AND is_approved=true
--               AND <range filters> ORDER BY created_at DESC

CREATE INDEX IF NOT EXISTS idx_cars_active_created
  ON public.cars (status, created_at DESC)
  WHERE deleted_at IS NULL AND is_approved = true;

CREATE INDEX IF NOT EXISTS idx_bikes_active_created
  ON public.bikes (status, created_at DESC)
  WHERE deleted_at IS NULL AND is_approved = true;

CREATE INDEX IF NOT EXISTS idx_car_parts_active_created
  ON public.car_parts (status, created_at DESC)
  WHERE deleted_at IS NULL AND is_approved = true;

CREATE INDEX IF NOT EXISTS idx_license_plates_active_created
  ON public.license_plates (status, created_at DESC)
  WHERE deleted_at IS NULL AND is_approved = true;
```

- [ ] **Step 4: Re-run and verify**

Run: `python -m pytest backend/test_listing_indexes.py -v 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Smoke-test the public browse API**

Run:
```bash
python -m pytest backend/test_listing_filter_pairs.py backend/test_listing_lifecycle.py -q 2>&1 | tail -10
```
Expected: same pass counts as before the migration (the change is additive).

- [ ] **Step 6: Commit**

```bash
git add backend/migrations/2026-08-27_listing_active_partial_indexes.sql backend/test_listing_indexes.py
git commit -m "perf(indexes): partial indexes matching browse-page filter shape"
```

---

## Task 6: Add GIN trigram index on `cars.car_model`

**Files:**
- Create: `backend/migrations/2026-08-27_cars_model_trgm.sql`
- Test: `backend/test_cars_model_trgm.py`

- [ ] **Step 1: Write the failing test**

Create `backend/test_cars_model_trgm.py`:

```python
import unittest

from test_pg import get_conn


class TestCarsModelTrgm(unittest.TestCase):
    def test_trgm_index_present(self):
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT 1 FROM pg_indexes
                WHERE schemaname='public' AND tablename='cars'
                  AND indexdef LIKE '%gin_trgm_ops%'
            """)
            row = cur.fetchone()
        self.assertIsNotNone(row, "no GIN trgm index on cars.car_model")
```

- [ ] **Step 2: Run and verify failure**

Run: `python -m pytest backend/test_cars_model_trgm.py -v 2>&1 | tail -10`
Expected: FAIL — the index doesn't exist yet.

- [ ] **Step 3: Apply the migration**

Create `backend/migrations/2026-08-27_cars_model_trgm.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_cars_model_trgm
  ON public.cars USING GIN (car_model gin_trgm_ops);
```

- [ ] **Step 4: Re-run and verify**

Run: `python -m pytest backend/test_cars_model_trgm.py -v 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Verify EXPLAIN shows index scan**

Run:
```bash
psql "$DATABASE_URL" -c "EXPLAIN SELECT id FROM cars WHERE car_model ILIKE '%corolla%' LIMIT 30;"
```
Expected: plan uses `Bitmap Index Scan on idx_cars_model_trgm`.

- [ ] **Step 6: Commit**

```bash
git add backend/migrations/2026-08-27_cars_model_trgm.sql backend/test_cars_model_trgm.py
git commit -m "perf(indexes): GIN trigram on cars.car_model for ilike search"
```

---

## Task 7: Server-side lifecycle stats via RPC

**Files:**
- Create: `backend/migrations/2026-08-27_lifecycle_state_views.sql`
- Modify: `backend/app.py:1151-1185` (replace `_fetch_listing_lifecycle_rows`)
- Test: `backend/test_listing_lifecycle.py`

- [ ] **Step 1: Write the failing test that pins the new behaviour**

Open `backend/test_listing_lifecycle.py`. Add a new test:

```python
import unittest


class TestListingLifecycleServerSide(unittest.TestCase):
    def test_lifecycle_counts_return_in_few_rounds(self):
        """The new RPC must return lifecycle counts in O(1) HTTP calls."""
        from unittest.mock import patch
        # Patch supabase_request and assert it's called at most once
        # (i.e. one RPC, no pagination).
        with patch("backend.app.supabase_request") as mock:
            mock.return_value = ({"cars": {"active": 50, "sold": 10}, "bikes": {...}}, 200)
            from backend.app import _fetch_listing_lifecycle_summary
            result = _fetch_listing_lifecycle_summary()
        # Allow up to 4 calls (one per table) but no pagination calls.
        self.assertLessEqual(mock.call_count, 4,
            f"expected ≤4 RPCs, got {mock.call_count}")
```

- [ ] **Step 2: Run and verify failure**

Run: `python -m pytest backend/test_listing_lifecycle.py::TestListingLifecycleServerSide -v 2>&1 | tail -10`
Expected: FAIL — current `_fetch_listing_lifecycle_rows` paginates hundreds of calls.

- [ ] **Step 3: Create the RPC and view**

Create `backend/migrations/2026-08-27_lifecycle_state_views.sql`:

```sql
-- View: roll-up of lifecycle status per listing row.
-- Same shape for cars, bikes, car_parts, license_plates.

CREATE OR REPLACE VIEW public.cars_lifecycle_status AS
SELECT id,
       CASE WHEN deleted_at IS NOT NULL THEN 'deleted'
            WHEN status = 'sold' OR sold_status IS NOT NULL THEN 'sold'
            WHEN expires_at IS NOT NULL AND expires_at < now() THEN 'expired'
            WHEN is_archived THEN 'archived'
            WHEN status IN ('approved','active')
                 AND (expires_at IS NULL OR expires_at > now()) THEN 'active'
            WHEN status IN ('pending','pending_auto_review') THEN 'pending'
            ELSE 'draft' END AS state
FROM public.cars;

CREATE OR REPLACE VIEW public.bikes_lifecycle_status AS
SELECT id,
       CASE WHEN deleted_at IS NOT NULL THEN 'deleted'
            WHEN status = 'sold' OR sold_status IS NOT NULL THEN 'sold'
            WHEN expires_at IS NOT NULL AND expires_at < now() THEN 'expired'
            WHEN is_archived THEN 'archived'
            WHEN status IN ('approved','active')
                 AND (expires_at IS NULL OR expires_at > now()) THEN 'active'
            WHEN status IN ('pending','pending_auto_review') THEN 'pending'
            ELSE 'draft' END AS state
FROM public.bikes;

CREATE OR REPLACE VIEW public.car_parts_lifecycle_status AS
SELECT id,
       CASE WHEN deleted_at IS NOT NULL THEN 'deleted'
            WHEN status = 'sold' OR sold_status IS NOT NULL THEN 'sold'
            WHEN expires_at IS NOT NULL AND expires_at < now() THEN 'expired'
            WHEN is_archived THEN 'archived'
            WHEN status IN ('approved','active')
                 AND (expires_at IS NULL OR expires_at > now()) THEN 'active'
            WHEN status IN ('pending','pending_auto_review') THEN 'pending'
            ELSE 'draft' END AS state
FROM public.car_parts;

CREATE OR REPLACE VIEW public.license_plates_lifecycle_status AS
SELECT id,
       CASE WHEN deleted_at IS NOT NULL THEN 'deleted'
            WHEN status = 'sold' OR sold_status IS NOT NULL THEN 'sold'
            WHEN expires_at IS NOT NULL AND expires_at < now() THEN 'expired'
            WHEN is_archived THEN 'archived'
            WHEN status IN ('approved','active')
                 AND (expires_at IS NULL OR expires_at > now()) THEN 'active'
            WHEN status IN ('pending','pending_auto_review') THEN 'pending'
            ELSE 'draft' END AS state
FROM public.license_plates;

-- RPC: aggregated counts per table.
CREATE OR REPLACE FUNCTION public.listing_lifecycle_counts()
RETURNS TABLE (
  table_name text,
  state text,
  n bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT 'cars', state, count(*) FROM public.cars_lifecycle_status GROUP BY state
  UNION ALL
  SELECT 'bikes', state, count(*) FROM public.bikes_lifecycle_status GROUP BY state
  UNION ALL
  SELECT 'car_parts', state, count(*) FROM public.car_parts_lifecycle_status GROUP BY state
  UNION ALL
  SELECT 'license_plates', state, count(*) FROM public.license_plates_lifecycle_status GROUP BY state;
$$;
```

- [ ] **Step 4: Replace the Python implementation**

In `backend/app.py:1151-1185`, replace `_fetch_listing_lifecycle_rows` and its callers with a one-shot RPC wrapper:

```python
def _fetch_listing_lifecycle_summary():
    """One HTTP call: aggregate lifecycle state counts via RPC."""
    body, status = supabase_request(
        "post", "/rest/v1/rpc/listing_lifecycle_counts", data={}
    )
    if status >= 400:
        return {}
    rows = body or []
    out = {}
    for row in rows:
        tbl = row.get("table_name")
        st = row.get("state")
        n = row.get("n") or 0
        out.setdefault(tbl, {})[st] = int(n)
    return out
```

Locate and update every caller of `_fetch_listing_lifecycle_rows` to use `_fetch_listing_lifecycle_summary` and iterate `out[tbl].items()` instead of building a list of full row records.

- [ ] **Step 5: Re-run the test**

Run: `python -m pytest backend/test_listing_lifecycle.py -v 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 6: Run full admin smoke tests**

Run:
```bash
python -m pytest backend/test_admin_stats_and_posts.py \
                backend/test_admin_listing_overview_emails.py \
                backend/test_admin_expired_listings.py \
                -q 2>&1 | tail -10
```
Expected: same counts as before the change (the API surface is unchanged).

- [ ] **Step 7: Commit**

```bash
git add backend/migrations/2026-08-27_lifecycle_state_views.sql \
        backend/app.py \
        backend/test_listing_lifecycle.py
git commit -m "perf(admin): server-side lifecycle counts via RPC instead of paginating every row"
```

---

## Task 8: Eliminate N+1 in `/api/user/listings`

**Files:**
- Modify: `backend/app.py:2657-2697` (`_collect_user_listing_records`)
- Test: `backend/test_user_listings.py` (existing) + new `test_user_listings_no_n_plus_1.py`

- [ ] **Step 1: Write a test that fails with N+1 behaviour**

Create `backend/test_user_listings_no_n_plus_1.py`:

```python
import unittest
from unittest.mock import patch, call


class TestUserListingsNoNPlusOne(unittest.TestCase):
    @patch("backend.app.supabase_request")
    def test_one_call_per_listing_type_not_per_listing(self, mock_req):
        # Return 3 listings for "user/listings?type=car"
        mock_req.side_effect = [
            ([
                {"id": "L1", "car_manufacturer": "Toyota"},
                {"id": "L2", "car_manufacturer": "Honda"},
                {"id": "L3", "car_manufacturer": "Ford"},
            ], 200),
        ]
        from backend.app import _collect_user_listing_records
        out = _collect_user_listing_records("user-1", listing_type="car")
        # We expect ONE supabase call total (with embedded car_images) — not
        # 1 + 3 = 4 (the bug shape).
        self.assertEqual(mock_req.call_count, 1,
            f"expected 1 call (PostgREST embed), got {mock_req.call_count}")
```

- [ ] **Step 2: Run and verify failure**

Run: `python -m pytest backend/test_user_listings_no_n_plus_1.py -v 2>&1 | tail -10`
Expected: FAIL — current code does 1 fetch for listings + N fetches for images = 4 calls.

- [ ] **Step 3: Use PostgREST embedding**

In `backend/app.py`, locate `_collect_user_listing_records` (around `:2657`). Replace the inner per-listing image fetch loop with a `select` that embeds:

```python
        params = {
            "select": "*,car_images(*)",
            "user_id": f"eq.{current_user}",
            "user_dismissed_at": "is.null",
            "order": "created_at.desc",
        }
        rows, status = supabase_request(
            "get", f"/rest/v1/{config['table']}", params=params, user_id=current_user
        )
```

Adjust the embedded relation (`car_images(*)`) per listing type: `bike_images(*)`, `part_images(*)`, `plate_images(*)`. Each listing type has its own images table; pass `images_table` from `config` and interpolate:

```python
        f"select": f"*,{config['images_table']}(*)",
```

- [ ] **Step 4: Drop the retry-fallback path that hid the schema bug**

The audit (§5.2 H5) flagged `app.py:2657-2683` for carrying an explicit retry that drops `user_dismissed_at` if the column is missing. Once the canonical migration `add_user_dismissed_at.sql` is applied and validated, the retry path is dead code:

```python
        # Remove this entire try/except retry; the column is required now.
        # try/except Exception:
        #     params.pop("user_dismissed_at", None)
        #     rows, status = supabase_request(...)
```

If you don't yet have a separate "validate columns at startup" test, add a simple assertion in `app.py`:

```python
_REQUIRED_COLUMNS = {
    "cars": ["user_dismissed_at"],
    "bikes": ["user_dismissed_at"],
    "car_parts": ["user_dismissed_at"],
    "license_plates": ["user_dismissed_at"],
}
# At startup, after first DB ping:
def _assert_required_columns():
    body, status = supabase_request(
        "get", "/rest/v1/cars?select=user_dismissed_at&limit=1"
    )
    if status >= 400 or (isinstance(body, dict) and 'user_dismissed_at' not in body):
        raise RuntimeError("user_dismissed_at column missing on cars — apply supabase/migrations/.../add_user_dismissed_at.sql")
```

- [ ] **Step 5: Re-run tests**

Run: `python -m pytest backend/test_user_listings_no_n_plus_1.py backend/test_user_listings.py -v 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app.py backend/test_user_listings_no_n_plus_1.py
git commit -m "perf(api): use PostgREST embed to eliminate N+1 on /api/user/listings"
```

---

## Task 9: Add `ON DELETE SET NULL` to `dealership_admin_audit.admin_user_id` FK

**Files:**
- Create: `backend/migrations/2026-08-27_admin_audit_fk_on_delete.sql`
- Test: `backend/test_admin_audit_fk.py`

- [ ] **Step 1: Write the failing test**

Create `backend/test_admin_audit_fk.py`:

```python
import unittest

from test_pg import get_conn


class TestAdminAuditFkOnDelete(unittest.TestCase):
    def test_admin_audit_admin_user_id_has_on_delete_set_null(self):
        # In pg_constraint, confdeltype code 'a' = NO ACTION, 'r' = RESTRICT,
        # 'c' = CASCADE, 'n' = SET NULL, 'd' = SET DEFAULT.
        # We require 'n' (SET NULL).
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT confdeltype FROM pg_constraint con
                JOIN pg_class rel ON rel.oid = con.conrelid
                JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY(con.conkey)
                WHERE rel.relname = 'dealership_admin_audit'
                  AND att.attname = 'admin_user_id'
                  AND con.contype = 'f'
            """)
            row = cur.fetchone()
        self.assertIsNotNone(row, "no FK on dealership_admin_audit.admin_user_id")
        self.assertEqual(row[0], 'n',
            f"expected confdeltype='n' (SET NULL); got {row[0]!r} "
            f"(NO ACTION='a', RESTRICT='r', CASCADE='c', SET DEFAULT='d')")
```

- [ ] **Step 2: Run and verify**

Run: `python -m pytest backend/test_admin_audit_fk.py -v 2>&1 | tail -10`
Expected: FAIL — current FK has no ON DELETE clause.

- [ ] **Step 3: Apply the migration**

Create `backend/migrations/2026-08-27_admin_audit_fk_on_delete.sql`:

```sql
ALTER TABLE public.dealership_admin_audit
  DROP CONSTRAINT IF EXISTS dealership_admin_audit_admin_user_id_fkey;
ALTER TABLE public.dealership_admin_audit
  ADD CONSTRAINT dealership_admin_audit_admin_user_id_fkey
  FOREIGN KEY (admin_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
```

- [ ] **Step 4: Re-run and verify**

Run: `python -m pytest backend/test_admin_audit_fk.py -v 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/migrations/2026-08-27_admin_audit_fk_on_delete.sql backend/test_admin_audit_fk.py
git commit -m "fix(schema): ON DELETE SET NULL on dealership_admin_audit.admin_user_id"
```

---

## Task 10: Move duplicate / `_FINAL` / `_v2` migrations to archive

**Files:**
- Various in `backend/migrations/` and `supabase/migrations/`

- [ ] **Step 1: Identify duplicates**

Run:
```bash
ls backend/migrations/ | grep -E "_FINAL|_v2|_v3"
ls supabase/migrations/ | grep -E "_FINAL|_v2"
```

You will see ~10-15 files (`fix_security_issues.sql` + `_FINAL` + `_v2`, `fix_performance_issues.sql` + `_FINAL` + `_v2`, multiple "complete schema" files).

- [ ] **Step 2: Confirm which is canonical**

For each duplicate pair/triple, the **latest** (highest version) is canonical. The earlier ones are superseded; safely move to `archive/`.

Cross-reference with the project owner's knowledge — if any `_FINAL` migration was meant to be the canonical (e.g. the `_FINAL` is the only one with a specific RLS change you actually need), DO NOT move it.

- [ ] **Step 3: Move superseded files**

For each superseded file (verified via git log that nothing references it):

```bash
mkdir -p backend/migrations/archive
git mv backend/migrations/fix_security_issues.sql backend/migrations/archive/
git mv backend/migrations/fix_security_issues_v2.sql backend/migrations/archive/
# Keep fix_security_issues_FINAL.sql if it is the canonical.
```

Add a `backend/migrations/archive/README.md` noting why each file was archived.

- [ ] **Step 4: Verify the project's apply-migration tooling still works**

Run: `cd backend && python apply_migration.py --check 2>&1 | tail -5`
Expected: no errors. (If your project uses a runner that explicitly looks for archived files, add an exclusion.)

- [ ] **Step 5: Commit**

```bash
git add backend/migrations/ supabase/migrations/
git commit -m "chore(migrations): archive superseded duplicate migration files"
```

---

## Out-of-plan follow-ups

1. **`user_ratings` SELECT policy tightening** — `M3`: add `ON DELETE CASCADE` on FKs and consider tighter visibility rules.
2. **`notifications` UPDATE / DELETE policies** — `M5`: enable UI mark-as-read / delete flows.
3. **`storage.objects` policies for `dealer-documents` bucket** — `M10`: add `TO authenticated` row-level policies keyed on `storage.foldername(name)`.
4. **`featured_listings` is_active generated column** — `M9`: replace post-filter with `STORED` generated column + partial index.
5. **`cars.user_id` hygiene CHECK** — `M7`: enforce non-null `user_id` when `source_platform IS NULL`.
6. **`license_plates.price` precision** — `M8`: bump to `NUMERIC(12,2)`.

These are MEDIUM-severity items in the audit; schedule in the next sprint after this plan lands.
