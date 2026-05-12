# Deleted Listings Tab + User Deletion Email Notification

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Deleted" tab to the admin listings panel showing deletion history, and email the listing owner when an admin deletes their listing.

**Architecture:** The `listing_deletion_events` Supabase table already stores deletion metadata (listing_id, type, reason, deleted_by, created_at). We add a "deleted" status tab in AdminListings.js that queries this table via a new backend endpoint with filtering. A new `_send_listing_deleted_email` function sends branded HTML emails to the listing owner using the same Resend infrastructure.

**Tech Stack:** React (existing), Flask (existing), Resend API (existing), Supabase (existing).

---

## File Structure

| File | Responsibility |
|------|---------------|
| `frontend/src/components/AdminListings.js` | Add "Deleted" status tab, deleted listings view |
| `backend/app.py` | New `/api/admin/deleted-listings` endpoint with filtering; new `_send_listing_deleted_email` function; call email from `delete_listing` |

---

## Task 1: Backend — Deleted Listings Endpoint

**Files:**
- Modify: `backend/app.py` (add endpoint near line 12430, after existing admin delete endpoint)

- [ ] **Step 1: Add the deleted listings query endpoint**

Add this after the existing `delete_listing` endpoint and before `/api/check-session`:

```python
@app.route("/api/admin/deleted-listings", methods=["GET"])
@token_required
def get_deleted_listings(current_user):
    """Return deleted listings from deletion events table with filtering."""
    try:
        user_details = _get_user_details_with_admin_status(current_user)
        if not user_details or not user_details.get("is_admin"):
            return jsonify({"error": "Admin access required"}), 403

        listing_type = request.args.get("type", "").strip()
        limit = max(min(int(request.args.get("limit", 100)), 500), 1)
        offset = max(int(request.args.get("offset", 0)), 0)

        params = {
            "select": "*",
            "order": "created_at.desc",
            "limit": str(limit),
            "offset": str(offset),
        }

        if listing_type and listing_type in ("car", "bike", "part", "plate"):
            params["listing_type"] = f"eq.{listing_type}"

        response, status_code = supabase_request(
            "get", "/rest/v1/listing_deletion_events",
            params=params, use_service_role=True,
        )

        if status_code not in (200, 201):
            logger.error(f"Failed to fetch deleted listings: {response}")
            return jsonify([]), 500

        events = response if isinstance(response, list) else []

        # Get total count for pagination
        count_params = {"select": "id", "headers": {"Prefer": "count=exact"}}
        if listing_type and listing_type in ("car", "bike", "part", "plate"):
            count_params["listing_type"] = f"eq.{listing_type}"

        count_resp, count_status = supabase_request(
            "get", "/rest/v1/listing_deletion_events",
            params={
                "select": "id",
                "limit": "0",
                **({"listing_type": f"eq.{listing_type}"} if listing_type and listing_type in ("car", "bike", "part", "plate") else {}),
            },
            use_service_role=True,
            extra_headers={"Prefer": "count=exact"},
        )

        total = len(events)
        try:
            total = int(count_resp) if count_resp else len(events)
        except (ValueError, TypeError):
            total = len(events)

        return jsonify({"events": events, "total": total})

    except Exception as e:
        logger.error(f"Error fetching deleted listings: {e}")
        return jsonify({"events": [], "total": 0, "error": str(e)}), 500
```

- [ ] **Step 2: Verify Python syntax**

Run: `python3 -c "import ast; ast.parse(open('backend/app.py').read()); print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app.py
git commit -m "feat: add /api/admin/deleted-listings endpoint with type filtering"
```

---

## Task 2: Backend — Email on Admin Deletion

**Files:**
- Modify: `backend/app.py` (add `_send_listing_deleted_email` function near other email functions ~line 5100; call it from `delete_listing` endpoint ~line 12405)

- [ ] **Step 1: Add the deletion email function**

Add near the other `_send_listing_*` email functions (after `_send_new_listing_user_confirmation`):

```python
def _send_listing_deleted_email(user_email, item_type, listing_title, listing_id, reason):
    """Send email to user when their listing is removed by admin."""
    from_email = os.getenv("RESEND_FROM_EMAIL", "noreply@dphclassifieds.com")

    type_label = {"car": "Car", "bike": "Bike", "part": "Car Part", "plate": "Plate"}.get(item_type, "Listing")

    subject = f"Your {type_label} listing has been removed — DPH Classifieds"

    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
    <body style="margin:0;padding:0;background-color:#041008;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
      <div style="max-width:560px;margin:40px auto;padding:0 20px;">
        <div style="text-align:center;margin-bottom:32px;">
          <span style="font-size:22px;font-weight:700;letter-spacing:-0.03em;color:#ffffff;">DPH</span>
          <span style="font-size:22px;font-weight:700;letter-spacing:-0.03em;color:#8bd6b4;">Classifieds</span>
        </div>
        <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(139,214,180,0.12);border-radius:20px;padding:36px 32px;">
          <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#ffffff;">Listing Removed</h1>
          <p style="margin:0 0 24px;font-size:14px;color:rgba(255,255,255,0.55);">Your {type_label.lower()} listing has been removed by our moderation team.</p>
          <div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:12px;padding:16px;margin-bottom:24px;">
            <p style="margin:0 0 4px;font-size:13px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:0.1em;">Listing</p>
            <p style="margin:0;font-size:15px;font-weight:600;color:#ffffff;">{listing_title}</p>
          </div>
          <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:16px;margin-bottom:24px;">
            <p style="margin:0 0 4px;font-size:13px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:0.1em;">Reason</p>
            <p style="margin:0;font-size:14px;color:rgba(255,255,255,0.8);">{reason}</p>
          </div>
          <p style="margin:0 0 24px;font-size:13px;color:rgba(255,255,255,0.4);line-height:1.6;">
            If you believe this was removed in error, please reply to this email or contact us at support@dphclassifieds.com.
          </p>
          <a href="https://dphclassifieds.com/my-listings" style="display:inline-block;background:linear-gradient(135deg,#8bd6b4,#004e37);color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 28px;border-radius:10px;">Manage Listings</a>
        </div>
        <p style="text-align:center;font-size:12px;color:#64748b;margin-top:32px;">© {__import__('datetime').datetime.now().year} DPH Classifieds. All rights reserved.</p>
      </div>
    </body>
    </html>
    """

    payload = {
        "from": from_email,
        "to": [user_email],
        "subject": subject,
        "html": html_content,
    }
    reply_to = os.getenv("RESEND_REPLY_TO_EMAIL") or os.getenv("RESEND_TO_EMAIL")
    if reply_to:
        payload["reply_to"] = reply_to

    result, error = _send_resend_email(payload)
    if error:
        logger.error(f"Failed to send deletion email to {user_email}: {error}")
    else:
        logger.info(f"Deletion email sent to {user_email} for {item_type} {listing_id}")
    return result, error
```

- [ ] **Step 2: Call the email from the delete_listing endpoint**

In the `delete_listing` function (around line 12405), after `_record_listing_deletion_event` and before the success response, add the email send:

```python
        if response.status_code == 200 or response.status_code == 204:
            normalized_type = "part" if item_type == "car-part" else item_type
            _record_listing_deletion_event(
                listing_id=item_id,
                listing_type=normalized_type,
                reason=delete_reason,
                deleted_by_role="admin",
                deleted_by=current_user,
                metadata={"endpoint": "admin_delete"},
            )

            # Send deletion email to listing owner
            try:
                listing_resp = supabase_request(
                    "get", f"/rest/v1/{table_name}",
                    params={"select": "user_id,user_email,contact_email", "id": f"eq.{item_id}"},
                    use_service_role=True,
                )
                if isinstance(listing_resp, list) and listing_resp:
                    listing_data = listing_resp[0]
                    owner_email = listing_data.get("user_email") or listing_data.get("contact_email")
                    if not owner_email and listing_data.get("user_id"):
                        owner_email = get_user_email(listing_data["user_id"])
                    if owner_email and owner_email != "unknown@example.com":
                        _send_listing_deleted_email(
                            user_email=owner_email,
                            item_type=normalized_type,
                            listing_title=f"{item_type.title()} {item_id}",
                            listing_id=item_id,
                            reason=delete_reason,
                        )
            except Exception as email_err:
                logger.warning(f"Failed to send deletion email for {item_id}: {email_err}")

            logger.info(f"Admin {current_user} deleted {item_type} {item_id}")
            return jsonify(
                {"message": f"{item_type.title()} deleted successfully"}
            ), 200
```

**Note:** The listing data query above is done AFTER the delete call, but since we need the email before deletion we should actually fetch BEFORE deleting. Let me fix the order in the actual implementation — fetch listing data first, then delete, then record event + send email.

- [ ] **Step 3: Verify Python syntax**

Run: `python3 -c "import ast; ast.parse(open('backend/app.py').read()); print('OK')"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/app.py
git commit -m "feat: send deletion email to listing owner when admin removes listing"
```

---

## Task 3: Frontend — Deleted Tab in AdminListings

**Files:**
- Modify: `frontend/src/components/AdminListings.js`

- [ ] **Step 1: Add "deleted" to statusOptions**

At line 364-368, change:

```js
const statusOptions = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'deleted', label: 'Deleted' },
];
```

- [ ] **Step 2: Add deleted listings fetch logic**

In the `fetchListings` function (around line 76), add a branch for the deleted status:

```js
const fetchListings = async () => {
  setLoading(true);
  setError('');
  try {
    if (statusFilter === 'deleted') {
      // Fetch from deletion events endpoint
      const params = new URLSearchParams({ limit: '100' });
      if (filter === 'cars') params.set('type', 'car');
      else if (filter === 'bikes') params.set('type', 'bike');
      else if (filter === 'parts') params.set('type', 'part');
      else if (filter === 'plates') params.set('type', 'plate');

      const response = await apiClient.request(`/api/admin/deleted-listings?${params}`);
      const events = Array.isArray(response?.events) ? response.events : Array.isArray(response) ? response : [];

      // Map deletion events to listing-like objects for display
      const mappedListings = events.map((evt) => ({
        id: evt.listing_id,
        listing_type: evt.listing_type,
        title: `${evt.listing_type} ${evt.listing_id.slice(0, 8)}`,
        status: 'deleted',
        deleted_reason: evt.reason,
        deleted_by_role: evt.deleted_by_role,
        deleted_at: evt.created_at,
        created_at: evt.created_at,
        // These fields are lost on hard delete, show what we can
        car_manufacturer: '',
        car_model: '',
      }));

      setListings(mappedListings);
      setStats({});
      return;
    }

    // ... existing fetch logic for pending/approved/rejected ...
  }
```

- [ ] **Step 3: Add deleted listing row rendering**

In the table body rendering, add a check for deleted status. When `statusFilter === 'deleted'`, show different columns:

Find the table row rendering section and add a conditional for deleted items. The key fields to show are:
- Listing type badge
- Listing ID (truncated)
- Deletion reason
- Deleted by (admin/system/user)
- Deletion date

- [ ] **Step 4: Hide delete button for deleted items**

The delete action button should not appear when `statusFilter === 'deleted'` since these are already deleted.

- [ ] **Step 5: Verify build**

Run: `cd frontend && npx react-scripts build 2>&1 | tail -5`
Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/AdminListings.js
git commit -m "feat: add Deleted tab to admin listings panel"
```

---

## Task 4: Final Verification

- [ ] **Step 1: Full frontend build**

```bash
cd frontend && npx react-scripts build 2>&1 | tail -10
```
Expected: Build succeeds.

- [ ] **Step 2: Python syntax check**

```bash
python3 -c "import ast; ast.parse(open('backend/app.py').read()); print('OK')"
```
Expected: `OK`

- [ ] **Step 3: Commit all**

```bash
git add -A && git commit -m "feat: deleted listings tab and admin deletion email notifications"
```
