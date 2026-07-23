# Normalized Contact and VIN Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate VIN reveals from contact leads and deliver normalized, drillable admin analytics.

**Architecture:** A small backend service converts canonical and historical event rows into a single normalized reporting model. New admin endpoints expose summary and VIN drill-down data; the existing dashboard consumes those explicit fields rather than mixing stats and legacy lead totals.

**Tech Stack:** Flask, Supabase/PostgREST, Python unit tests, React, React Native.

## Global Constraints

- Qualified lead identity is `(actor, listing_type, listing_id)` with a rolling 24-hour window across Call and WhatsApp.
- VIN opens and reveals must never contribute to qualified lead totals.
- Canonical `platform_events` is used at/after `2026-07-20T00:00:00Z`; legacy `lead_events` is used only before it.
- Admin detail output must not expose email, phone, IP address, or user-agent.

---

### Task 1: Normalized analytics service

**Files:**
- Create: `backend/services/contact_analytics.py`
- Test: `backend/test_contact_analytics.py`

**Interfaces:**
- Produces `build_contact_analytics(platform_events, lead_events, days, now)` and `build_vin_listing_activity(events, listing_type, listing_id)`.

- [ ] **Step 1: Write failing tests** for VIN exclusion, cross-channel dedupe, and 24-hour rollover.
- [ ] **Step 2: Run** `pytest -q test_contact_analytics.py` and confirm the tests fail because the service is absent.
- [ ] **Step 3: Implement** canonical/legacy cutover filtering, actor identity resolution, lead-window grouping, per-channel totals, and VIN listing aggregation.
- [ ] **Step 4: Run** `pytest -q test_contact_analytics.py` and confirm all tests pass.

### Task 2: Admin reporting endpoints

**Files:**
- Modify: `backend/app.py`
- Test: `backend/test_admin_contact_analytics.py`

**Interfaces:**
- Consumes `build_contact_analytics`.
- Produces `GET /api/admin/contact-analytics` and `GET /api/admin/contact-analytics/vin-listings/<type>/<id>`.

- [ ] **Step 1: Write failing route tests** for authorization, summary fields, listing ranking, and safe actor details.
- [ ] **Step 2: Run** `pytest -q test_admin_contact_analytics.py` and confirm the routes do not exist.
- [ ] **Step 3: Implement** bounded event fetches, admin authorization, safe enrichment, and cache keys scoped by date range.
- [ ] **Step 4: Run** `pytest -q test_admin_contact_analytics.py` and confirm all tests pass.

### Task 3: Web admin cards and VIN drill-down

**Files:**
- Modify: `frontend/src/components/AdminDashboard.js`
- Create: `frontend/src/components/admin/VinRevealAnalyticsModal.jsx`
- Test: `frontend/src/components/admin/VinRevealAnalyticsModal.test.jsx`

**Interfaces:**
- Consumes `/api/admin/contact-analytics` and VIN detail endpoints.

- [ ] **Step 1: Write failing UI tests** for separate cards and selected-listing reveal activity.
- [ ] **Step 2: Run** the focused frontend test and confirm it fails.
- [ ] **Step 3: Implement** explicit summary cards and modal drill-down without fallback metric substitution.
- [ ] **Step 4: Run** the focused frontend test and production build.

### Task 4: Mobile parity and regression verification

**Files:**
- Modify: `mobile/src/screens/admin/AdminDashboardScreen.js`
- Test: `mobile/src/screens/admin/__tests__/AdminDashboardScreen.test.js`

- [ ] **Step 1: Write failing mobile tests** for separate VIN and lead totals.
- [ ] **Step 2: Run** the focused Jest test and confirm it fails.
- [ ] **Step 3: Implement** explicit metric fields and VIN listing navigation or modal parity.
- [ ] **Step 4: Run** backend analytics tests, focused web/mobile tests, and the applicable builds.
