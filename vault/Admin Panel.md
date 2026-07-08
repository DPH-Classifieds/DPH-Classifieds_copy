# Admin Panel

Route prefix: `/admin/*`  
All routes are behind `is_admin` check.

## Sidebar sections

| Link | Route | Component |
|------|-------|-----------|
| Dashboard | `/admin` | `AdminMetrics.js` |
| Listings | `/admin/listings` | `AdminListings.js` |
| Users | `/admin/users` | `AdminUsers.js` |
| Tools | `/admin/tools` | `AdminTools.js` |

## AdminListings

- Filters by type (cars/bikes/plates/parts/drafts/buying_requests) and status
- `pending_auto_review` listings show as amber "Auto Review" badge, sort rank 0 (same as `pending`)
- **Run Auto-Review** button in header — calls `POST /api/admin/auto-review/run`, refreshes list
- Bulk actions: approve, reject, delete, renew, restore

## AdminListingDetail

Opens on any listing. Shows:
- KPI tiles (views, leads, days listed, reports)
- **Auto-review panel** (amber banner) — appears when `status = pending_auto_review` OR `auto_review_state = auto_queued`
  - Shows each failure reason with a human-readable label and action hint
  - "Run Auto-Review Now" button — reloads the listing after running
- Gallery, listing metadata
- Owner info
- Engagement events
- Moderation actions (approve, reject, delete, mark sold, set expiry)

## AdminTools

### Auto Review section
- Toggle switch — writes `ar:enabled` to Redis (`1`/`0`)
- Run Now button — `POST /api/admin/auto-review/run`

### Cache section
- Flush listing cache — `POST /api/admin/cache/flush`

### Account section
- Refresh user status — force re-sync with Supabase
- Claim admin — `POST /api/auth/make-admin`

## AdminMetrics

Tracks: listing counts, approval rates, lead events, email opens.  
**Email tab** shows email_events (open, click, bounce) for reminder and notification emails.

## Key backend endpoints

```
GET  /api/admin/listings-search          Unified listing search
GET  /api/admin/listings/{type}/{id}/overview
POST /api/admin/auto-review/run          Force-run worker (bypasses toggle)
GET  /api/admin/auto-review/settings     Get toggle state
PATCH /api/admin/auto-review/settings    Set toggle (Redis)
POST /api/admin/cache/flush
POST /api/auth/make-admin
```
