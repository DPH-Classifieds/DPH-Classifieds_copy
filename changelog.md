# Changelog

## 2026-06-18

### User Listing Flows
- Added backend-backed draft saving for bikes, license plates, and car parts through `/api/user/drafts/<draft_key>`, with local browser fallback for temporary API outages.
- Added "Save Draft" actions to the bike, plate, and car-part selling pages, including restore-on-return and cleanup after successful submission.
- Normalized draft payload handling so older `draft_payload` rows and newer `payload` rows both load in My Listings and admin views.
- Fixed draft classification in My Listings so pending moderation listings no longer appear as drafts; only real draft states show as drafts.
- Kept the car listing flow intact and retained the safer image replacement path that inserts replacement images before deleting old ones.

### Saved Searches
- Added `saved_searches` persistence, user APIs, and admin tracking for unique searches.
- Added the Explore "Save Search" action for authenticated users with query/category/filter/result-count capture.
- Added admin stats for total saved searches and saved searches in the selected reporting window.

### Account Deletion
- Added secured account deletion at `/api/user/delete-account`.
- Account deletion now soft-deletes owned cars, bikes, parts, and plates, removes user-scoped saved listings/drafts/searches/notifications/follower rows, deletes the public profile row, and deletes the Supabase Auth user with the service role.
- Updated account settings error handling so backend deletion errors are displayed correctly.

### Listing Lifecycle And Admin Tracking
- Added admin lifecycle totals for active, draft, expired, sold on DPH, sold elsewhere, deleted, and pending listings across cars, bikes, parts, and plates.
- Added dashboard cards for active listing views, saved searches, active listings, drafts, expired listings, and sold listing outcomes.
- Fixed admin moderation dashboard links to use the actual `types` and `statuses` query parameters consumed by the admin listings page.
- Adjusted expired-listing renewal/outcome handling so moving an expired listing to draft stays draft in both user and admin surfaces instead of reverting to pending.

### Performance Guardrails
- Saved searches, reminder queues, and draft lookups are indexed/keyed so new user actions do not add full-table scans.
- Explore saves the current search only when the user clicks "Save Search"; it does not add an automatic request to every search/filter change.
- Admin lifecycle counts run through the existing cached `/api/admin/stats` path instead of adding a separate dashboard-wide scan.

### Automated Emails
- Added worker jobs for draft reminder emails after 24 hours and saved-car reminder emails after 24 hours.
- Added claim/sent/error columns so reminder jobs are idempotent and do not repeatedly email the same row.
- Added optional worker interval env vars: `DRAFT_REMINDER_INTERVAL_SECONDS` and `SAVED_CAR_REMINDER_INTERVAL_SECONDS`.

### OCR And Deployment Readiness
- Verified the registration OCR route remains registered and covered by multipart/PDF tests.
- Confirmed Railway deployment already installs OCR runtime dependencies through `nixpacks.toml`, including Tesseract.
- Added Supabase migration coverage for saved searches and reminder-email metadata.

### Supabase Migration Required
- Apply `flask-react-supabase-app/backend/migrations/add_listing_drafts.sql` so `listing_drafts` has both `payload` and `draft_payload` compatibility columns plus reminder metadata.
- Apply `flask-react-supabase-app/backend/migrations/add_saved_searches_and_reminders_20260618.sql` to create `saved_searches` and add reminder tracking columns to `saved_listings` and `listing_drafts`.

### Verification
- Passed: `cd flask-react-supabase-app/backend && ./.venv/bin/python -m unittest test_user_flow_contracts test_drafts_admin test_registration_ocr test_listing_lifecycle.ListingOutcomeTransitionTests test_direct_upload_migration.UpdateCarJsonImagesTests -v`
- Passed: `cd flask-react-supabase-app/backend && ./.venv/bin/python -m py_compile app.py worker.py routes/ocr.py services/registration_ocr.py`
- Passed: `cd flask-react-supabase-app/frontend && npm run build`
- Broad check: `cd flask-react-supabase-app/backend && ./.venv/bin/python -m unittest discover -v` still fails legacy/static tests unrelated to this slice: dealer-document tests expecting old `company-documents`/`companyDocuments` names while the app uses `dealer-documents`/`dealerDocuments`, one rejection-constant static test, and one stale sitemap fixture dated before the current listing expiry window.
- Local environment note: `cryptography>=43,<46` is declared in `backend/requirements.txt`; it was missing from the local `.venv` and was installed before the final broad discovery rerun.
