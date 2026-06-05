# Phase 2 — Manual Smoke Test

Before declaring Phase 2 "done", apply the migration and run this checklist. Everything else (tables, route handlers, worker, frontend) is verified by the unit + integration tests in this branch.

## 1. Apply the migration

In Supabase SQL Editor, paste and run the contents of:

```
backend/migrations/2026_06_05_dealer_leads.sql
```

Expected notice at the end: `✅ dealer_leads + dealer_lead_events + cursor created with RLS`.

Verify:

```sql
SELECT count(*) FROM public.dealer_leads;                       -- 0
SELECT * FROM public.dealer_lead_aggregator_cursor;             -- one row, last_processed_at ≈ now() - 7d
```

## 2. Seed a fake `lead_events` row against any dealer-owned listing

Replace the placeholders with real IDs from your data:

```sql
INSERT INTO public.lead_events
  (listing_id, listing_type, action, ip_address, user_agent, payload, dealership_id, created_at)
VALUES
  ('<some_car_id>', 'car', 'call_click', '203.0.113.7', 'curl/8.0',
   '{"visitor_id":"smoke-v1"}'::jsonb, '<your_dealership_id>', now());
```

## 3. Run one aggregator tick locally

```bash
cd flask-react-supabase-app/backend
ENABLE_DEALER_PANEL=true python -m workers.dealer_lead_aggregator
```

Expected log line: `dealer_lead_aggregator: inserted=1` (or 0 if the visitor already has a matching open lead within the window).

Verify in SQL:

```sql
SELECT id, dealership_id, listing_id, source, status, event_count, first_event_at, last_event_at
  FROM public.dealer_leads ORDER BY created_at DESC LIMIT 5;

SELECT lead_id, kind, payload, created_at
  FROM public.dealer_lead_events ORDER BY created_at DESC LIMIT 5;
```

## 4. UI smoke

Sign in as the dealership owner, open `/dealer/leads`. Confirm:

- [ ] Lead row appears with the seeded source (`call`)
- [ ] Clicking the row opens `/dealer/leads/<id>` and shows the listing card, timeline with one `inbound_contact` event, and the visitor session list (if `platform_events` exist for `smoke-v1`)
- [ ] Status dropdown moves the lead to `contacted` and a `status_change` event appears
- [ ] Adding a note creates a `note` event
- [ ] Won → sale-price input appears; Lost → lost-reason dropdown appears

## 5. Realtime smoke

With the inbox open in browser tab A, run the SQL `INSERT` again with a different `visitor_id`, then run the aggregator. Expected: tab A prepends the new row and shows the green toast at the bottom-right.

## 6. Role gating smoke

- As a `sales_rep` member, PATCH a lead not assigned to them: expect 403.
- As an admin acting-as the dealership (`?as=<id>`), PATCH any lead: expect 200 and a row in `dealer_admin_audit`.

## 7. Done

If all six pass, merge the branch. If any fail, file a follow-up in `docs/superpowers/plans/` rather than patching this branch in place.
