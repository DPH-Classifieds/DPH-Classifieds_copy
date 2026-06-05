# Phase 3 — Manual Smoke Test

After merging Phase 3, walk this checklist before declaring the slice live.
Everything that can be unit-tested is already green on this branch; this
covers the things that need real Supabase + a real dealership login.

## 1. Apply the migration

In Supabase SQL Editor, paste and run the contents of:

```
backend/migrations/2026_06_05_dealer_inventory.sql
```

Expected notice at the end: `✅ Phase 3 inventory tables + cars.external_id created`.

Verify:

```sql
SELECT count(*) FROM public.dealer_inventory_jobs;     -- 0
SELECT count(*) FROM public.dealer_inventory_row_errors; -- 0
SELECT count(*) FROM public.dealer_api_sources;        -- 0
-- cars.external_id column exists:
SELECT column_name FROM information_schema.columns
 WHERE table_schema='public' AND table_name='cars' AND column_name='external_id';
```

## 2. Create the `dealer-imports` storage bucket

In the Supabase Dashboard → Storage:

1. Create a new bucket named `dealer-imports`.
2. Set as **private** (not public).
3. Max file size: 10 MB.
4. Add this storage policy on `storage.objects` so only the service role can
   read/write under this bucket (we always go through the backend):

```sql
-- Service role bypasses RLS, so this is mostly defense-in-depth.
DROP POLICY IF EXISTS "dealer_imports_service_all" ON storage.objects;
CREATE POLICY "dealer_imports_service_all" ON storage.objects FOR ALL
USING (bucket_id = 'dealer-imports')
WITH CHECK (bucket_id = 'dealer-imports');
```

## 3. Set the encryption key

DMS credentials are envelope-encrypted with Fernet. Generate one key per
environment (local and production) and set it as `DEALER_INTEGRATIONS_KEY`:

```bash
python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'
```

Set in `.env`, Railway, Vercel, etc. **If unset, `/api/dealer/api-sources` POST
returns 503 `encryption_unavailable`** — by design.

## 4. CSV import smoke

1. Sign in as a verified dealership owner.
2. Navigate to `/dealer/inventory`.
3. Drag-drop or pick a small CSV. Suggested test content:

   ```csv
   external_id,make,model,year,price,mileage
   S1,Toyota,Camry,2020,60000,45000
   S2,Honda,Civic,2019,40000,72000
   S3,Nissan,Patrol,2021,180000,18000
   ```

4. In the mapping step, confirm each column maps to its canonical name
   (the wizard pre-populates when the header matches a canonical field).
5. Click "Start import". Watch the job advance from `queued → running →
   succeeded` (the worker ticks every 10 s by default).
6. Verify 3 cars now exist for the dealership:

   ```sql
   SELECT id, external_id, make, car_model, make_year, expected_selling_price
     FROM public.cars
    WHERE dealership_id = '<your_dealership_id>'
    ORDER BY created_at DESC LIMIT 5;
   ```

## 5. Re-import (upsert) smoke

Edit the CSV — bump `S1`'s `price` to `55000` — re-upload. Confirm that:

- A new job is created.
- The car with `external_id='S1'` was UPDATED (not duplicated).
- `dealer_inventory_jobs.rows_updated` shows 1.

## 6. Partial-failure smoke

Upload a CSV with one bad row, e.g.:

```csv
external_id,make,model,year,price
S4,Toyota,Highlander,2022,90000
S5,Toyota,,2022,not-a-number
```

Confirm:
- Job status `partial`.
- 1 row in `dealer_inventory_row_errors` for the bad row.
- The good row landed in `cars`.

## 7. CSV export smoke

Hit `/api/dealer/inventory/export.csv` from the browser (signed in as
owner/manager). Confirm:
- Downloads as `dealership-inventory.csv`.
- Has the canonical column header row.
- One row per listing.

## 8. DMS source smoke (generic_json)

For a quick test endpoint, you can use https://api.npoint.io to host a
small JSON document. Create one with content like:

```json
[
  {"sku": "DMS-1", "make": "Toyota", "model": "Land Cruiser", "year": "2023", "price": "250000"},
  {"sku": "DMS-2", "make": "Lexus",  "model": "LX",            "year": "2022", "price": "300000"}
]
```

In `/dealer/integrations`:

1. Click "Add source".
2. Fill: label `npoint-test`, endpoint_url `<your npoint url>`, auth_type `none`, field_mapping `{"sku": "external_id", "make": "make", "model": "model", "year": "year", "price": "price"}`, poll_interval_min `5`.
3. Save. The row appears in the table.
4. Click **Test** — should show "rows_seen: 2, rows_valid: 2".
5. Wait one poll cycle (≤ 60 s). `last_pulled_at` and `last_status=ok`
   should update via realtime.
6. Verify the two cars now exist under the dealership.

## 9. Role gating smoke

- As a `sales_rep` member of the dealership, try to POST to
  `/api/dealer/inventory/imports` → expect 403.
- As an admin acting-as the dealership (`?as=<id>`), import a CSV → expect
  201 and a `dealer_admin_audit` row.

## 10. Done

If everything passes, mark the PR merged. If anything fails, file a
follow-up plan rather than patching the merged branch.
