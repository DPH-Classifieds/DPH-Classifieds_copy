# Listing Media Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make buying-request images render as previews on the web, and make mobile listing posting work end-to-end by uploading images before create requests so bike, plate, and car-part submissions succeed reliably.

**Architecture:** Buying requests will keep using the existing `buying_request_images` rows and the public API will return those image objects alongside the request records. The React web UI will render the first image as the hero card preview and a thumbnail strip on the detail page when multiple images exist. On mobile, the listing compose screen will first upload local image files through `/api/upload-images`, then submit JSON payloads with image URLs to the existing create endpoints so the backend receives the contract it already expects.

**Tech Stack:** Flask, Supabase/PostgREST, React, React Native, Expo `ImagePicker`, native `fetch`/`FormData`.

---

### Task 1: Buying request preview gallery

**Files:**
- Modify: `backend/routes/buying_requests.py`
- Modify: `frontend/src/components/BuyingRequestsPage.jsx`
- Modify: `frontend/src/components/BuyingRequestDetail.jsx`
- Test: `backend/test_buying_requests.py`

- [ ] **Step 1: Write the failing test**

```python
def test_buying_requests_list_includes_preview_image(monkeypatch):
    def fake_supabase_request(method, path, params=None, data=None, user_id=None, **kwargs):
        if method == "get" and path == "/rest/v1/buying_requests":
            return ([{"id": "req-1", "item_name": "BMW X5 wanted"}], 200)
        if method == "get" and path == "/rest/v1/buying_request_images":
            return ([{"buying_request_id": "req-1", "display_url": "https://example.com/ref.jpg"}], 200)
        return ([], 200)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./venv/bin/pytest -q test_buying_requests.py::test_buying_requests_list_includes_preview_image -v`
Expected: FAIL because the list payload does not yet attach `images`/preview objects consistently.

- [ ] **Step 3: Write the minimal implementation**

```python
row["images"] = images_by_request.get(str(row.get("id")), [])
payload.append(_scrub_public_row(row))
```

```jsx
const imageUrl =
  row?.images?.[0]?.display_url ||
  row?.images?.[0]?.image_url ||
  row?.images?.[0]?.url ||
  PLACEHOLDER_IMAGE;
```

```jsx
{images.length > 1 ? <View style={styles.thumbnailRow}>...</View> : null}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `./venv/bin/pytest -q test_buying_requests.py test_admin_stats_and_posts.py`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/buying_requests.py backend/test_buying_requests.py frontend/src/components/BuyingRequestsPage.jsx frontend/src/components/BuyingRequestDetail.jsx
git commit -m "Show buying request image previews"
```

### Task 2: Mobile listing image upload flow

**Files:**
- Modify: `mobile/src/screens/listing/PostListingScreen.js`
- Modify: `mobile/src/screens/listing/PostListingScreen.js` image submit path
- Test: `backend/test_admin_stats_and_posts.py` or a new backend upload contract test

- [ ] **Step 1: Write the failing test**

```python
from io import BytesIO
from unittest.mock import patch

def test_upload_images_returns_absolute_urls(monkeypatch):
    with backend.app.test_request_context(
        "/api/upload-images",
        method="POST",
        data={"images": [(BytesIO(b"fake-image-bytes"), "bike.jpg")]},
        content_type="multipart/form-data",
    ):
        with patch.object(backend, "ensure_storage_bucket", return_value=True):
            with patch.object(
                backend,
                "upload_to_supabase_storage",
                return_value=(
                    {
                        "url": "https://example.com/bike.jpg",
                        "image_url": "https://example.com/bike.jpg",
                        "display_url": "https://example.com/bike.jpg",
                        "focal_x": 50,
                        "focal_y": 50,
                        "crop_meta": None,
                    },
                    None,
                ),
            ):
                response, status = backend.upload_images.__wrapped__("user-123")

    assert status == 200
    assert response.get_json()["absolute_urls"] == ["https://example.com/bike.jpg"]
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./venv/bin/pytest -q test_mobile_image_upload.py -v`
Expected: FAIL until the upload contract is covered.

- [ ] **Step 3: Write the minimal implementation**

```jsx
const uploadSelectedImages = async (uris) => {
  if (!uris.length) return [];
  const formData = new FormData();
  uris.forEach((uri, index) => {
    formData.append('images', {
      uri,
      type: 'image/jpeg',
      name: `image_${index}.jpg`,
    });
  });
  const response = await apiClient.post('/api/upload-images', formData);
  return response?.absolute_urls || response?.urls || [];
};
```

```jsx
const imageUrls = await uploadSelectedImages(images);
const payload = { ...carForm, images: imageUrls };
await apiClient.post('/api/cars', payload);
```

```jsx
const bikePayload = { ...bikeForm, images: imageUrls };
await apiClient.post('/api/bikes', bikePayload);
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
`./venv/bin/pytest -q test_admin_stats_and_posts.py test_buying_requests.py`
and
`npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/screens/listing/PostListingScreen.js backend/test_mobile_image_upload.py
git commit -m "Upload mobile listing images before submit"
```

### Task 3: Verify mobile browse visibility

**Files:**
- Review: `mobile/src/screens/home/HomeScreen.js`
- Review: `mobile/src/screens/explore/ExploreScreen.js`
- Review: `mobile/src/screens/listing/BikeListScreen.js`
- Review: `mobile/src/screens/listing/PlateListScreen.js`
- Review: `mobile/src/screens/listing/PartListScreen.js`

- [ ] **Step 1: Confirm the bike section is present**

```jsx
const sections = [
  { key: 'cars', title: 'Latest Cars', data: cars, screen: 'CarList' },
  { key: 'bikes', title: 'Latest Bikes', data: bikes, screen: 'BikeList' },
  { key: 'plates', title: 'Latest Plates', data: plates, screen: 'PlateList' },
  { key: 'parts', title: 'Latest Parts', data: parts, screen: 'PartList' },
];
```

- [ ] **Step 2: Confirm browse routes point to the right detail screens**

```jsx
const DETAIL_SCREENS = { cars: 'CarDetail', bikes: 'BikeDetail', plates: 'PlateDetail', parts: 'PartDetail' };
```

- [ ] **Step 3: Run a mobile build sanity check**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add mobile/src/screens/home/HomeScreen.js mobile/src/screens/explore/ExploreScreen.js mobile/src/screens/listing/BikeListScreen.js mobile/src/screens/listing/PlateListScreen.js mobile/src/screens/listing/PartListScreen.js
git commit -m "Verify mobile browse listings"
```
