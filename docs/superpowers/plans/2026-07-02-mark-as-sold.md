# Mark as Sold — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Sold on DPH" / "Sold elsewhere" admin actions that set `status='sold'` and remove the listing from the public site.

**Architecture:** The existing `set-status` backend endpoint is extended to accept `sold_on_dph` and `sold_elsewhere` as alias values — it maps them to `status='sold'` + `sold_status=<alias>`. The frontend status-change modal (AdminListings.js) and the detail-page sidebar (AdminListingDetail.jsx) each grow the new options. Cache invalidation is already wired for `sold` since it becomes a terminal status.

**Tech Stack:** Flask (Python), React (JS), Supabase/Postgres, Redis cache

---

### Task 1: Backend — extend set-status to handle sold

**Files:**
- Modify: `flask-react-supabase-app/backend/app.py:12715–12795`

- [ ] **Step 1: Expand ALLOWED_STATUSES and add sold handling**

Replace the block starting at line 12715 in `app.py`:

```python
    ALLOWED_STATUSES = {"approved", "rejected", "deleted"}
    if new_status not in ALLOWED_STATUSES:
        return jsonify({"error": f"status must be one of {sorted(ALLOWED_STATUSES)}"}), 400
```

With:

```python
    ALLOWED_STATUSES = {"approved", "rejected", "deleted", "sold_on_dph", "sold_elsewhere"}
    if new_status not in ALLOWED_STATUSES:
        return jsonify({"error": f"status must be one of {sorted(ALLOWED_STATUSES)}"}), 400

    # sold_on_dph / sold_elsewhere are sub-types; both map to status='sold'
    is_sold_action = new_status in ("sold_on_dph", "sold_elsewhere")
    db_status = "sold" if is_sold_action else new_status
```

- [ ] **Step 2: Replace `update_data = {"status": new_status}` with db_status**

Find line ~12737:
```python
    update_data = {"status": new_status}
```
Replace with:
```python
    update_data = {"status": db_status}
```

- [ ] **Step 3: Add the sold branch to the if/elif chain**

After the existing `elif new_status == "rejected":` branch (line ~12764), add:

```python
    elif is_sold_action:
        import datetime as _dt
        update_data["is_approved"] = False
        update_data["sold_status"] = new_status          # 'sold_on_dph' or 'sold_elsewhere'
        update_data["sold_status_set_at"] = _dt.datetime.now(_dt.timezone.utc).isoformat()
```

- [ ] **Step 4: Extend the cache-invalidation condition to include sold actions**

Find line ~12781:
```python
    if new_status in ("approved", "deleted", "rejected"):
        try:
            _invalidate_public_inventory_cache(item_type)
```
Replace with:
```python
    if new_status in ("approved", "deleted", "rejected") or is_sold_action:
        try:
            _invalidate_public_inventory_cache(item_type)
```

- [ ] **Step 5: Update the admin action log to use db_status**

Find line ~12792:
```python
            action=f"listing_status_set_{new_status}",
```
Replace with:
```python
            action=f"listing_status_set_{db_status}",
            metadata={"item_type": item_type, "item_id": item_id, "sold_status": new_status if is_sold_action else None},
```

- [ ] **Step 6: Smoke-test the endpoint manually**

```bash
# From project root — replace TOKEN, ID, and TYPE with real values
curl -s -X POST http://localhost:5000/api/admin/listings/cars/<ID>/set-status \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"status":"sold_on_dph"}' | python3 -m json.tool
# Expected: {"success": true, "status": "sold", ...}

curl -s -X POST http://localhost:5000/api/admin/listings/cars/<ID>/set-status \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"status":"invalid"}' | python3 -m json.tool
# Expected: 400 {"error": "status must be one of ..."}
```

- [ ] **Step 7: Commit**

```bash
git add flask-react-supabase-app/backend/app.py
git commit -m "feat(admin): extend set-status endpoint to support sold_on_dph / sold_elsewhere"
```

---

### Task 2: Frontend — add sold options to AdminListings status-change modal

**Files:**
- Modify: `flask-react-supabase-app/frontend/src/components/AdminListings.js:545–580`

- [ ] **Step 1: Add sold options to STATUS_CHANGE_OPTIONS**

Find line 545 in `AdminListings.js`:
```js
  const STATUS_CHANGE_OPTIONS = {
    approved: [{ value: 'rejected', label: 'Rejected — notify seller' }, { value: 'deleted', label: 'Deleted — remove permanently' }],
    active:   [{ value: 'rejected', label: 'Rejected — notify seller' }, { value: 'deleted', label: 'Deleted — remove permanently' }],
    rejected: [{ value: 'approved', label: 'Approved — restore live' }, { value: 'deleted', label: 'Deleted — remove permanently' }],
    expired:  [{ value: 'approved', label: 'Approved — restore live' }, { value: 'deleted', label: 'Deleted — remove permanently' }],
    deleted:  [{ value: 'approved', label: 'Approved — restore live' }],
    pending:  [{ value: 'rejected', label: 'Rejected — notify seller' }, { value: 'deleted', label: 'Deleted — remove permanently' }],
  };
```

Replace with:
```js
  const STATUS_CHANGE_OPTIONS = {
    approved: [
      { value: 'rejected',     label: 'Rejected — notify seller' },
      { value: 'sold_on_dph',  label: 'Sold on DPH — remove from platform' },
      { value: 'sold_elsewhere', label: 'Sold elsewhere — remove from platform' },
      { value: 'deleted',      label: 'Deleted — remove permanently' },
    ],
    active: [
      { value: 'rejected',     label: 'Rejected — notify seller' },
      { value: 'sold_on_dph',  label: 'Sold on DPH — remove from platform' },
      { value: 'sold_elsewhere', label: 'Sold elsewhere — remove from platform' },
      { value: 'deleted',      label: 'Deleted — remove permanently' },
    ],
    rejected: [{ value: 'approved', label: 'Approved — restore live' }, { value: 'deleted', label: 'Deleted — remove permanently' }],
    expired:  [{ value: 'approved', label: 'Approved — restore live' }, { value: 'deleted', label: 'Deleted — remove permanently' }],
    deleted:  [{ value: 'approved', label: 'Approved — restore live' }],
    pending: [
      { value: 'rejected',     label: 'Rejected — notify seller' },
      { value: 'sold_on_dph',  label: 'Sold on DPH — remove from platform' },
      { value: 'sold_elsewhere', label: 'Sold elsewhere — remove from platform' },
      { value: 'deleted',      label: 'Deleted — remove permanently' },
    ],
  };
```

- [ ] **Step 2: Fix the toast label for sold sub-types**

Find in `handleSetStatus` (line ~568):
```js
      const label = pendingStatusValue.charAt(0).toUpperCase() + pendingStatusValue.slice(1);
      showToast(`Listing set to ${label} successfully`, 'success');
```

Replace with:
```js
      const SOLD_LABELS = { sold_on_dph: 'Sold on DPH', sold_elsewhere: 'Sold elsewhere' };
      const label = SOLD_LABELS[pendingStatusValue]
        || (pendingStatusValue.charAt(0).toUpperCase() + pendingStatusValue.slice(1));
      showToast(`Listing marked as ${label} successfully`, 'success');
```

- [ ] **Step 3: Verify in the browser**

Start the dev server and open the Admin Listings page. Pick an approved listing, click the Sliders icon, and confirm the dropdown shows:
- Rejected — notify seller
- Sold on DPH — remove from platform
- Sold elsewhere — remove from platform
- Deleted — remove permanently

Select "Sold on DPH", confirm, and verify the listing disappears from the public listings page.

- [ ] **Step 4: Commit**

```bash
git add flask-react-supabase-app/frontend/src/components/AdminListings.js
git commit -m "feat(admin): add Sold on DPH / Sold elsewhere to listings status-change modal"
```

---

### Task 3: Frontend — add Mark as Sold section to AdminListingDetail sidebar

**Files:**
- Modify: `flask-react-supabase-app/frontend/src/components/AdminListingDetail.jsx:490–970`

- [ ] **Step 1: Add soldSubType state**

In the component's state block, find where other modal/action states are declared (search for `const [actionLoading`) and add after it:

```js
  const [soldSubType, setSoldSubType] = useState('sold_on_dph');
```

Make sure `useState` is already imported (it will be).

- [ ] **Step 2: Add handleMarkAsSold function**

Add this function after `handleModerationAction` (around line 291):

```js
  const handleMarkAsSold = async () => {
    try {
      setActionLoading(true);
      await apiClient.post(
        `/api/admin/listings/${itemType}/${itemId}/set-status`,
        { status: soldSubType }
      );
      navigate(`/admin/listings?filter=${approvalRouteType}&status=approved`);
    } catch (soldError) {
      setError(soldError.message || 'Failed to mark listing as sold');
    } finally {
      setActionLoading(false);
    }
  };
```

- [ ] **Step 3: Add Mark as Sold UI block in admin actions sidebar**

Find the "Status flip" comment block (line ~948):
```jsx
              {/* Status flip */}
              {isActive ? (
```

Insert a new "Mark as Sold" block **before** this block:

```jsx
              {/* Mark as Sold */}
              {isActive && (
                <div className="space-y-2">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-white/40 font-medium">Mark as sold</p>
                  <select
                    value={soldSubType}
                    onChange={(e) => setSoldSubType(e.target.value)}
                    className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-white/80 focus:outline-none focus:border-sky-500/40 transition [color-scheme:dark]"
                  >
                    <option value="sold_on_dph">Sold on DPH</option>
                    <option value="sold_elsewhere">Sold elsewhere</option>
                  </select>
                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={handleMarkAsSold}
                    className="w-full inline-flex items-center justify-center gap-2 bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/30 rounded-xl px-4 py-2.5 text-sm transition font-semibold disabled:opacity-50"
                  >
                    {actionLoading ? 'Marking…' : 'Confirm sold'}
                  </button>
                </div>
              )}

              <div className="border-t border-white/[0.06] my-1" />
```

- [ ] **Step 4: Verify in browser**

Open an approved listing's detail page. Confirm:
1. "Mark as sold" section appears with a dropdown (Sold on DPH / Sold elsewhere) and "Confirm sold" button.
2. Selecting "Sold on DPH" and clicking confirm redirects to admin listings and the listing is gone from public.
3. For a rejected/expired/deleted listing, the sold section does NOT appear (guarded by `isActive`).

- [ ] **Step 5: Commit**

```bash
git add flask-react-supabase-app/frontend/src/components/AdminListingDetail.jsx
git commit -m "feat(admin): add Mark as Sold action to listing detail sidebar"
```
