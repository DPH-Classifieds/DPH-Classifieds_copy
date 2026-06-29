# Admin Panel Audit — Lifecycle, Sold Status & Expiry Reasons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface all existing lifecycle data (sold_status, deletion events, renewal email open/clicks, expiry reasons) in the admin UI across the listing detail screen, a new expired listings screen, metrics, and listing cards.

**Architecture:** Backend adds one new route (`GET /api/admin/expired-listings`) and extends the existing listing overview endpoint with `renewal_emails`. Frontend adds a Lifecycle & Outcomes section to the detail screen, a new AdminExpiredListingsScreen, an email metrics section, a sold_status pill on list cards, and a dashboard inbox entry — all wiring to data the backend already tracks.

**Tech Stack:** Flask + Supabase REST (Python, `requests`), React Native (Expo), FlashList, Ionicons, existing `apiClient`, `COLORS/SPACING/BORDER_RADIUS/FONT_SIZES` theme constants.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `backend/routes/admin.py` | Modify ×2 | (1) Add `renewal_emails` to `get_listing_overview`; (2) New `GET /api/admin/expired-listings` route |
| `mobile/src/screens/admin/AdminListingDetailScreen.js` | Modify | Add Lifecycle Timeline, Sold Status, Renewal Nudge, Deletion Timeline sections |
| `mobile/src/screens/admin/AdminListingsScreen.js` | Modify | Add sold_status pill to `AdminListingCard` |
| `mobile/src/screens/admin/AdminMetricsScreen.js` | Modify | Add email metrics section + `loadEmailMetrics()` |
| `mobile/src/screens/admin/AdminExpiredListingsScreen.js` | Create | Full new screen with type/reason/days filters |
| `mobile/src/navigation/AppNavigator.js` | Modify | Register `AdminExpiredListings` route |
| `mobile/src/screens/admin/AdminDashboardScreen.js` | Modify | Add Expired inbox card |

---

## Task 1: Backend — Extend listing overview with renewal_emails

**Files:**
- Modify: `flask-react-supabase-app/backend/routes/admin.py` — function `get_listing_overview` (~line 1967)
- Test: `flask-react-supabase-app/backend/test_admin_listing_overview_emails.py` (create)

- [ ] **Step 1: Write the failing test**

Create `flask-react-supabase-app/backend/test_admin_listing_overview_emails.py`:

```python
"""Test that listing overview returns renewal_emails field."""
import sys
import pytest
from unittest.mock import patch, MagicMock


def _make_response(data, status=200):
    m = MagicMock()
    m.status_code = status
    m.json.return_value = data
    m.headers = {}
    return m


@pytest.fixture(scope="module")
def client():
    def _fake_admin_required(fn):
        from functools import wraps
        @wraps(fn)
        def wrapper(*args, **kwargs):
            return fn(*args, **kwargs)
        return wrapper

    with patch("routes.admin.admin_required", _fake_admin_required):
        for mod in list(sys.modules.keys()):
            if "routes.admin" in mod:
                del sys.modules[mod]
        import app as _app
        _app.app.config["TESTING"] = True
        yield _app.app.test_client()


def test_overview_includes_renewal_emails_field(client):
    """GET /api/admin/listings/cars/123/overview returns renewal_emails key."""
    listing_row = {
        "id": "123", "user_id": "u1", "status": "expired",
        "sold_status": None, "expired_at": "2026-06-20T00:00:00Z",
        "renewal_nudge_count": 1, "renewal_nudge_sent_at": "2026-06-19T00:00:00Z",
    }
    email_rows = [
        {"id": "e1", "email_type": "renewal_nudge", "sent_at": "2026-06-19T00:00:00Z",
         "opened_at": "2026-06-19T05:00:00Z", "clicked_at": None, "open_count": 1,
         "click_count": 0, "subject": "Renew your listing", "delivered_at": None,
         "error_message": None}
    ]

    def fake_get(url, **kwargs):
        if "outbound_emails" in url:
            return _make_response(email_rows)
        if "listing_deletion_events" in url:
            return _make_response([])
        if "lead_events" in url:
            return _make_response([])
        if "reports" in url:
            return _make_response([])
        if "/cars" in url and "id=eq.123" in (kwargs.get("params", {}).get("id", "") or ""):
            return _make_response([listing_row])
        return _make_response([])

    with patch("routes.admin.requests.get", side_effect=fake_get):
        resp = client.get("/api/admin/listings/cars/123/overview")

    assert resp.status_code == 200
    data = resp.get_json()
    assert "renewal_emails" in data, "renewal_emails key must be present"
    assert len(data["renewal_emails"]) == 1
    assert data["renewal_emails"][0]["email_type"] == "renewal_nudge"
    assert data["renewal_emails"][0]["opened_at"] == "2026-06-19T05:00:00Z"


def test_overview_renewal_emails_empty_when_no_user_id(client):
    """If listing has no user_id, renewal_emails must be []."""
    listing_row = {
        "id": "999", "user_id": None, "status": "deleted",
        "renewal_nudge_count": 0,
    }

    def fake_get(url, **kwargs):
        if "/cars" in url:
            return _make_response([listing_row])
        return _make_response([])

    with patch("routes.admin.requests.get", side_effect=fake_get):
        resp = client.get("/api/admin/listings/cars/999/overview")

    assert resp.status_code == 200
    data = resp.get_json()
    assert data.get("renewal_emails") == []
```

- [ ] **Step 2: Run to confirm it fails**

```bash
cd flask-react-supabase-app/backend
python -m pytest test_admin_listing_overview_emails.py -v 2>&1 | tail -20
```

Expected: FAIL — `renewal_emails` key not in response.

- [ ] **Step 3: Add renewal_emails fetch to get_listing_overview**

In `flask-react-supabase-app/backend/routes/admin.py`, find `get_listing_overview` (around line 1967). Locate the block that ends with:

```python
        deletion_rows = deletion_resp.json() if deletion_resp.status_code == 200 else []

        lead_rows = _admin_enrich_activity_rows(lead_rows, "user_id")
```

Insert the following block **between** those two lines (after `deletion_rows = ...`, before `lead_rows = _admin_enrich_activity_rows`):

```python
        # Renewal nudge emails sent to this listing's owner
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
                pass  # best-effort — missing table or network error does not break overview
```

Then in the `return jsonify({...})` block at the end of the function, add `"renewal_emails": renewal_emails,` after `"deletion_events": deletion_rows or [],`:

```python
                "deletion_events": deletion_rows or [],
                "renewal_emails": renewal_emails,
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd flask-react-supabase-app/backend
python -m pytest test_admin_listing_overview_emails.py -v 2>&1 | tail -20
```

Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add flask-react-supabase-app/backend/routes/admin.py \
        flask-react-supabase-app/backend/test_admin_listing_overview_emails.py
git commit -m "feat(admin): add renewal_emails to listing overview endpoint"
```

---

## Task 2: Backend — New expired-listings endpoint

**Files:**
- Modify: `flask-react-supabase-app/backend/routes/admin.py` — add new route after existing listing routes
- Test: `flask-react-supabase-app/backend/test_admin_expired_listings.py` (create)

- [ ] **Step 1: Write the failing test**

Create `flask-react-supabase-app/backend/test_admin_expired_listings.py`:

```python
"""Tests for GET /api/admin/expired-listings endpoint."""
import sys
import pytest
from unittest.mock import patch, MagicMock


def _make_response(data, status=200):
    m = MagicMock()
    m.status_code = status
    m.json.return_value = data
    m.headers = {}
    return m


@pytest.fixture(scope="module")
def client():
    def _fake_admin_required(fn):
        from functools import wraps
        @wraps(fn)
        def wrapper(*args, **kwargs):
            return fn(*args, **kwargs)
        return wrapper

    with patch("routes.admin.admin_required", _fake_admin_required):
        for mod in list(sys.modules.keys()):
            if "routes.admin" in mod:
                del sys.modules[mod]
        import app as _app
        _app.app.config["TESTING"] = True
        yield _app.app.test_client()


CAR_ROW = {
    "id": "car-1", "car_manufacturer": "BMW", "car_model": "320i",
    "expected_selling_price": 95000, "status": "deleted",
    "sold_status": None, "sold_status_set_at": None,
    "deleted_at": "2026-06-25T10:00:00Z",
    "expired_at": "2026-06-20T00:00:00Z",
    "retention_expires_at": "2026-07-20T00:00:00Z",
    "is_archived": False, "renewal_nudge_count": 2,
    "renewal_nudge_sent_at": "2026-06-18T00:00:00Z",
    "user_id": "u1", "listing_state": "deleted",
}

DELETION_EVENT = {
    "listing_id": "car-1", "listing_type": "car",
    "deleted_by_role": "admin", "reason": "Spam listing",
    "created_at": "2026-06-25T10:00:00Z",
}

EMAIL_ROW = {
    "user_id": "u1", "email_type": "renewal_nudge",
    "opened_at": "2026-06-18T05:00:00Z", "clicked_at": None,
}


def _build_fake_get(cars=None, deletion_events=None, email_rows=None, images=None):
    cars = cars or []
    deletion_events = deletion_events or []
    email_rows = email_rows or []
    images = images or []

    def fake_get(url, **kwargs):
        if "/cars" in url and "status" in (kwargs.get("params") or {}):
            return _make_response(cars)
        if "/bikes" in url or "/car_parts" in url or "/license_plates" in url:
            return _make_response([])
        if "listing_deletion_events" in url:
            return _make_response(deletion_events)
        if "outbound_emails" in url:
            return _make_response(email_rows)
        if any(t in url for t in ("car_images", "bike_images", "part_images", "plate_images")):
            return _make_response(images)
        return _make_response([])
    return fake_get


def test_expired_listings_returns_listings(client):
    with patch("routes.admin.requests.get", side_effect=_build_fake_get(cars=[CAR_ROW])):
        resp = client.get("/api/admin/expired-listings?type=cars&days=30")
    assert resp.status_code == 200
    data = resp.get_json()
    assert "listings" in data
    assert len(data["listings"]) == 1
    item = data["listings"][0]
    assert item["id"] == "car-1"
    assert item["listing_type"] == "cars"


def test_expiry_reason_admin_deleted(client):
    with patch("routes.admin.requests.get",
               side_effect=_build_fake_get(cars=[CAR_ROW], deletion_events=[DELETION_EVENT])):
        resp = client.get("/api/admin/expired-listings?type=cars&days=30")
    item = resp.get_json()["listings"][0]
    assert item["expiry_reason"] == "Admin deleted"
    assert item["reason_detail"] == "Spam listing"


def test_expiry_reason_no_response(client):
    car = {**CAR_ROW, "status": "expired", "deleted_at": None, "sold_status": None}
    with patch("routes.admin.requests.get", side_effect=_build_fake_get(cars=[car])):
        resp = client.get("/api/admin/expired-listings?type=cars&days=30")
    item = resp.get_json()["listings"][0]
    assert item["expiry_reason"] == "Expired — no response"


def test_expiry_reason_sold_on_dph(client):
    car = {**CAR_ROW, "status": "expired", "deleted_at": None, "sold_status": "sold_on_dph"}
    with patch("routes.admin.requests.get", side_effect=_build_fake_get(cars=[car])):
        resp = client.get("/api/admin/expired-listings?type=cars&days=30")
    item = resp.get_json()["listings"][0]
    assert item["expiry_reason"] == "Sold on DPH"


def test_email_interacted_flag(client):
    with patch("routes.admin.requests.get",
               side_effect=_build_fake_get(cars=[CAR_ROW], email_rows=[EMAIL_ROW])):
        resp = client.get("/api/admin/expired-listings?type=cars&days=30")
    item = resp.get_json()["listings"][0]
    assert item["email_interacted"] is True


def test_email_not_interacted_when_no_open(client):
    email = {**EMAIL_ROW, "opened_at": None, "clicked_at": None}
    with patch("routes.admin.requests.get",
               side_effect=_build_fake_get(cars=[CAR_ROW], email_rows=[email])):
        resp = client.get("/api/admin/expired-listings?type=cars&days=30")
    item = resp.get_json()["listings"][0]
    assert item["email_interacted"] is False


def test_reason_filter_admin_deleted(client):
    """reason=admin_deleted should only return admin-deleted rows."""
    car_no_event = {**CAR_ROW, "id": "car-2", "status": "expired",
                    "deleted_at": None, "sold_status": None}
    with patch("routes.admin.requests.get",
               side_effect=_build_fake_get(
                   cars=[CAR_ROW, car_no_event],
                   deletion_events=[DELETION_EVENT])):
        resp = client.get("/api/admin/expired-listings?type=cars&days=30&reason=admin_deleted")
    data = resp.get_json()
    assert len(data["listings"]) == 1
    assert data["listings"][0]["id"] == "car-1"
```

- [ ] **Step 2: Run to confirm it fails**

```bash
cd flask-react-supabase-app/backend
python -m pytest test_admin_expired_listings.py -v 2>&1 | tail -20
```

Expected: FAIL — 404 on `/api/admin/expired-listings` (route doesn't exist).

- [ ] **Step 3: Add the expired-listings route to admin.py**

Find the `@admin_bp.route("/listing-history", ...)` block in `admin.py` (around line 1783). Add the following new route **before** it:

```python
@admin_bp.route("/expired-listings", methods=["GET"])
@admin_required
def get_expired_listings():
    """Return expired/deleted listings across all types with pre-computed expiry_reason.

    Query params: type (all|cars|bikes|parts|plates), reason (all|auto_expired|
    user_deleted|admin_deleted|sold_on_dph|sold_elsewhere|no_response),
    days (1-365, default 30), limit (1-200, default 50), offset (default 0).
    """
    try:
        type_filter = (request.args.get("type") or "all").strip().lower()
        reason_filter = (request.args.get("reason") or "all").strip().lower()
        days = max(min(int(request.args.get("days", 30)), 365), 1)
        limit = max(min(int(request.args.get("limit", 50)), 200), 1)
        offset = max(int(request.args.get("offset", 0)), 0)

        cache_key = f"admin:expired:{type_filter}:{reason_filter}:{days}:{limit}:{offset}"
        cached = _admin_cache_get(cache_key)
        if cached is not None:
            return jsonify(cached), 200

        cutoff = (datetime.utcnow() - timedelta(days=days)).isoformat() + "Z"

        # ── Step 1: determine which tables to query ──────────────────────────
        TYPE_CONFIGS = {
            "cars":   {"table": "cars",           "images_table": "car_images",   "image_fk": "car_id",   "label": "cars"},
            "bikes":  {"table": "bikes",          "images_table": "bike_images",  "image_fk": "bike_id",  "label": "bikes"},
            "parts":  {"table": "car_parts",      "images_table": "part_images",  "image_fk": "part_id",  "label": "parts"},
            "plates": {"table": "license_plates", "images_table": "plate_images", "image_fk": "plate_id", "label": "plates"},
        }
        if type_filter == "all":
            tables_to_query = list(TYPE_CONFIGS.values())
        elif type_filter in TYPE_CONFIGS:
            tables_to_query = [TYPE_CONFIGS[type_filter]]
        else:
            return jsonify({"error": "Invalid type filter"}), 400

        # ── Step 2: fetch expired/deleted listings from each table ────────────
        all_listings = []
        for cfg in tables_to_query:
            resp = requests.get(
                f"{SUPABASE_URL}/rest/v1/{cfg['table']}",
                headers=_admin_headers(),
                params={
                    "select": "id,status,sold_status,sold_status_set_at,sold_response_deadline,"
                              "deleted_at,expired_at,retention_expires_at,is_archived,"
                              "renewal_nudge_count,renewal_nudge_sent_at,user_id,"
                              # title fields vary by table — select all and pick in Python
                              "car_manufacturer,car_model,bike_brand,bike_model,"
                              "part_type,part_name,city,code,digits,number,"
                              "expected_selling_price,price,listing_state",
                    "status": "in.(deleted,expired,archived)",
                    "order": "created_at.desc",
                    "limit": "500",
                },
                timeout=15,
            )
            if resp.status_code == 200:
                rows = resp.json() or []
                for row in rows:
                    row["_cfg_label"] = cfg["label"]
                    row["_image_fk"] = cfg["image_fk"]
                    row["_images_table"] = cfg["images_table"]
                    # Apply days filter in Python (deleted_at or expired_at within window)
                    date_field = row.get("deleted_at") or row.get("expired_at") or ""
                    if date_field >= cutoff:
                        all_listings.append(row)

        if not all_listings:
            return jsonify({"listings": [], "total": 0, "has_more": False}), 200

        # ── Step 3: batch fetch deletion events ───────────────────────────────
        listing_ids = [r.get("id") for r in all_listings if r.get("id")]
        deletion_events_by_id = {}
        for chunk in _chunks(listing_ids, 100):
            ids_in = ",".join(chunk)
            de_resp = requests.get(
                f"{SUPABASE_URL}/rest/v1/listing_deletion_events",
                headers=_admin_headers(),
                params={
                    "select": "listing_id,deleted_by_role,reason,created_at",
                    "listing_id": f"in.({ids_in})",
                    "order": "created_at.desc",
                },
                timeout=15,
            )
            if de_resp.status_code == 200:
                for ev in de_resp.json() or []:
                    lid = ev.get("listing_id")
                    if lid and lid not in deletion_events_by_id:
                        deletion_events_by_id[lid] = ev

        # ── Step 4: batch fetch email interactions ────────────────────────────
        user_ids = list({r.get("user_id") for r in all_listings if r.get("user_id")})
        email_interacted_user_ids = set()
        for chunk in _chunks(user_ids, 100):
            uids_in = ",".join(chunk)
            em_resp = requests.get(
                f"{SUPABASE_URL}/rest/v1/outbound_emails",
                headers=_admin_headers(),
                params={
                    "select": "user_id,opened_at,clicked_at",
                    "user_id": f"in.({uids_in})",
                    "email_type": "in.(renewal_nudge,listing_expiry_reminder,listing_expiry_final,listing_expired)",
                },
                timeout=15,
            )
            if em_resp.status_code == 200:
                for em in em_resp.json() or []:
                    if em.get("opened_at") or em.get("clicked_at"):
                        email_interacted_user_ids.add(em.get("user_id"))

        # ── Step 5: batch fetch first image per listing ───────────────────────
        image_url_by_id = {}
        grouped_by_cfg = {}
        for row in all_listings:
            key = (row["_images_table"], row["_image_fk"])
            grouped_by_cfg.setdefault(key, []).append(row.get("id"))

        for (images_table, image_fk), ids in grouped_by_cfg.items():
            imgs_map = _admin_batch_fetch_images(images_table, image_fk, ids)
            for lid, imgs in imgs_map.items():
                if imgs:
                    first = imgs[0]
                    image_url_by_id[lid] = (
                        first.get("display_url") or first.get("image_url") or first.get("url")
                    )

        # ── Step 6: compute expiry_reason and build output ───────────────────
        def _compute_title(row):
            parts = [
                row.get("car_manufacturer"), row.get("car_model"),
                row.get("bike_brand"), row.get("bike_model"),
                row.get("part_type") or row.get("part_name"),
                row.get("city"), row.get("code"),
                row.get("digits") or row.get("number"),
            ]
            return " ".join(p for p in parts if p).strip() or "Untitled"

        def _compute_reason(row, deletion_event):
            if deletion_event:
                role = deletion_event.get("deleted_by_role")
                if role == "admin":
                    return "Admin deleted", deletion_event.get("reason")
                if role == "user":
                    return "User deleted", None
                if row.get("is_archived"):
                    return "Auto-removed (past retention)", None
                return "Auto-expired", None
            sold = row.get("sold_status")
            if sold == "sold_on_dph":
                return "Sold on DPH", None
            if sold == "sold_elsewhere":
                return "Sold elsewhere", None
            if sold == "not_sold_renew":
                return "Renewed (not sold)", None
            return "Expired — no response", None

        REASON_FILTER_MAP = {
            "auto_expired":  lambda r: r in ("Auto-expired", "Auto-removed (past retention)"),
            "user_deleted":  lambda r: r == "User deleted",
            "admin_deleted": lambda r: r == "Admin deleted",
            "sold_on_dph":   lambda r: r == "Sold on DPH",
            "sold_elsewhere": lambda r: r == "Sold elsewhere",
            "no_response":   lambda r: r == "Expired — no response",
        }

        enriched = []
        for row in all_listings:
            lid = row.get("id")
            deletion_event = deletion_events_by_id.get(lid)
            expiry_reason, reason_detail = _compute_reason(row, deletion_event)

            if reason_filter != "all":
                fn = REASON_FILTER_MAP.get(reason_filter)
                if fn and not fn(expiry_reason):
                    continue

            enriched.append({
                "id": lid,
                "listing_type": row["_cfg_label"],
                "title": _compute_title(row),
                "price": row.get("expected_selling_price") or row.get("price"),
                "image_url": image_url_by_id.get(lid),
                "expiry_reason": expiry_reason,
                "reason_detail": reason_detail,
                "sold_status": row.get("sold_status"),
                "sold_status_set_at": row.get("sold_status_set_at"),
                "email_interacted": row.get("user_id") in email_interacted_user_ids,
                "renewal_nudge_count": int(row.get("renewal_nudge_count") or 0),
                "renewal_nudge_sent_at": row.get("renewal_nudge_sent_at"),
                "deleted_at": row.get("deleted_at"),
                "expired_at": row.get("expired_at"),
                "user_id": row.get("user_id"),
                "listing_state": row.get("listing_state"),
                "is_archived": row.get("is_archived", False),
            })

        total = len(enriched)
        page = enriched[offset: offset + limit]
        has_more = (offset + limit) < total

        result = {"listings": page, "total": total, "has_more": has_more}
        _admin_cache_set(cache_key, result, ttl=120)
        return jsonify(result), 200

    except Exception as exc:
        logger.error(f"Error fetching expired listings: {exc}")
        return jsonify({"error": "Failed to fetch expired listings"}), 500
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd flask-react-supabase-app/backend
python -m pytest test_admin_expired_listings.py -v 2>&1 | tail -30
```

Expected: 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add flask-react-supabase-app/backend/routes/admin.py \
        flask-react-supabase-app/backend/test_admin_expired_listings.py
git commit -m "feat(admin): add GET /api/admin/expired-listings endpoint"
```

---

## Task 3: Frontend — sold_status pill on AdminListingsScreen cards

**Files:**
- Modify: `flask-react-supabase-app/mobile/src/screens/admin/AdminListingsScreen.js`

This is the smallest change — add a second status pill to the existing card when `sold_status` is set.

- [ ] **Step 1: Open AdminListingCard and locate cardMeta View**

In `AdminListingsScreen.js`, find the `AdminListingCard` function. Locate this section inside the `cardInfo` View:

```jsx
<View style={styles.cardMeta}>
  <View style={[styles.statusBadge, { backgroundColor: getStatusColor(displayStatus) }]}>
    <Text style={styles.statusBadgeText}>{displayStatus}</Text>
  </View>
  <Text style={styles.cardDate} numberOfLines={1}>
    {[formatDate(item.created_at), item.seller_name].filter(Boolean).join(' · ')}
  </Text>
</View>
```

- [ ] **Step 2: Add sold_status pill helper and update the card**

Add this helper above the `AdminListingCard` function definition (after `getDisplayPrice`):

```js
const SOLD_STATUS_CONFIG = {
  sold_on_dph:    { label: 'Sold DPH',      color: '#4CAF50' },
  sold_elsewhere: { label: 'Sold elsewhere', color: '#FF9800' },
  not_sold_renew: { label: 'Renewed',        color: '#2196F3' },
};
```

Replace the existing `<View style={styles.cardMeta}>` block with:

```jsx
<View style={styles.cardMeta}>
  <View style={[styles.statusBadge, { backgroundColor: getStatusColor(displayStatus) }]}>
    <Text style={styles.statusBadgeText}>{displayStatus}</Text>
  </View>
  {item.sold_status && SOLD_STATUS_CONFIG[item.sold_status] && (
    <View style={[styles.statusBadge, { backgroundColor: SOLD_STATUS_CONFIG[item.sold_status].color, marginLeft: 4 }]}>
      <Text style={styles.statusBadgeText}>{SOLD_STATUS_CONFIG[item.sold_status].label}</Text>
    </View>
  )}
  <Text style={styles.cardDate} numberOfLines={1}>
    {[formatDate(item.created_at), item.seller_name].filter(Boolean).join(' · ')}
  </Text>
</View>
```

- [ ] **Step 3: Verify**

Run the app and navigate to Admin → Listings. Filter to "Expired" or "Deleted". Any listing with `sold_status` set should show a second coloured pill next to the main status badge. Listings without sold_status show no second pill.

- [ ] **Step 4: Commit**

```bash
git add flask-react-supabase-app/mobile/src/screens/admin/AdminListingsScreen.js
git commit -m "feat(admin): add sold_status pill to listing cards"
```

---

## Task 4: Frontend — AdminListingDetailScreen lifecycle section

**Files:**
- Modify: `flask-react-supabase-app/mobile/src/screens/admin/AdminListingDetailScreen.js`

The overview endpoint already returns `listing` (with sold_status, renewal_nudge_*, expired_at, retention_expires_at, deleted_at), `deletion_events`, and (after Task 1) `renewal_emails`. This task wires all of it into the UI.

- [ ] **Step 1: Add helper functions at the top of the file**

After the existing `REJECTION_REASONS` array (around line 12), add:

```js
const SOLD_STATUS_DISPLAY = {
  sold_on_dph:    { label: 'Sold on DPH',        color: '#4CAF50' },
  sold_elsewhere: { label: 'Sold elsewhere',       color: '#FF9800' },
  not_sold_renew: { label: 'Not sold — renewed',   color: '#2196F3' },
};

const DELETION_ROLE_ICONS = {
  admin:  'shield-outline',
  user:   'person-outline',
  system: 'settings-outline',
};

function formatDateShort(iso) {
  if (!iso) return 'N/A';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function LifecycleTimeline({ listing }) {
  const now = new Date();
  const created  = listing?.created_at   ? new Date(listing.created_at)   : null;
  const expires  = listing?.expires_at   ? new Date(listing.expires_at)   : null;
  const retEnd   = listing?.retention_expires_at ? new Date(listing.retention_expires_at) : null;
  const isDeleted  = Boolean(listing?.deleted_at);
  const isArchived = listing?.is_archived || (retEnd && now >= retEnd);
  const isExpired  = expires && now >= expires && !isArchived;

  const milestones = [
    { label: 'Created',   date: listing?.created_at,          done: true },
    { label: expires && now >= expires ? 'Expired' : 'Expires', date: listing?.expires_at, done: expires && now >= expires },
    { label: 'Retention ends', date: listing?.retention_expires_at, done: isArchived },
    { label: isDeleted ? 'Deleted' : 'Archived', date: listing?.deleted_at || (isArchived ? listing?.retention_expires_at : null), done: isDeleted || isArchived },
  ];

  return (
    <View style={lcStyles.timelineRow}>
      {milestones.map((m, i) => (
        <View key={m.label} style={lcStyles.milestone}>
          <View style={[lcStyles.dot, m.done && lcStyles.dotDone, isDeleted && i === 3 && lcStyles.dotDeleted]} />
          <Text style={[lcStyles.milestoneLabel, m.done && lcStyles.milestoneLabelDone]}>{m.label}</Text>
          <Text style={lcStyles.milestoneDate}>{formatDateShort(m.date)}</Text>
          {i < milestones.length - 1 && <View style={[lcStyles.connector, m.done && lcStyles.connectorDone]} />}
        </View>
      ))}
    </View>
  );
}

function SoldStatusCard({ listing }) {
  const hasExpired = Boolean(listing?.expired_at);
  const soldStatus = listing?.sold_status;
  if (!hasExpired && !soldStatus) return null;

  const now = new Date();
  const deadline = listing?.sold_response_deadline ? new Date(listing.sold_response_deadline) : null;

  let label, color;
  if (soldStatus && SOLD_STATUS_DISPLAY[soldStatus]) {
    ({ label, color } = SOLD_STATUS_DISPLAY[soldStatus]);
  } else if (deadline && now < deadline) {
    label = 'Awaiting owner response';
    color = '#9E9E9E';
  } else {
    label = 'No response recorded';
    color = '#F44336';
  }

  return (
    <View style={lcStyles.card}>
      <Text style={lcStyles.cardTitle}>Sold Status</Text>
      <View style={[lcStyles.badge, { backgroundColor: color + '26' }]}>
        <Text style={[lcStyles.badgeText, { color }]}>{label}</Text>
      </View>
      {listing?.sold_status_set_at && (
        <Text style={lcStyles.cardSub}>Set: {formatDateShort(listing.sold_status_set_at)}</Text>
      )}
      {deadline && now < deadline && (
        <Text style={lcStyles.cardSub}>Owner deadline: {formatDateShort(listing.sold_response_deadline)}</Text>
      )}
    </View>
  );
}

function RenewalNudgeCard({ listing, renewalEmails }) {
  const count = parseInt(listing?.renewal_nudge_count || 0, 10);
  if (count === 0) return null;

  const channels = listing?.renewal_nudge_channels || {};
  const latestEmail = (renewalEmails || []).find(e => e.email_type === 'renewal_nudge' || e.email_type === 'listing_expiry_reminder');
  const emailOpened = latestEmail?.opened_at;
  const emailClicked = latestEmail?.clicked_at;

  return (
    <View style={lcStyles.card}>
      <Text style={lcStyles.cardTitle}>Renewal Nudges</Text>
      <Text style={lcStyles.cardValue}>{count} nudge{count !== 1 ? 's' : ''} sent</Text>
      <View style={lcStyles.channelRow}>
        {channels.email  !== undefined && <Text style={[lcStyles.channelPill, { color: channels.email  ? '#4CAF50' : '#9E9E9E' }]}>✉ Email</Text>}
        {channels.sms    !== undefined && <Text style={[lcStyles.channelPill, { color: channels.sms    ? '#4CAF50' : '#9E9E9E' }]}>📱 SMS</Text>}
        {channels.whatsapp !== undefined && <Text style={[lcStyles.channelPill, { color: channels.whatsapp ? '#4CAF50' : '#9E9E9E' }]}>💬 WA</Text>}
      </View>
      {listing?.renewal_nudge_sent_at && (
        <Text style={lcStyles.cardSub}>Last sent: {formatDateShort(listing.renewal_nudge_sent_at)}</Text>
      )}
      {latestEmail && (
        <View style={lcStyles.emailRow}>
          <Ionicons
            name={emailOpened || emailClicked ? 'mail-open-outline' : 'mail-outline'}
            size={14}
            color={emailOpened || emailClicked ? '#4CAF50' : '#9E9E9E'}
          />
          <Text style={[lcStyles.emailStatus, { color: emailOpened || emailClicked ? '#4CAF50' : '#9E9E9E' }]}>
            {emailClicked ? 'Clicked link' : emailOpened ? 'Opened' : 'Not opened'}
          </Text>
        </View>
      )}
    </View>
  );
}

function DeletionTimeline({ deletionEvents }) {
  if (!deletionEvents || deletionEvents.length === 0) return null;
  return (
    <View style={lcStyles.card}>
      <Text style={lcStyles.cardTitle}>Deletion History</Text>
      {deletionEvents.map((ev, i) => (
        <View key={i} style={lcStyles.deletionRow}>
          <Ionicons name={DELETION_ROLE_ICONS[ev.deleted_by_role] || 'information-circle-outline'} size={16} color='rgba(255,255,255,0.6)' />
          <View style={{ flex: 1, marginLeft: 8 }}>
            <Text style={lcStyles.deletionRole}>{(ev.deleted_by_role || 'unknown').charAt(0).toUpperCase() + (ev.deleted_by_role || 'unknown').slice(1)}</Text>
            {ev.reason ? <Text style={lcStyles.deletionReason} numberOfLines={2}>{ev.reason}</Text> : null}
            <Text style={lcStyles.cardSub}>{formatDateShort(ev.created_at)}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}
```

- [ ] **Step 2: Add lifecycle styles**

After the main `const styles = StyleSheet.create({...})` block at the bottom, add:

```js
const lcStyles = StyleSheet.create({
  timelineRow:       { flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.sm, paddingHorizontal: 4 },
  milestone:         { alignItems: 'center', flex: 1, position: 'relative' },
  dot:               { width: 10, height: 10, borderRadius: 5, backgroundColor: '#333', marginBottom: 4 },
  dotDone:           { backgroundColor: COLORS.accent },
  dotDeleted:        { backgroundColor: '#F44336' },
  connector:         { position: 'absolute', top: 4, left: '50%', right: 0, height: 2, backgroundColor: '#333' },
  connectorDone:     { backgroundColor: COLORS.accent },
  milestoneLabel:    { fontSize: 9, color: 'rgba(255,255,255,0.4)', textAlign: 'center' },
  milestoneLabelDone:{ color: COLORS.white },
  milestoneDate:     { fontSize: 9, color: 'rgba(255,255,255,0.3)', textAlign: 'center', marginTop: 2 },
  card:              { backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, marginTop: SPACING.sm },
  cardTitle:         { color: COLORS.accent, fontSize: FONT_SIZES.xs, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: SPACING.xs },
  cardValue:         { color: COLORS.white, fontSize: FONT_SIZES.md, fontWeight: '600', marginBottom: 4 },
  cardSub:           { color: 'rgba(255,255,255,0.45)', fontSize: FONT_SIZES.xs, marginTop: 4 },
  badge:             { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: BORDER_RADIUS.sm, marginBottom: 4 },
  badgeText:         { fontSize: FONT_SIZES.sm, fontWeight: '600' },
  channelRow:        { flexDirection: 'row', gap: 8, marginVertical: 4 },
  channelPill:       { fontSize: FONT_SIZES.sm },
  emailRow:          { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  emailStatus:       { fontSize: FONT_SIZES.sm },
  deletionRow:       { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#2a2a2a' },
  deletionRole:      { color: COLORS.white, fontSize: FONT_SIZES.sm, fontWeight: '600' },
  deletionReason:    { color: 'rgba(255,255,255,0.6)', fontSize: FONT_SIZES.xs, marginTop: 2 },
});
```

- [ ] **Step 3: Wire up lifecycle section in the render**

In the component's render, find the existing `{!isBuyingRequest && (<View style={styles.scanCard}>...)}` block. Add the lifecycle section **after** it and **before** the actions block:

Replace:
```jsx
        {!isBuyingRequest && (
          <View style={styles.actions}>
```

With:
```jsx
        {!isBuyingRequest && (
          <View style={lcStyles.card}>
            <Text style={lcStyles.cardTitle}>Lifecycle</Text>
            <LifecycleTimeline listing={listing} />
          </View>
        )}

        <SoldStatusCard listing={listing} />
        <RenewalNudgeCard listing={listing} renewalEmails={detail?.renewal_emails || []} />
        <DeletionTimeline deletionEvents={detail?.deletion_events || []} />

        {!isBuyingRequest && (
          <View style={styles.actions}>
```

- [ ] **Step 4: Verify**

Navigate to Admin → Listings → tap any expired or deleted listing. The detail screen should now show:
- A "LIFECYCLE" card with a 4-milestone timeline
- A "Sold Status" card (if expired_at is set or sold_status present)
- A "Renewal Nudges" card with email open/click indicator (if nudges were sent)
- A "Deletion History" card (if deletion events exist)

Active listings show only the timeline. Buying request listings show nothing (not wired for lifecycle).

- [ ] **Step 5: Commit**

```bash
git add flask-react-supabase-app/mobile/src/screens/admin/AdminListingDetailScreen.js
git commit -m "feat(admin): add lifecycle & outcomes section to listing detail screen"
```

---

## Task 5: Frontend — Email metrics section in AdminMetricsScreen

**Files:**
- Modify: `flask-react-supabase-app/mobile/src/screens/admin/AdminMetricsScreen.js`

The backend endpoint `GET /api/admin/metrics/email` already exists and returns `{ summary: {...}, by_type: [...], daily: [...] }`.

- [ ] **Step 1: Add emailMetrics state and load function**

In `AdminMetricsScreen`, find the existing state declarations:

```js
const [metrics, setMetrics] = useState(null);
const [health, setHealth] = useState(null);
const [loading, setLoading] = useState(true);
const [error, setError] = useState('');
const [days, setDays] = useState(30);
```

Add one more state variable after them:

```js
const [emailMetrics, setEmailMetrics] = useState(null);
```

- [ ] **Step 2: Add loadEmailMetrics function**

Add after the existing `loadHealth` function:

```js
const loadEmailMetrics = async () => {
  try {
    const data = await apiClient.get(`/api/admin/metrics/email?days=${days}`);
    setEmailMetrics(data && !data.error ? data : null);
  } catch {
    setEmailMetrics(null);
  }
};
```

- [ ] **Step 3: Call loadEmailMetrics in the existing useEffect**

Find:
```js
useEffect(() => { loadMetrics(); }, [days]);
```

Replace with:
```js
useEffect(() => { loadMetrics(); loadEmailMetrics(); }, [days]);
```

- [ ] **Step 4: Add the email section to the ScrollView**

Find the line `<View style={{ height: 40 }} />` at the very end of the ScrollView. Insert the following **before** that closing spacer:

```jsx
        <SectionHeader label="EMAIL" title="Outbound email delivery & engagement" subtitle={`Email analytics for the last ${days} days.`} />

        {!emailMetrics ? (
          <View style={styles.surface}>
            <Text style={styles.emptyText}>Email metrics unavailable — run the outbound_emails migration.</Text>
          </View>
        ) : (
          <>
            <View style={styles.surface}>
              <MetricRow
                label="Sent"
                value={formatNumber(emailMetrics.summary?.total_sent)}
              />
              <MetricRow
                label="Delivered"
                value={`${formatNumber(emailMetrics.summary?.total_delivered)}  (${formatPercent(emailMetrics.summary?.delivery_rate_percent)})`}
              />
              <MetricRow
                label="Opened"
                value={`${formatNumber(emailMetrics.summary?.total_opened)}  (${formatPercent(emailMetrics.summary?.open_rate_percent)})`}
              />
              <MetricRow
                label="Clicked"
                value={`${formatNumber(emailMetrics.summary?.total_clicked)}  (${formatPercent(emailMetrics.summary?.click_rate_percent)})`}
              />
              <MetricRow
                label="Bounced"
                value={formatNumber(emailMetrics.summary?.total_bounced)}
              />
              <MetricRow
                label="Unsubscribed"
                value={formatNumber(emailMetrics.summary?.total_unsubscribed)}
              />
            </View>

            {emailMetrics.by_type?.length > 0 && (
              <>
                <Text style={styles.subSectionTitle}>By Email Type</Text>
                <View style={styles.surface}>
                  <BarChart
                    items={emailMetrics.by_type.map(t => ({ segment: t.email_type, views: t.sent }))}
                  />
                </View>
              </>
            )}

            {emailMetrics.daily?.length > 0 && (
              <>
                <Text style={styles.subSectionTitle}>Daily Sends</Text>
                <View style={styles.surface}>
                  <BarChart
                    items={emailMetrics.daily.slice(-14).map(d => ({ segment: d.date, views: d.sent }))}
                  />
                </View>
              </>
            )}
          </>
        )}
```

- [ ] **Step 5: Verify**

Navigate to Admin → Metrics. Scroll to the bottom. An "EMAIL" section should appear with sent/delivered/opened/clicked/bounced counts. If the table is not migrated, shows a muted error message. Changing the time window (7d / 30d / 90d) updates the email data along with all other sections.

- [ ] **Step 6: Commit**

```bash
git add flask-react-supabase-app/mobile/src/screens/admin/AdminMetricsScreen.js
git commit -m "feat(admin): add email metrics section to AdminMetricsScreen"
```

---

## Task 6: Frontend — New AdminExpiredListingsScreen

**Files:**
- Create: `flask-react-supabase-app/mobile/src/screens/admin/AdminExpiredListingsScreen.js`

- [ ] **Step 1: Create the file**

Create `flask-react-supabase-app/mobile/src/screens/admin/AdminExpiredListingsScreen.js` with this content:

```js
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Image, RefreshControl, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import apiClient from '../../utils/apiClient';
import { formatPrice, formatDate } from '../../utils/formatters';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES } from '../../constants/theme';

// ── Constants ──────────────────────────────────────────────────────────────

const TYPE_TABS  = ['All', 'Cars', 'Bikes', 'Parts', 'Plates'];
const TYPE_KEYS  = { All: 'all', Cars: 'cars', Bikes: 'bikes', Parts: 'parts', Plates: 'plates' };
const REASON_CHIPS = [
  { label: 'All',            key: 'all' },
  { label: 'Auto-expired',   key: 'auto_expired' },
  { label: 'User deleted',   key: 'user_deleted' },
  { label: 'Admin deleted',  key: 'admin_deleted' },
  { label: 'Sold on DPH',    key: 'sold_on_dph' },
  { label: 'Sold elsewhere', key: 'sold_elsewhere' },
  { label: 'No response',    key: 'no_response' },
];
const DAY_OPTIONS = [7, 30, 90];

const REASON_COLORS = {
  'Sold on DPH':                '#4CAF50',
  'Sold elsewhere':             '#FF9800',
  'Renewed (not sold)':         '#2196F3',
  'User deleted':               '#9E9E9E',
  'Admin deleted':              '#F44336',
  'Auto-expired':               '#FF6F00',
  'Auto-removed (past retention)': '#E65100',
  'Expired — no response':      '#c62828',
};

// ── Sub-components ─────────────────────────────────────────────────────────

function ExpiredListingCard({ item, onPress }) {
  const imageUri = item.image_url || null;
  const reasonColor = REASON_COLORS[item.expiry_reason] || '#9E9E9E';
  const displayDate = item.deleted_at || item.expired_at;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75}>
      <View style={styles.cardContent}>
        {imageUri ? (
          <Image source={{ uri: imageUri }} style={styles.thumbnail} />
        ) : (
          <View style={[styles.thumbnail, styles.thumbPlaceholder]}>
            <Ionicons name="image-outline" size={24} color="rgba(255,255,255,0.2)" />
          </View>
        )}
        <View style={styles.cardInfo}>
          <Text style={styles.cardTitle} numberOfLines={1}>{item.title || 'Untitled'}</Text>
          {item.price ? (
            <Text style={styles.cardPrice}>{formatPrice(item.price)}</Text>
          ) : null}
          <View style={styles.reasonRow}>
            <View style={[styles.reasonBadge, { backgroundColor: reasonColor + '26' }]}>
              <Text style={[styles.reasonText, { color: reasonColor }]}>{item.expiry_reason}</Text>
            </View>
          </View>
          <View style={styles.metaRow}>
            {item.email_interacted ? (
              <View style={styles.emailChip}>
                <Ionicons name="mail-open-outline" size={11} color="#4CAF50" />
                <Text style={[styles.emailChipText, { color: '#4CAF50' }]}>Email opened</Text>
              </View>
            ) : item.renewal_nudge_count > 0 ? (
              <View style={styles.emailChip}>
                <Ionicons name="mail-outline" size={11} color="rgba(255,255,255,0.4)" />
                <Text style={[styles.emailChipText, { color: 'rgba(255,255,255,0.4)' }]}>
                  ×{item.renewal_nudge_count} sent, not opened
                </Text>
              </View>
            ) : null}
            {displayDate ? (
              <Text style={styles.metaDate}>{formatDate(displayDate)}</Text>
            ) : null}
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ── Main Screen ────────────────────────────────────────────────────────────

export default function AdminExpiredListingsScreen({ navigation }) {
  const [listings, setListings]       = useState([]);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [typeFilter, setTypeFilter]   = useState('all');
  const [reasonFilter, setReasonFilter] = useState('all');
  const [days, setDays]               = useState(30);
  const [offset, setOffset]           = useState(0);
  const [hasMore, setHasMore]         = useState(false);
  const [error, setError]             = useState('');

  const load = useCallback(async (reset = true) => {
    try {
      if (reset) setLoading(true);
      setError('');
      const currentOffset = reset ? 0 : offset;
      const data = await apiClient.get('/api/admin/expired-listings', {
        params: { type: typeFilter, reason: reasonFilter, days, limit: 50, offset: currentOffset },
      });
      const fetched = data?.listings || [];
      if (reset) {
        setListings(fetched);
        setOffset(50);
      } else {
        setListings(prev => [...prev, ...fetched]);
        setOffset(prev => prev + 50);
      }
      setHasMore(data?.has_more || false);
    } catch (err) {
      setError(err?.message || 'Failed to load expired listings');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [typeFilter, reasonFilter, days, offset]);

  useEffect(() => { load(true); }, [typeFilter, reasonFilter, days]);

  const onRefresh = () => { setRefreshing(true); load(true); };
  const onLoadMore = () => { if (hasMore && !loading) load(false); };

  return (
    <SafeAreaView style={styles.container}>
      {/* Type tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabRow} contentContainerStyle={styles.tabRowContent}>
        {TYPE_TABS.map(tab => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, typeFilter === TYPE_KEYS[tab] && styles.tabActive]}
            onPress={() => setTypeFilter(TYPE_KEYS[tab])}
          >
            <Text style={[styles.tabText, typeFilter === TYPE_KEYS[tab] && styles.tabTextActive]}>{tab}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Reason chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={styles.tabRowContent}>
        {REASON_CHIPS.map(chip => (
          <TouchableOpacity
            key={chip.key}
            style={[styles.chip, reasonFilter === chip.key && styles.chipActive]}
            onPress={() => setReasonFilter(chip.key)}
          >
            <Text style={[styles.chipText, reasonFilter === chip.key && styles.chipTextActive]}>{chip.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Day window */}
      <View style={styles.dayRow}>
        {DAY_OPTIONS.map(d => (
          <TouchableOpacity
            key={d}
            style={[styles.dayBtn, days === d && styles.dayBtnActive]}
            onPress={() => setDays(d)}
          >
            <Text style={[styles.dayBtnText, days === d && styles.dayBtnTextActive]}>{d}d</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* List */}
      {error ? (
        <View style={styles.centerWrap}>
          <Ionicons name="alert-circle-outline" size={32} color={COLORS.error} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={() => load(true)} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : loading && listings.length === 0 ? (
        <View style={styles.centerWrap}>
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      ) : listings.length === 0 ? (
        <View style={styles.centerWrap}>
          <Ionicons name="checkmark-circle-outline" size={40} color="rgba(255,255,255,0.2)" />
          <Text style={styles.emptyText}>No expired listings match this filter.</Text>
        </View>
      ) : (
        <FlashList
          data={listings}
          estimatedItemSize={100}
          keyExtractor={item => `${item.listing_type}-${item.id}`}
          renderItem={({ item }) => (
            <ExpiredListingCard
              item={item}
              onPress={() => navigation.navigate('AdminListingDetail', { itemType: item.listing_type, itemId: item.id })}
            />
          )}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.accent} />}
          onEndReached={onLoadMore}
          onEndReachedThreshold={0.3}
          ListFooterComponent={hasMore ? (
            <TouchableOpacity style={styles.loadMoreBtn} onPress={onLoadMore}>
              <Text style={styles.loadMoreText}>Load more</Text>
            </TouchableOpacity>
          ) : null}
        />
      )}
    </SafeAreaView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:     { flex: 1, backgroundColor: COLORS.black },
  tabRow:        { maxHeight: 44, flexGrow: 0 },
  chipRow:       { maxHeight: 40, flexGrow: 0 },
  tabRowContent: { paddingHorizontal: SPACING.sm, gap: 6, paddingVertical: 6 },
  tab:           { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: '#1c1c1e' },
  tabActive:     { backgroundColor: COLORS.accent },
  tabText:       { fontSize: FONT_SIZES.sm, color: 'rgba(255,255,255,0.5)', fontWeight: '500' },
  tabTextActive: { color: COLORS.white, fontWeight: '700' },
  chip:          { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, backgroundColor: '#1c1c1e', borderWidth: 1, borderColor: '#2a2a2a' },
  chipActive:    { backgroundColor: '#2a2a2a', borderColor: COLORS.accent },
  chipText:      { fontSize: 11, color: 'rgba(255,255,255,0.4)', fontWeight: '500' },
  chipTextActive:{ color: COLORS.white, fontWeight: '700' },
  dayRow:        { flexDirection: 'row', gap: 8, paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs },
  dayBtn:        { flex: 1, paddingVertical: 6, borderRadius: 8, backgroundColor: '#1c1c1e', alignItems: 'center' },
  dayBtnActive:  { backgroundColor: COLORS.accent },
  dayBtnText:    { fontSize: FONT_SIZES.sm, color: 'rgba(255,255,255,0.5)', fontWeight: '500' },
  dayBtnTextActive: { color: COLORS.white, fontWeight: '700' },
  card:          { backgroundColor: '#1c1c1e', borderRadius: BORDER_RADIUS.lg, marginHorizontal: SPACING.md, marginVertical: 4, padding: SPACING.sm },
  cardContent:   { flexDirection: 'row', gap: SPACING.sm },
  thumbnail:     { width: 60, height: 60, borderRadius: BORDER_RADIUS.md },
  thumbPlaceholder: { backgroundColor: '#2a2a2a', justifyContent: 'center', alignItems: 'center' },
  cardInfo:      { flex: 1, justifyContent: 'center' },
  cardTitle:     { color: COLORS.white, fontSize: FONT_SIZES.md, fontWeight: '600' },
  cardPrice:     { color: COLORS.accent, fontSize: FONT_SIZES.sm, marginTop: 2 },
  reasonRow:     { flexDirection: 'row', marginTop: 4 },
  reasonBadge:   { paddingHorizontal: 8, paddingVertical: 3, borderRadius: BORDER_RADIUS.sm },
  reasonText:    { fontSize: 10, fontWeight: '700' },
  metaRow:       { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' },
  emailChip:     { flexDirection: 'row', alignItems: 'center', gap: 3 },
  emailChipText: { fontSize: 10 },
  metaDate:      { fontSize: 10, color: 'rgba(255,255,255,0.3)' },
  centerWrap:    { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  loadingText:   { color: 'rgba(255,255,255,0.4)', fontSize: FONT_SIZES.md },
  emptyText:     { color: 'rgba(255,255,255,0.3)', fontSize: FONT_SIZES.md, textAlign: 'center', marginTop: 12 },
  errorText:     { color: COLORS.error, fontSize: FONT_SIZES.md, textAlign: 'center', marginTop: 12 },
  retryBtn:      { marginTop: 16, backgroundColor: COLORS.accent, paddingHorizontal: 20, paddingVertical: 8, borderRadius: 8 },
  retryText:     { color: COLORS.white, fontWeight: '600' },
  loadMoreBtn:   { margin: SPACING.md, padding: SPACING.sm, backgroundColor: '#1c1c1e', borderRadius: BORDER_RADIUS.lg, alignItems: 'center' },
  loadMoreText:  { color: COLORS.accent, fontSize: FONT_SIZES.sm, fontWeight: '600' },
});
```

- [ ] **Step 2: Verify the file was created correctly**

```bash
wc -l flask-react-supabase-app/mobile/src/screens/admin/AdminExpiredListingsScreen.js
```

Expected: ~250 lines.

- [ ] **Step 3: Commit**

```bash
git add flask-react-supabase-app/mobile/src/screens/admin/AdminExpiredListingsScreen.js
git commit -m "feat(admin): add AdminExpiredListingsScreen with type/reason/days filters"
```

---

## Task 7: Frontend — AppNavigator + AdminDashboardScreen wiring

**Files:**
- Modify: `flask-react-supabase-app/mobile/src/navigation/AppNavigator.js`
- Modify: `flask-react-supabase-app/mobile/src/screens/admin/AdminDashboardScreen.js`

- [ ] **Step 1: Register the new route in AppNavigator.js**

Open `AppNavigator.js`. Find the existing admin import block (around line 42–50):

```js
import AdminDashboardScreen from '../screens/admin/AdminDashboardScreen';
import AdminUsersScreen from '../screens/admin/AdminUsersScreen';
import AdminListingsScreen from '../screens/admin/AdminListingsScreen';
import AdminDealersScreen from '../screens/admin/AdminDealersScreen';
import AdminReportsScreen from '../screens/admin/AdminReportsScreen';
import AdminUserDetailScreen from '../screens/admin/AdminUserDetailScreen';
import AdminListingDetailScreen from '../screens/admin/AdminListingDetailScreen';
import AdminDealerDetailScreen from '../screens/admin/AdminDealerDetailScreen';
import AdminMetricsScreen from '../screens/admin/AdminMetricsScreen';
```

Add one more import at the end of this block:

```js
import AdminExpiredListingsScreen from '../screens/admin/AdminExpiredListingsScreen';
```

Find the existing admin Stack.Screen registrations (around line 150–158):

```jsx
<Stack.Screen name="AdminDashboard" component={AdminDashboardScreen} options={{ title: 'Admin' }} />
<Stack.Screen name="AdminUsers" component={AdminUsersScreen} options={{ title: 'Users' }} />
<Stack.Screen name="AdminListings" component={AdminListingsScreen} options={{ title: 'Listings' }} />
<Stack.Screen name="AdminDealers" component={AdminDealersScreen} options={{ title: 'Dealers' }} />
<Stack.Screen name="AdminReports" component={AdminReportsScreen} options={{ title: 'Reports' }} />
<Stack.Screen name="AdminUserDetail" component={AdminUserDetailScreen} options={{ title: 'User Detail' }} />
<Stack.Screen name="AdminListingDetail" component={AdminListingDetailScreen} options={{ title: 'Listing Detail' }} />
<Stack.Screen name="AdminDealerDetail" component={AdminDealerDetailScreen} options={{ title: 'Dealer Detail' }} />
<Stack.Screen name="AdminMetrics" component={AdminMetricsScreen} options={{ title: 'Metrics' }} />
```

Add at the end:

```jsx
<Stack.Screen name="AdminExpiredListings" component={AdminExpiredListingsScreen} options={{ title: 'Expired & Deleted' }} />
```

- [ ] **Step 2: Add Expired inbox card to AdminDashboardScreen**

Open `AdminDashboardScreen.js`. The stats response already contains `expired_listings_total`. Find where `pendingApprovals` is computed (around line 230):

```js
const pendingApprovals = useMemo(() =>
  clamp(stats.cars_pending) + clamp(stats.bikes_pending) + clamp(stats.parts_pending) + clamp(stats.plates_pending),
```

After that computation, add:

```js
const expiredTotal = clamp(stats.expired_listings_total || 0);
```

Then find the inbox row (around line 320):

```jsx
<View style={styles.inboxRow}>
  <InboxCard
    label="Pending"
    sub="Approvals"
    value={pendingApprovals}
    color={COLORS.warning}
    icon="time-outline"
    onPress={() => navigation.navigate('AdminListings', { initialFilter: 'pending' })}
  />
  <InboxCard
    label="Open"
    sub="Reports"
    value={totalReports}
    color={COLORS.error}
    icon="flag-outline"
    onPress={() => navigation.navigate('AdminReports')}
  />
  <InboxCard
    label="Dealer"
    sub="Reviews"
    value={Math.max(0, totalDealers - verifiedDealers)}
    color={COLORS.info || COLORS.accent}
    icon="business-outline"
    onPress={() => navigation.navigate('AdminDealers')}
  />
</View>
```

Add a fourth inbox card:

```jsx
<View style={styles.inboxRow}>
  <InboxCard
    label="Pending"
    sub="Approvals"
    value={pendingApprovals}
    color={COLORS.warning}
    icon="time-outline"
    onPress={() => navigation.navigate('AdminListings', { initialFilter: 'pending' })}
  />
  <InboxCard
    label="Open"
    sub="Reports"
    value={totalReports}
    color={COLORS.error}
    icon="flag-outline"
    onPress={() => navigation.navigate('AdminReports')}
  />
  <InboxCard
    label="Dealer"
    sub="Reviews"
    value={Math.max(0, totalDealers - verifiedDealers)}
    color={COLORS.info || COLORS.accent}
    icon="business-outline"
    onPress={() => navigation.navigate('AdminDealers')}
  />
  <InboxCard
    label="Expired"
    sub="Listings"
    value={expiredTotal}
    color="#FF6F00"
    icon="time-outline"
    onPress={() => navigation.navigate('AdminExpiredListings')}
  />
</View>
```

- [ ] **Step 3: Verify**

Run the app. Navigate to Admin Dashboard. The inbox row should now show 4 cards: Pending / Open / Dealer / Expired. Tapping "Expired" navigates to the new AdminExpiredListingsScreen. Tapping a card there navigates to AdminListingDetailScreen with the correct itemType and itemId.

- [ ] **Step 4: Commit**

```bash
git add flask-react-supabase-app/mobile/src/navigation/AppNavigator.js \
        flask-react-supabase-app/mobile/src/screens/admin/AdminDashboardScreen.js
git commit -m "feat(admin): wire AdminExpiredListings route and dashboard inbox card"
```

---

## Final Verification Checklist

After all tasks complete, verify the following manually:

- [ ] Admin → tap expired listing → detail shows Lifecycle timeline, Sold Status card, Renewal Nudge card with email open/click indicator, Deletion timeline with reason
- [ ] Admin → Listings → filter "Expired" or "Deleted" → cards show sold_status pill where applicable
- [ ] Admin → Metrics → scroll to bottom → EMAIL section shows sent/delivered/opened/clicked counts + by-type chart
- [ ] Admin → Dashboard → 4 inbox cards including "Expired" → taps open AdminExpiredListingsScreen
- [ ] AdminExpiredListings → type filter (Cars/Bikes/Parts/Plates/All) changes results
- [ ] AdminExpiredListings → reason filter (Auto-expired/Admin deleted/Sold on DPH/etc) filters results
- [ ] AdminExpiredListings → days selector (7d/30d/90d) changes window
- [ ] AdminExpiredListings → tap card → navigates to correct AdminListingDetailScreen
- [ ] Backend tests pass: `cd flask-react-supabase-app/backend && python -m pytest test_admin_listing_overview_emails.py test_admin_expired_listings.py -v`
