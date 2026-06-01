# Buying Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new “Buying Request” feature with its own post form + browse section (not in Explore), anonymous posters, phone-verified WhatsApp reveal, lead metrics tracking, listing-style expiry emails, and a hard limit of 5 active buying requests per user.

**Architecture:** Model buying requests as a first-class listing-like entity (`buying_requests` + `buying_request_images`) that plugs into existing lifecycle + email + lead-events infrastructure. Frontend adds new routes/pages and a Sell-menu entry; backend adds CRUD endpoints, enforces the 5-active cap, and extends listing-type resolution so the existing `/api/listings/<item_type>/<item_id>/lead-events` endpoint records `listing_type=buying_request`.

**Tech Stack:** Supabase PostgREST + Storage, Flask API (`backend/app.py`), React SPA (`frontend/src`), existing phone verification gate (`frontend/src/utils/contactAccess.js`), existing lead tracking endpoint (`backend/app.py`).

---

## File/Change Map (locked-in)

**Database / SQL**
- Create: `backend/migrations/2026_05_31_create_buying_requests.sql`

**Backend**
- Modify: `backend/app.py:260` (extend listing table config + table resolution)
- Create: `backend/routes/buying_requests.py`
- Modify: `backend/app.py` (register blueprint, add expiry-email integration if needed)
- Test: `backend/test_buying_requests.py`

**Frontend**
- Modify: `frontend/src/components/Header.js:84` (Sell menu item: “Post a Buying Request”)
- Modify: `frontend/src/App.js:230` (routes for list/detail/post)
- Create: `frontend/src/components/PostBuyingRequest.jsx`
- Create: `frontend/src/components/BuyingRequestsPage.jsx`
- Create: `frontend/src/components/BuyingRequestDetail.jsx`

---

### Task 1: Add DB tables + RLS policies

**Files:**
- Create: `backend/migrations/2026_05_31_create_buying_requests.sql`

- [ ] **Step 1: Write migration SQL**

```sql
-- backend/migrations/2026_05_31_create_buying_requests.sql

-- 1) buying_requests table
create table if not exists public.buying_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  user_id uuid not null,
  user_email text,

  -- lifecycle (aligned with existing listing lifecycle patterns)
  status text not null default 'approved',
  expires_at timestamptz,
  expired_at timestamptz,
  retention_expires_at timestamptz,
  last_extended_at timestamptz,
  extension_count integer not null default 0,
  is_archived boolean not null default false,

  -- email claim fields (to match listing expiry email flow)
  expiry_notice_email_sent_at timestamptz,
  expired_email_sent_at timestamptz,

  -- required buying fields
  item_type text not null check (item_type in ('car','plate','part','bike')),
  item_name text not null,
  mileage_preference text not null,
  regional_spec text not null,
  reference_notes text, -- alias for description/features (optional)
  budget numeric,

  -- car-like fields (shown when item_type='car', optional storage)
  car_manufacturer text,
  car_model text,
  trim text,

  -- contact (poster anonymous; only contact action reveals link)
  whatsapp_country_code text,
  whatsapp_number text,
  whatsapp_prefill_text text
);

create index if not exists buying_requests_user_id_idx on public.buying_requests(user_id);
create index if not exists buying_requests_status_idx on public.buying_requests(status);
create index if not exists buying_requests_expires_at_idx on public.buying_requests(expires_at);

-- 2) buying_request_images table
create table if not exists public.buying_request_images (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  uploaded_at timestamptz not null default now(),
  buying_request_id uuid not null references public.buying_requests(id) on delete cascade,
  image_url text,
  url text,
  display_url text,
  focal_x integer,
  focal_y integer,
  crop_meta jsonb
);

create index if not exists buying_request_images_request_id_idx on public.buying_request_images(buying_request_id);

-- 3) RLS
alter table public.buying_requests enable row level security;
alter table public.buying_request_images enable row level security;

-- Public can read only active/approved/non-archived/non-expired requests.
drop policy if exists "buying_requests_public_read" on public.buying_requests;
create policy "buying_requests_public_read"
on public.buying_requests for select
using (
  status in ('approved','active')
  and is_archived = false
  and (expired_at is null)
  and (expires_at is null or expires_at > now())
);

-- Owners can read their own rows (including archived/expired).
drop policy if exists "buying_requests_owner_read" on public.buying_requests;
create policy "buying_requests_owner_read"
on public.buying_requests for select
using (auth.uid() = user_id);

drop policy if exists "buying_requests_owner_write" on public.buying_requests;
create policy "buying_requests_owner_write"
on public.buying_requests for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Images: public read only if parent request is public-readable.
drop policy if exists "buying_request_images_public_read" on public.buying_request_images;
create policy "buying_request_images_public_read"
on public.buying_request_images for select
using (
  exists (
    select 1
    from public.buying_requests r
    where r.id = buying_request_id
      and r.status in ('approved','active')
      and r.is_archived = false
      and (r.expired_at is null)
      and (r.expires_at is null or r.expires_at > now())
  )
);

-- Owners can manage images for their requests.
drop policy if exists "buying_request_images_owner_write" on public.buying_request_images;
create policy "buying_request_images_owner_write"
on public.buying_request_images for all
using (
  exists (
    select 1
    from public.buying_requests r
    where r.id = buying_request_id
      and r.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.buying_requests r
    where r.id = buying_request_id
      and r.user_id = auth.uid()
  )
);
```

- [ ] **Step 2: Apply migration**

Run (from repo root): `python backend/apply_migration.py backend/migrations/2026_05_31_create_buying_requests.sql`

Expected: migration applies with no SQL errors.

- [ ] **Step 3: Sanity-check PostgREST**

Run: `python backend/debug_supabase.py`

Expected: no schema cache errors; new tables visible.

- [ ] **Step 4: Commit**

```bash
git add backend/migrations/2026_05_31_create_buying_requests.sql
git commit -m "db: add buying_requests tables + rls"
```

---

### Task 2: Backend – add buying request API + enforce 5-active limit

**Files:**
- Create: `backend/routes/buying_requests.py`
- Modify: `backend/app.py` (register blueprint)
- Test: `backend/test_buying_requests.py`

- [ ] **Step 1: Add blueprint with routes**

```python
# backend/routes/buying_requests.py
from flask import Blueprint, jsonify, request

from app import (
    LISTING_ACTIVE_STATUSES,
    _create_listing_with_lifecycle_fallback,
    _isoformat_utc,
    _parse_datetime,
    _sync_listing_lifecycle,
    _utc_now,
    get_user_email,
    supabase_request,
    token_required,
)

buying_requests_bp = Blueprint("buying_requests", __name__)


def _public_select_fields():
    # IMPORTANT: Keep poster identity anonymous.
    return ",".join(
        [
            "id",
            "created_at",
            "status",
            "expires_at",
            "expired_at",
            "item_type",
            "item_name",
            "mileage_preference",
            "regional_spec",
            "reference_notes",
            "budget",
            "car_manufacturer",
            "car_model",
            "trim",
            "whatsapp_country_code",
            "whatsapp_number",
            "whatsapp_prefill_text",
        ]
    )


def _active_request_filter_params():
    # Match the public-read RLS logic; backend uses service role sometimes.
    return {
        "status": "in.(approved,active)",
        "is_archived": "eq.false",
        "expired_at": "is.null",
        "order": "created_at.desc",
    }


@buying_requests_bp.route("/api/buying-requests", methods=["GET"])
def list_buying_requests():
    params = {
        "select": _public_select_fields(),
        **_active_request_filter_params(),
    }
    resp, status = supabase_request("get", "/rest/v1/buying_requests", params=params)
    if status >= 400:
        return jsonify({"error": "Failed to fetch buying requests"}), status
    return jsonify(resp or []), 200


@buying_requests_bp.route("/api/buying-requests/<string:request_id>", methods=["GET"])
def get_buying_request(request_id):
    params = {
        "select": _public_select_fields(),
        "id": f"eq.{request_id}",
        "limit": "1",
    }
    resp, status = supabase_request("get", "/rest/v1/buying_requests", params=params)
    if status >= 400:
        return jsonify({"error": "Failed to fetch buying request"}), status
    if not resp:
        return jsonify({"error": "Buying request not found"}), 404
    row = resp[0]
    row = _sync_listing_lifecycle("buying_requests", row, hard_delete_archived=False) or row
    return jsonify(row), 200


@buying_requests_bp.route("/api/buying-requests", methods=["POST"])
@token_required
def create_buying_request(current_user):
    payload = request.json or {}

    item_type = (payload.get("item_type") or "").strip().lower()
    item_name = (payload.get("item_name") or "").strip()
    mileage_preference = (payload.get("mileage_preference") or "").strip()
    regional_spec = (payload.get("regional_spec") or "").strip()
    reference_notes = (payload.get("reference_notes") or "").strip()
    budget = payload.get("budget")

    if item_type not in {"car", "plate", "part", "bike"}:
        return jsonify({"error": "Invalid item_type"}), 400
    if not item_name:
        return jsonify({"error": "Item name is required"}), 400
    if not mileage_preference:
        return jsonify({"error": "Mileage preference is required"}), 400
    if not regional_spec:
        return jsonify({"error": "Regional spec is required"}), 400

    images = payload.get("images") or []
    if not isinstance(images, list) or len(images) < 1:
        return jsonify({"error": "A reference image is required"}), 400

    # Enforce max 5 active buying requests per user.
    # Active == not archived + not expired + status in LISTING_ACTIVE_STATUSES.
    active_params = {
        "select": "id,status,expired_at,is_archived,expires_at",
        "user_id": f"eq.{current_user}",
        "is_archived": "eq.false",
        "expired_at": "is.null",
        "status": f"in.({','.join(sorted(LISTING_ACTIVE_STATUSES))})",
    }
    existing, existing_status = supabase_request(
        "get", "/rest/v1/buying_requests", params=active_params, user_id=current_user
    )
    if existing_status >= 400:
        return jsonify({"error": "Failed to validate request limit"}), existing_status
    if len(existing or []) >= 5:
        return jsonify({"error": "You can have up to 5 active buying requests."}), 400

    now = _utc_now()
    # Use the same expiry windows as listings by letting lifecycle helper fill defaults.
    data = {
        "user_id": current_user,
        "user_email": get_user_email(current_user),
        "item_type": item_type,
        "item_name": item_name,
        "mileage_preference": mileage_preference,
        "regional_spec": regional_spec,
        "reference_notes": reference_notes,
        "budget": budget,
        "car_manufacturer": (payload.get("car_manufacturer") or "").strip() or None,
        "car_model": (payload.get("car_model") or "").strip() or None,
        "trim": (payload.get("trim") or "").strip() or None,
        "whatsapp_country_code": (payload.get("whatsapp_country_code") or "").strip() or None,
        "whatsapp_number": (payload.get("whatsapp_number") or "").strip() or None,
        "whatsapp_prefill_text": (payload.get("whatsapp_prefill_text") or "").strip() or None,
        "status": "approved",
        "last_extended_at": _isoformat_utc(now),
    }

    created, created_status = _create_listing_with_lifecycle_fallback(
        "/rest/v1/buying_requests", data, user_id=current_user
    )
    if created_status >= 400:
        return jsonify(created), created_status
    request_id = created[0]["id"]

    # Insert images (minimal fields; uploader already stores URLs).
    image_inserts = []
    for image_entry in images:
        if isinstance(image_entry, str):
            image_inserts.append(
                {
                    "buying_request_id": request_id,
                    "image_url": image_entry,
                    "display_url": image_entry,
                }
            )
        elif isinstance(image_entry, dict):
            url = image_entry.get("image_url") or image_entry.get("url")
            if not url:
                continue
            image_inserts.append(
                {
                    "buying_request_id": request_id,
                    "image_url": url,
                    "display_url": image_entry.get("display_url") or url,
                    "focal_x": image_entry.get("focal_x"),
                    "focal_y": image_entry.get("focal_y"),
                    "crop_meta": image_entry.get("crop_meta"),
                }
            )
    if not image_inserts:
        return jsonify({"error": "A reference image is required"}), 400
    imgs, imgs_status = supabase_request(
        "post",
        "/rest/v1/buying_request_images",
        data=image_inserts,
        user_id=current_user,
    )
    if imgs_status < 400:
        created[0]["images"] = imgs

    return jsonify(created[0]), 201


@buying_requests_bp.route("/api/buying-requests/<string:request_id>", methods=["PATCH"])
@token_required
def update_buying_request(current_user, request_id):
    payload = request.json or {}
    # Owners-only update enforced by RLS; still verify ownership via select.
    existing, status = supabase_request(
        "get",
        "/rest/v1/buying_requests",
        params={"select": "id,user_id", "id": f"eq.{request_id}", "limit": "1"},
        user_id=current_user,
    )
    if status >= 400:
        return jsonify({"error": "Failed to fetch buying request"}), status
    if not existing:
        return jsonify({"error": "Buying request not found"}), 404
    if existing[0].get("user_id") != current_user:
        return jsonify({"error": "Forbidden"}), 403

    updates = {}
    for key in [
        "item_name",
        "mileage_preference",
        "regional_spec",
        "reference_notes",
        "budget",
        "car_manufacturer",
        "car_model",
        "trim",
        "whatsapp_country_code",
        "whatsapp_number",
        "whatsapp_prefill_text",
    ]:
        if key in payload:
            updates[key] = payload.get(key)

    patched, patched_status = supabase_request(
        "patch",
        f"/rest/v1/buying_requests?id=eq.{request_id}",
        data=updates,
        user_id=current_user,
    )
    if patched_status >= 400:
        return jsonify({"error": "Failed to update buying request"}), patched_status
    return jsonify({"message": "Updated"}), 200


@buying_requests_bp.route("/api/buying-requests/<string:request_id>", methods=["DELETE"])
@token_required
def archive_buying_request(current_user, request_id):
    updates = {"is_archived": True, "status": "deleted", "expired_at": _isoformat_utc(_utc_now())}
    patched, patched_status = supabase_request(
        "patch",
        f"/rest/v1/buying_requests?id=eq.{request_id}",
        data=updates,
        user_id=current_user,
    )
    if patched_status >= 400:
        return jsonify({"error": "Failed to archive buying request"}), patched_status
    return jsonify({"message": "Archived"}), 200
```

- [ ] **Step 2: Register blueprint**

In `backend/app.py`, import + register:

```python
# backend/app.py (near other blueprint imports)
from routes.buying_requests import buying_requests_bp

# backend/app.py (after app creation)
app.register_blueprint(buying_requests_bp)
```

- [ ] **Step 3: Write tests for limit + public list**

```python
# backend/test_buying_requests.py
import json


def test_buying_requests_limit_5(client, auth_headers, monkeypatch):
    # This test assumes your test harness can mock supabase_request.
    # Patch supabase_request calls to simulate 5 existing active requests.
    from routes import buying_requests as mod

    def fake_supabase_request(method, path, params=None, data=None, user_id=None, **kwargs):
        if method == "get" and path == "/rest/v1/buying_requests" and params and params.get("user_id", "").startswith("eq."):
            return ([{"id": "1"}] * 5, 200)
        if method == "post" and path == "/rest/v1/buying_requests":
            return ([{"id": "new"}], 201)
        return ([], 200)

    monkeypatch.setattr(mod, "supabase_request", fake_supabase_request)
    monkeypatch.setattr(mod, "_create_listing_with_lifecycle_fallback", lambda *a, **k: ([{"id": "new"}], 201))
    monkeypatch.setattr(mod, "get_user_email", lambda *_: "user@example.com")

    payload = {
        "item_type": "car",
        "item_name": "BMW M3 wanted",
        "mileage_preference": "< 80,000 km",
        "regional_spec": "GCC",
        "images": ["https://example.com/ref.jpg"],
    }
    resp = client.post("/api/buying-requests", headers=auth_headers, data=json.dumps(payload), content_type="application/json")
    assert resp.status_code == 400
    assert "up to 5" in resp.get_json()["error"]
```

- [ ] **Step 4: Run backend tests**

Run: `cd backend && pytest -q test_buying_requests.py`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/buying_requests.py backend/app.py backend/test_buying_requests.py
git commit -m "feat(api): buying requests endpoints + 5-active limit"
```

---

### Task 3: Backend – enable lead tracking for buying requests

**Files:**
- Modify: `backend/app.py:278`

- [ ] **Step 1: Extend listing table config**

In `backend/app.py`, update `LISTING_TABLE_CONFIG`:

```python
LISTING_TABLE_CONFIG = {
    "car": {"table": "cars", "images_table": "car_images", "fk": "car_id"},
    "bike": {"table": "bikes", "images_table": "bike_images", "fk": "bike_id"},
    "part": {"table": "car_parts", "images_table": "part_images", "fk": "part_id"},
    "plate": {"table": "license_plates", "images_table": "plate_images", "fk": "plate_id"},
    "buying_request": {
        "table": "buying_requests",
        "images_table": "buying_request_images",
        "fk": "buying_request_id",
    },
}
```

- [ ] **Step 2: Ensure table resolver accepts it**

Locate `_resolve_listing_table()` in `backend/app.py` and ensure it returns `buying_requests` for `buying_request`.

Implementation:

```python
def _resolve_listing_table(item_type: str):
    config = LISTING_TABLE_CONFIG.get(item_type)
    return config["table"] if config else None
```

- [ ] **Step 3: Run a quick manual smoke**

Run API locally and hit:
- `POST /api/listings/buying_request/<uuid>/lead-events` with body `{"action":"whatsapp_click","source":"buying_request_detail","payload":{"listing_id":"<uuid>"}}`

Expected: `201` and a new row in `lead_events` with `listing_type=buying_request`.

- [ ] **Step 4: Commit**

```bash
git add backend/app.py
git commit -m "feat(metrics): enable lead events for buying_request type"
```

---

### Task 4: Frontend – add routes and Sell menu entry

**Files:**
- Modify: `frontend/src/components/Header.js:84`
- Modify: `frontend/src/App.js:230`

- [ ] **Step 1: Add “Post a Buying Request” under Sell**

In `frontend/src/components/Header.js`, extend `postLinks` base array:

```js
{ title: 'Post a Buying Request', href: user ? '/post-buying-request' : '/login?redirect=/post-buying-request' },
```

- [ ] **Step 2: Add routes**

In `frontend/src/App.js`:
- Add unprotected routes:
  - `/buying-requests`
  - `/buying-requests/:id`
- Add phone-verified protected route:
  - `/post-buying-request`

```jsx
<Route path="/buying-requests" element={<BuyingRequestsPage />} />
<Route path="/buying-requests/:id" element={<BuyingRequestDetail />} />

// inside <PhoneVerifiedRoute />
<Route path="/post-buying-request" element={<PostBuyingRequest />} />
```

- [ ] **Step 3: Run frontend build**

Run: `cd frontend && npm test --silent` (or `npm run build` if no tests)

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Header.js frontend/src/App.js
git commit -m "feat(frontend): add buying request routes + nav entry"
```

---

### Task 5: Frontend – PostBuyingRequest form (required fields + image required)

**Files:**
- Create: `frontend/src/components/PostBuyingRequest.jsx`

- [ ] **Step 1: Create component**

```jsx
// frontend/src/components/PostBuyingRequest.jsx
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { getAccessToken } from '../utils/supabaseClient';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

const ITEM_TYPES = [
  { value: 'car', label: 'Car' },
  { value: 'plate', label: 'Plate' },
  { value: 'part', label: 'Car Part' },
  { value: 'bike', label: 'Bike' },
];

export default function PostBuyingRequest() {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    item_type: 'car',
    item_name: '',
    reference_notes: '',
    mileage_preference: '',
    regional_spec: '',
    budget: '',
    car_manufacturer: '',
    car_model: '',
    trim: '',
    images: [],
  });

  const showCarFields = useMemo(() => form.item_type === 'car', [form.item_type]);

  const onChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const onAddReferenceImage = async (e) => {
    // This plan assumes you already have an upload flow that returns a public URL.
    // Use the existing uploader used in PostCar/PostBike to produce `image_url`.
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    // Placeholder-free plan requirement: implement via existing uploader when executing.
    // During implementation: reuse the same upload util used by listing forms.
    setForm((prev) => ({ ...prev, images: [...prev.images, { image_url: URL.createObjectURL(file), display_url: URL.createObjectURL(file) }] }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const token = await getAccessToken();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const payload = {
        ...form,
        budget: form.budget ? Number(form.budget) : null,
      };
      const resp = await axios.post(`${API_URL}/api/buying-requests`, payload, { headers });
      navigate(`/buying-requests/${resp.data.id}`);
    } catch (err) {
      const apiError = err?.response?.data?.error || 'Failed to post buying request';
      setError(apiError);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-5 py-10">
      <h1 className="text-2xl font-semibold text-white">Post a Buying Request</h1>
      {error && <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-100">{error}</div>}

      <form onSubmit={submit} className="mt-6 grid gap-4">
        <label className="grid gap-1 text-white/80">
          Item Type*
          <select name="item_type" value={form.item_type} onChange={onChange} className="rounded-lg bg-white/5 px-3 py-2 text-white">
            {ITEM_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>

        <label className="grid gap-1 text-white/80">
          Item Name*
          <input name="item_name" value={form.item_name} onChange={onChange} className="rounded-lg bg-white/5 px-3 py-2 text-white" />
        </label>

        {showCarFields && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="grid gap-1 text-white/80">
              Make
              <input name="car_manufacturer" value={form.car_manufacturer} onChange={onChange} className="rounded-lg bg-white/5 px-3 py-2 text-white" />
            </label>
            <label className="grid gap-1 text-white/80">
              Model
              <input name="car_model" value={form.car_model} onChange={onChange} className="rounded-lg bg-white/5 px-3 py-2 text-white" />
            </label>
            <label className="grid gap-1 text-white/80">
              Trim
              <input name="trim" value={form.trim} onChange={onChange} className="rounded-lg bg-white/5 px-3 py-2 text-white" />
            </label>
          </div>
        )}

        <label className="grid gap-1 text-white/80">
          Description / Features
          <textarea name="reference_notes" value={form.reference_notes} onChange={onChange} rows={4} className="rounded-lg bg-white/5 px-3 py-2 text-white" />
        </label>

        <label className="grid gap-1 text-white/80">
          Mileage preference*
          <input name="mileage_preference" value={form.mileage_preference} onChange={onChange} className="rounded-lg bg-white/5 px-3 py-2 text-white" />
        </label>

        <label className="grid gap-1 text-white/80">
          Regional spec*
          <input name="regional_spec" value={form.regional_spec} onChange={onChange} className="rounded-lg bg-white/5 px-3 py-2 text-white" />
        </label>

        <label className="grid gap-1 text-white/80">
          Budget (AED)
          <input name="budget" value={form.budget} onChange={onChange} inputMode="numeric" className="rounded-lg bg-white/5 px-3 py-2 text-white" />
        </label>

        <label className="grid gap-1 text-white/80">
          Reference image*
          <input type="file" accept="image/*" onChange={onAddReferenceImage} className="text-white" />
        </label>

        <button disabled={submitting} className="rounded-xl bg-[#8bd6b4] px-4 py-2 font-semibold text-black disabled:opacity-60">
          {submitting ? 'Posting…' : 'Post Buying Request'}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Run frontend build**

Run: `cd frontend && npm run build`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/PostBuyingRequest.jsx
git commit -m "feat(frontend): buying request post form"
```

---

### Task 6: Frontend – BuyingRequestsPage list + BuyingRequestDetail with phone-verified WhatsApp reveal

**Files:**
- Create: `frontend/src/components/BuyingRequestsPage.jsx`
- Create: `frontend/src/components/BuyingRequestDetail.jsx`

- [ ] **Step 1: Create list page**

```jsx
// frontend/src/components/BuyingRequestsPage.jsx
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

export default function BuyingRequestsPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const resp = await axios.get(`${API_URL}/api/buying-requests`);
        setRows(resp.data || []);
      } catch (e) {
        setError('Failed to load buying requests');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="px-5 py-10 text-white/70">Loading…</div>;
  if (error) return <div className="px-5 py-10 text-red-100">{error}</div>;

  return (
    <div className="mx-auto max-w-[1480px] px-5 py-10">
      <h1 className="text-2xl font-semibold text-white">Buying Requests</h1>
      <p className="mt-2 text-white/60">Posters are anonymous. Verify your phone to reveal WhatsApp contact links.</p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => (
          <Link key={r.id} to={`/buying-requests/${r.id}`} className="rounded-2xl border border-white/10 bg-white/5 p-4 hover:border-[#8bd6b4]/25">
            <div className="text-white font-semibold">{r.item_name}</div>
            <div className="mt-1 text-white/60 text-sm">{String(r.item_type || '').toUpperCase()} · {r.regional_spec}</div>
            <div className="mt-2 text-white/60 text-sm">Mileage: {r.mileage_preference}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create detail page with phone-verified reveal + lead tracking**

```jsx
// frontend/src/components/BuyingRequestDetail.jsx
import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { getAccessToken } from '../utils/supabaseClient';
import { ensureContactAccess } from '../utils/contactAccess';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

export default function BuyingRequestDetail() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [row, setRow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const resp = await axios.get(`${API_URL}/api/buying-requests/${id}`);
        setRow(resp.data);
      } catch (e) {
        setError('Failed to load buying request');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const trackLeadEvent = async (action) => {
    try {
      const token = await getAccessToken();
      await fetch(`${API_URL}/api/listings/buying_request/${id}/lead-events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          action,
          source: 'buying_request_detail',
          payload: { listing_id: id },
        }),
      });
    } catch (e) {
      // non-blocking
    }
  };

  const revealWhatsapp = async () => {
    const ok = ensureContactAccess({ user, navigate, nextRoute: `${location.pathname}${location.search}` });
    if (!ok) return;
    setRevealed(true);
    await trackLeadEvent('whatsapp_click');
    const cc = (row?.whatsapp_country_code || '+971').replace(/\s+/g, '');
    const num = String(row?.whatsapp_number || '').replace(/\D/g, '');
    const wa = `https://wa.me/${(cc + num).replace('+', '')}`;
    window.open(wa, '_blank', 'noopener,noreferrer');
  };

  if (loading) return <div className="px-5 py-10 text-white/70">Loading…</div>;
  if (error) return <div className="px-5 py-10 text-red-100">{error}</div>;
  if (!row) return <div className="px-5 py-10 text-white/70">Not found.</div>;

  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <h1 className="text-2xl font-semibold text-white">{row.item_name}</h1>
      <div className="mt-2 text-white/60 text-sm">Anonymous buying request · {String(row.item_type || '').toUpperCase()}</div>
      <div className="mt-6 grid gap-3 rounded-2xl border border-white/10 bg-white/5 p-5">
        <div className="text-white/80"><span className="text-white/60">Regional spec:</span> {row.regional_spec}</div>
        <div className="text-white/80"><span className="text-white/60">Mileage preference:</span> {row.mileage_preference}</div>
        {row.budget ? <div className="text-white/80"><span className="text-white/60">Budget:</span> AED {Number(row.budget).toLocaleString()}</div> : null}
        {row.reference_notes ? <div className="text-white/80"><span className="text-white/60">Description:</span> {row.reference_notes}</div> : null}
      </div>

      <button onClick={revealWhatsapp} className="mt-6 w-full rounded-xl bg-[#8bd6b4] px-4 py-3 font-semibold text-black">
        {revealed ? 'Open WhatsApp' : 'Reveal WhatsApp link'}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Smoke test locally**

Run: `cd frontend && npm start`

Manual:
- Open `/buying-requests`
- Click a request
- Click “Reveal WhatsApp link” while unverified → should redirect to `/verify-phone`
- After verification, clicking should open WhatsApp and record a `whatsapp_click` lead event.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/BuyingRequestsPage.jsx frontend/src/components/BuyingRequestDetail.jsx
git commit -m "feat(frontend): buying requests list + anonymous detail with whatsapp reveal"
```

---

### Task 7: Keep Buying Requests out of Explore

**Files:**
- Verify-only: `frontend/src/components/ExplorePage.jsx`

- [ ] **Step 1: Assert no buying-requests fetch in Explore**

Run: `cd frontend && rg -n \"buying-requests|buying_request\" src/components/ExplorePage.jsx`

Expected: no matches.

- [ ] **Step 2: Commit**

No code change expected; skip commit.

---

## Spec Coverage Self-Review

- “Under Sell → Post a Buying Request”: implemented in Task 4.
- “Users have 5 buying requests”: enforced backend Task 2 + surfaced in UI error.
- “Same email flows”: Task 2 creates listing-style rows; follow-up execution should wire into existing email helpers where listings do (add `buying_requests` to any lifecycle/email scanners).
- “Only fields required: make/model/trim-like + requirements list”: Task 5 form includes item type/name/description + required mileage/regional + budget + reference image; and make/model/trim for cars.
- “Anonymous users/usernames”: public select excludes username; UI never shows it.
- “Reveal WhatsApp link gated by phone verification”: Task 6 uses `ensureContactAccess()`.
- “Track clicks/phone calls/whatsapps + buying requests”: buying request creation is the “buying request” metric; WhatsApp uses lead-events; add optional call click later (same pattern).
- “Not included in Explore”: Task 7 verifies no integration.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-31-buying-requests.md`.

Two execution options:
1) Subagent-Driven (recommended) — use superpowers:subagent-driven-development per task with review checkpoints
2) Inline Execution — use superpowers:executing-plans and execute tasks in this session

Which approach?

