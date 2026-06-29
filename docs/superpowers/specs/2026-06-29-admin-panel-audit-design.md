# Admin Panel Audit — Lifecycle, Sold Status & Expiry Reason

**Date:** 2026-06-29
**Scope:** Admin mobile app (React Native). Backend Flask/Supabase.
**Status:** Approved for implementation

---

## Problem

The backend already tracks the full lifecycle of every listing:
- `sold_status` (sold_on_dph / sold_elsewhere / not_sold_renew) and when it was set
- `listing_deletion_events` with deletion reason and who triggered it (admin / user / system)
- `outbound_emails` with open/click events per email (Resend webhook fully wired)
- `renewal_nudge_sent_at`, `renewal_nudge_count`, `renewal_nudge_channels`
- `expired_at`, `retention_expires_at`, `is_archived`, `deleted_at`

None of this data surfaces in the admin UI. The listing detail screen shows only title/price/status/verify scan. There is no way for an admin to see why a listing expired, whether the owner responded to renewal prompts, or whether the owner interacted with the renewal email.

---

## Scope of Changes

| # | What | Where |
|---|------|--------|
| 1 | Lifecycle & Outcomes section in listing detail | `AdminListingDetailScreen.js` (frontend) |
| 2 | Extend listing overview endpoint with renewal emails | `backend/routes/admin.py` |
| 3 | New expired listings endpoint | `backend/routes/admin.py` |
| 4 | New AdminExpiredListingsScreen | `AdminExpiredListingsScreen.js` (new file) |
| 5 | Email tab in AdminMetricsScreen | `AdminMetricsScreen.js` |
| 6 | sold_status badge on listing cards | `AdminListingsScreen.js` |
| 7 | Navigator + dashboard wiring | `AdminNavigator.js`, `AdminDashboardScreen.js` |

---

## 1. AdminListingDetailScreen — Lifecycle & Outcomes Section

### Position
Inserted after the existing Verification Scan card, before the action buttons.

### Sub-sections (rendered in order)

#### 1a. Lifecycle Timeline
A horizontal progress strip with four milestones. Each milestone shows a label and date. The current phase is highlighted in accent colour; past phases dim; future phases are muted.

| Milestone | Field | Label |
|-----------|-------|-------|
| Created | `listing.created_at` | Created |
| Expires | `listing.expires_at` | Expires / Expired |
| Retention ends | `listing.retention_expires_at` | Retention ends |
| Archived | `listing.is_archived` or past retention | Archived |

Current phase logic (mirrors `_compute_listing_lifecycle` on backend):
- `now < expires_at` → phase = "Active"
- `now >= expires_at AND now < retention_expires_at AND NOT is_archived` → "Expired"
- `is_archived OR now >= retention_expires_at` → "Archived"
- `deleted_at IS NOT NULL` → "Deleted" (override, shown in red)

#### 1b. Sold Status Card
Rendered only when `listing.expired_at` is set or `listing.sold_status` is not null.

| sold_status value | Badge colour | Label |
|---|---|---|
| `sold_on_dph` | Green | Sold on DPH |
| `sold_elsewhere` | Amber | Sold elsewhere |
| `not_sold_renew` | Blue | Not sold — renewed |
| `null` + deadline in future | Grey | Awaiting owner response |
| `null` + deadline passed | Red | No response recorded |

Show `sold_status_set_at` date beneath the badge.
Show `sold_response_deadline` if it is in the future: "Owner deadline: {date}".

#### 1c. Renewal Nudge Card
Rendered only when `listing.renewal_nudge_count > 0`.

Displays:
- "{N} renewal nudge(s) sent" with channel icons (email / SMS / WhatsApp) from `renewal_nudge_channels`
- Last sent: `renewal_nudge_sent_at` formatted date
- Email interaction row (per renewal email in `overview.renewal_emails`):
  - "Opened" (green tick) if `opened_at IS NOT NULL`
  - "Clicked link" (green tick) if `clicked_at IS NOT NULL`
  - "Not opened" (grey) if both null
  - Show most recent renewal email's status if multiple exist

#### 1d. Deletion Timeline
Rendered only when `overview.deletion_events.length > 0`.

Chronological list (newest first). Each row:
- Icon: shield (admin) / person (user) / gear (system)
- Label: `deleted_by_role` capitalised
- Reason text: `event.reason` (truncated to 2 lines, expandable)
- Date: `event.created_at`
- If `deleted_by_role == 'admin'`: show admin user name/id in muted text beneath

### Data source
All fields come from the existing `GET /api/admin/listings/<item_type>/<item_id>/overview` response. The only addition is the new `renewal_emails` field (see Section 2). No additional fetches on the frontend.

---

## 2. Backend: Extend Listing Overview Endpoint

**File:** `flask-react-supabase-app/backend/routes/admin.py`
**Function:** `get_listing_overview`

### Change
After the existing `deletion_resp` block, add a renewal emails fetch using the same `requests.get` + `_admin_headers()` pattern as the rest of `admin.py`:

```python
# Renewal nudge emails for this listing's owner
renewal_emails = []
if listing.get("user_id"):
    renewal_email_types = "renewal_nudge,listing_expiry_reminder,listing_expiry_final,listing_expired"
    try:
        email_resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/outbound_emails",
            headers=_admin_headers(),
            params={
                "select": "id,email_type,sent_at,delivered_at,opened_at,clicked_at,open_count,click_count,subject,error_message",
                "user_id": f"eq.{listing['user_id']}",
                "email_type": f"in.({renewal_email_types})",
                "order": "sent_at.desc",
                "limit": "20",
            },
            timeout=10,
        )
        if email_resp.status_code == 200:
            renewal_emails = email_resp.json() or []
    except Exception:
        pass  # best-effort — missing table or network error does not 500
```

Add to the `jsonify({...})` return dict:
```python
"renewal_emails": renewal_emails,
```

### Notes
- Uses `requests.get` + `_admin_headers()` — matches every other Supabase REST call in `admin.py`.
- `email_type` values match the strings logged by `_log_email_event` in `app.py` (e.g. `"renewal_nudge"`, `"listing_expiry_reminder"`).
- Wrapped in try/except so a missing `outbound_emails` table returns `[]` without breaking the overview endpoint.

---

## 3. Backend: New Expired Listings Endpoint

**File:** `flask-react-supabase-app/backend/routes/admin.py`
**Route:** `GET /api/admin/expired-listings`
**Auth:** `@admin_required`

### Query parameters

| Param | Default | Values |
|-------|---------|--------|
| `type` | `all` | `all`, `cars`, `bikes`, `parts`, `plates` |
| `reason` | `all` | `all`, `auto_expired`, `user_deleted`, `admin_deleted`, `sold_on_dph`, `sold_elsewhere`, `no_response` |
| `days` | `30` | 1–365 |
| `limit` | `50` | max 200 |
| `offset` | `0` | |

### Logic (no N+1 fetches)

**Step 1 — Determine tables to query**
If `type == 'all'`, query all four tables: `cars`, `bikes`, `car_parts`, `license_plates`.
Otherwise map to the single table via `_admin_listing_config`.

**Step 2 — Fetch expired/deleted listings from each table**
For each table, fetch rows where:
```
(status = 'deleted' OR status = 'expired' OR status = 'archived'
 OR deleted_at IS NOT NULL OR is_archived = true)
AND (deleted_at >= cutoff OR expired_at >= cutoff OR updated_at >= cutoff)
```
Select: `id, status, sold_status, sold_status_set_at, sold_response_deadline, deleted_at, expired_at, retention_expires_at, is_archived, renewal_nudge_count, renewal_nudge_sent_at, user_id` + title fields (make/model or part_type or city/code etc.).

**Step 3 — Batch fetch deletion events**
Collect all `listing_id` values. One query to `listing_deletion_events` with `listing_id=in.(id1,id2,...)`. Build a dict keyed by `listing_id`.

**Step 4 — Batch fetch email interactions**
Collect all `user_id` values (deduplicated). One query to `outbound_emails`:
```
user_id=in.(uid1,uid2,...)
email_type=in.(renewal_nudge,listing_expiry_reminder,listing_expiry_final,listing_expired)
select=user_id,opened_at,clicked_at
```
Build a set of user_ids that have `opened_at IS NOT NULL OR clicked_at IS NOT NULL`.

**Step 5 — Compute `expiry_reason` per listing**
```
deletion_event = deletion_events_by_listing_id.get(listing.id)

if deletion_event:
    role = deletion_event.deleted_by_role
    if role == 'admin':
        reason = "Admin deleted"
        reason_detail = deletion_event.reason
    elif role == 'user':
        reason = "User deleted"
        reason_detail = None
    elif listing.is_archived:
        reason = "Auto-removed (past retention)"
        reason_detail = None
    else:
        reason = "Auto-expired"
        reason_detail = None
else:
    if listing.sold_status == 'sold_on_dph':
        reason = "Sold on DPH"
    elif listing.sold_status == 'sold_elsewhere':
        reason = "Sold elsewhere"
    elif listing.sold_status == 'not_sold_renew':
        reason = "Renewed (not sold)"
    else:
        reason = "Expired — no response"
    reason_detail = None
```

**Step 6 — Apply `reason` filter** (if param != `all`)

| Param value | Keep rows where |
|-------------|-----------------|
| `auto_expired` | reason == "Auto-expired" OR "Auto-removed (past retention)" |
| `user_deleted` | reason == "User deleted" |
| `admin_deleted` | reason == "Admin deleted" |
| `sold_on_dph` | reason == "Sold on DPH" |
| `sold_elsewhere` | reason == "Sold elsewhere" |
| `no_response` | reason == "Expired — no response" |

**Step 7 — Return**
```json
{
  "listings": [
    {
      "id": "...",
      "listing_type": "cars",
      "title": "BMW 3 Series",
      "price": 95000,
      "image_url": "...",
      "expiry_reason": "Admin deleted",
      "reason_detail": "Spam listing",
      "sold_status": null,
      "sold_status_set_at": null,
      "email_interacted": true,
      "renewal_nudge_count": 2,
      "renewal_nudge_sent_at": "2026-06-20T10:00:00Z",
      "deleted_at": "2026-06-21T09:00:00Z",
      "expired_at": "2026-06-15T00:00:00Z",
      "user_id": "..."
    }
  ],
  "total": 142,
  "has_more": true
}
```

### Caching
Cache with `_api_cache_get`/`_api_cache_set` keyed on all params, TTL 120 seconds (same pattern as other admin list endpoints).

---

## 4. New AdminExpiredListingsScreen

**File:** `flask-react-supabase-app/mobile/src/screens/admin/AdminExpiredListingsScreen.js`

### Layout

```
SafeAreaView
  Header: "Expired & Deleted"
  Filter row 1 (horizontal scroll): Type tabs — All | Cars | Bikes | Parts | Plates
  Filter row 2 (horizontal scroll): Reason chips — All | Auto-expired | User deleted |
                                     Admin deleted | Sold on DPH | Sold elsewhere | No response
  Day window row: 7d | 30d | 90d
  FlashList (estimatedItemSize=100)
    ExpiredListingCard (per item)
  Footer: load-more button if has_more
```

### ExpiredListingCard

Each card shows:
- Thumbnail (60×60) or placeholder icon
- Title (1 line, bold)
- Price (accent colour)
- `expiry_reason` badge:

| Reason | Colour |
|--------|--------|
| Sold on DPH | Green |
| Sold elsewhere | Amber |
| Renewed (not sold) | Blue |
| User deleted | Grey |
| Admin deleted | Red |
| Auto-expired | Orange |
| Auto-removed (past retention) | Deep orange |
| Expired — no response | Muted red |

- If `email_interacted`: small envelope-open icon (green) — "Email opened/clicked"
- If `renewal_nudge_count > 0` and NOT `email_interacted`: envelope icon with "×{N} sent, not opened"
- Date: `deleted_at || expired_at` formatted

Tap → navigate to `AdminListingDetailScreen` with `{ itemType, itemId }`.

### State
```js
const [listings, setListings] = useState([]);
const [loading, setLoading] = useState(true);
const [refreshing, setRefreshing] = useState(false);
const [typeFilter, setTypeFilter] = useState('all');
const [reasonFilter, setReasonFilter] = useState('all');
const [days, setDays] = useState(30);
const [offset, setOffset] = useState(0);
const [hasMore, setHasMore] = useState(false);
```

Reload when any filter/days changes (reset offset to 0).
Pull-to-refresh resets offset and reloads.
Load-more appends to existing list.

### API call
```js
apiClient.get('/api/admin/expired-listings', {
  params: { type: typeFilter, reason: reasonFilter, days, limit: 50, offset }
})
```

---

## 5. Email Tab in AdminMetricsScreen

**File:** `flask-react-supabase-app/mobile/src/screens/admin/AdminMetricsScreen.js`

### Change
Add `"Email"` to the section structure. This is not a separate tab navigator — it is a new `SectionHeader` + content block appended to the existing ScrollView, consistent with the existing "Car Metrics" and "Plate Metrics" sections.

### Data
New state: `const [emailMetrics, setEmailMetrics] = useState(null);`
New load call alongside `loadMetrics()`:
```js
const loadEmailMetrics = async () => {
  try {
    const data = await apiClient.get(`/api/admin/metrics/email?days=${days}`);
    setEmailMetrics(data || null);
  } catch { setEmailMetrics(null); }
};
```
Call `loadEmailMetrics()` in the same `useEffect` as `loadMetrics`.

### Display (new section at bottom of ScrollView)

```
SectionHeader label="EMAIL" title="Outbound email delivery & engagement"

Summary surface:
  MetricRow "Sent"       → emailMetrics.summary.total_sent
  MetricRow "Delivered"  → emailMetrics.summary.total_delivered  (+ delivery rate %)
  MetricRow "Opened"     → emailMetrics.summary.total_opened     (+ open rate %)
  MetricRow "Clicked"    → emailMetrics.summary.total_clicked    (+ click rate %)
  MetricRow "Bounced"    → emailMetrics.summary.total_bounced
  MetricRow "Unsubscribed" → emailMetrics.summary.total_unsubscribed

Sub-section "By Email Type"
  BarChart items={emailMetrics.by_type} labelKey="email_type" valueKey="sent"

Sub-section "Daily Sends"
  BarChart items={emailMetrics.daily} labelKey="date" valueKey="sent"
```

If `emailMetrics` is null or has `error` key, show a muted "Email metrics unavailable — run the outbound_emails migration." message.

---

## 6. sold_status Badge on AdminListingsScreen Cards

**File:** `flask-react-supabase-app/mobile/src/screens/admin/AdminListingsScreen.js`
**Component:** `AdminListingCard`

### Change
In the `cardMeta` View (already contains the status badge and date), add a second pill when `item.sold_status` is set:

| sold_status | Pill text | Colour |
|-------------|-----------|--------|
| `sold_on_dph` | Sold DPH | Green |
| `sold_elsewhere` | Sold elsewhere | Amber |
| `not_sold_renew` | Renewed | Blue |

Render after the existing status badge, same pill style. No layout changes needed — `cardMeta` is already a flex row.

### Data availability
The existing `GET /api/admin/listings` endpoint selects `*` from each table, so `sold_status` is already in the response. No backend change needed.

---

## 7. Navigator & Dashboard Wiring

### AdminNavigator
**File:** find the navigator file (likely `src/navigation/AdminNavigator.js` or similar).

Add stack entry:
```js
<Stack.Screen
  name="AdminExpiredListings"
  component={AdminExpiredListingsScreen}
  options={{ headerShown: false }}
/>
```

Import `AdminExpiredListingsScreen` at the top.

### AdminDashboardScreen
**File:** `flask-react-supabase-app/mobile/src/screens/admin/AdminDashboardScreen.js`

Add an "Expired" count to the inbox row alongside Pending Approvals / Open Reports / Dealer Reviews.

The dashboard already calls a summary endpoint. Determine whether expired count needs a new endpoint field or can be derived from existing data.

If the dashboard's existing summary endpoint (`/api/admin/dashboard` or similar) already returns total expired count — use it directly. If not, add it to that endpoint's response (single `COUNT(*)` query on cars+bikes+parts+plates where `status = 'expired' AND deleted_at IS NULL`).

Dashboard inbox item: label "Expired", count from above, tap → navigate to `AdminExpiredListings`.

---

## Data Flow Summary

```
AdminListingDetailScreen
  └── GET /api/admin/listings/{type}/{id}/overview
        └── returns: listing (with sold_status, lifecycle fields, renewal_nudge_*)
                     deletion_events[]
                     renewal_emails[]   ← NEW
                     lead_events[]
                     reports[]

AdminExpiredListingsScreen
  └── GET /api/admin/expired-listings?type=&reason=&days=&limit=&offset=
        └── backend joins: listings + listing_deletion_events + outbound_emails
        └── returns: listings[] with expiry_reason, email_interacted, sold_status

AdminMetricsScreen
  └── GET /api/admin/metrics/email?days=   ← already exists, now wired in UI

AdminListingsScreen (cards)
  └── existing GET /api/admin/listings — sold_status already in response, now displayed
```

---

## What is NOT changing

- The `listing_deletion_events` schema — already correct
- The `outbound_emails` schema — already correct, Resend webhook already wired
- The sold_status workflow (backend `app.py`) — already correct
- The renewal nudge send endpoint — already correct
- The listing overview endpoint response shape (adding one field only)

---

## Exact Files to Create or Modify

| File | Action | What changes |
|------|--------|--------------|
| `backend/routes/admin.py` | Modify | Add `renewal_emails` fetch in `get_listing_overview`; add new `expired_listings` route |
| `mobile/src/screens/admin/AdminListingDetailScreen.js` | Modify | Add Lifecycle, Sold Status, Renewal Nudge, Deletion Timeline sections |
| `mobile/src/screens/admin/AdminListingsScreen.js` | Modify | Add sold_status pill to `AdminListingCard` |
| `mobile/src/screens/admin/AdminMetricsScreen.js` | Modify | Add email metrics section + `loadEmailMetrics` call |
| `mobile/src/screens/admin/AdminExpiredListingsScreen.js` | Create | Full new screen |
| `mobile/src/navigation/AdminNavigator.js` (or equivalent) | Modify | Register `AdminExpiredListings` route |
| `mobile/src/screens/admin/AdminDashboardScreen.js` | Modify | Add Expired inbox item + navigation |
