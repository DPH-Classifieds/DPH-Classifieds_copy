# Unified Cropper — Design Spec

Date: 2026-06-05
Status: Approved (Sections 1–6); ready for implementation plan.
Author: brainstorm session (Claude + project owner)

## 1. Purpose & scope

Replace the two separate, inconsistent crop systems in the web app with a single, well-tested `UnifiedCropper` component used by every post-listing flow and the profile photo flow. The cropper outputs **real cropped JPEG files** that are uploaded directly to Supabase Storage — eliminating the current `focal_x` / `focal_y` CSS-positioning model that requires every consumer to honour the focal point at render time.

**Surfaces in scope (web):**
- `PostCar` (currently uses `ImageFramingModal` — painful custom UI)
- `PostBike` (currently no crop step at all)
- `PostCarParts` (currently no crop step)
- `PostPlate` (currently no crop step)
- `AccountSettings` profile photo (currently uses `ImageCropModal` — works fine but adopted for consistency)

**Out of scope:**
- Mobile React Native crop flows. They use Expo's built-in `ImagePicker` editor (`allowsEditing: true`) which works well and is consistent across iOS/Android. Replacing it would be a separate native project.
- Image enhancement features (rotate-only is included, but no brightness/contrast/filters/annotations).
- Backfill of existing listings. Lazy migration on edit, documented in §6.

**Locked decisions** (from brainstorm Q&A):
1. Real cropped JPEG file as output (not focal-point metadata).
2. Web-only rollout, all five surfaces.
3. Per-listing-type fixed aspect ratios (no user toggle).
4. Lazy migration on edit (no backfill worker).

---

## 2. Public API

One component, one shape, used by every flow:

```jsx
<UnifiedCropper
  kind="car"                       // "car" | "bike" | "plate" | "part" | "profile"
  images={files}                   // File[] OR Array<{file, previewUrl, existingCrop?}>
  isOpen={showCropper}
  onClose={() => setShowCropper(false)}
  onComplete={(results) => {
    // results: Array<{ croppedFile: File, originalFile: File, previewUrl: string }>
    setReadyToUpload(results);
    setShowCropper(false);
  }}
/>
```

**Props:**

| prop | type | required | meaning |
| --- | --- | --- | --- |
| `kind` | `'car' \| 'bike' \| 'plate' \| 'part' \| 'profile'` | yes | Selects aspect ratio, output size, copy, mask shape from `KIND_CONFIG`. |
| `images` | `File[]` or `Array<{file, previewUrl?, existingCrop?}>` | yes | User-selected source images. The wrapper-object form lets callers pass legacy `{focal_x, focal_y}` via `existingCrop` for the edit path. |
| `isOpen` | `boolean` | yes | Controls visibility. The cropper unmounts internal state when `false` so reopening with new images is clean. |
| `onClose` | `() => void` | yes | Fired when user clicks Cancel, ✕, presses Escape, or completes the flow. |
| `onComplete` | `(results) => void` | yes | Fired exactly once when user clicks Done. Receives one entry per input image. |

**Single-image (profile) variant**: when `images.length === 1` AND `kind === 'profile'`, the thumbnail strip is hidden, the canvas mask becomes circular, the "Apply to all" button is hidden, and the title becomes "Crop your photo". Everything else identical.

---

## 3. Internal architecture

### 3.1 File layout

```
flask-react-supabase-app/frontend/src/components/cropper/
  UnifiedCropper.jsx        ← single file, all subcomponents private
  unifiedCropper.css        ← scoped class names, no Tailwind needed
  __tests__/
    UnifiedCropper.test.jsx
    getCroppedBlob.test.js
```

Subcomponents defined inside `UnifiedCropper.jsx` (not exported, not separate files):
- `<CropCanvas>` — wraps `react-easy-crop` with the kind-config applied.
- `<ThumbnailStrip>` — horizontal scroller, active highlight, click to switch.
- `<ZoomRotateControls>` — slider for zoom, button for 90° rotate.

Helpers inside the same file:
- `getCroppedBlob(image, crop, zoom, rotation, kindConfig)` — pure async function that takes the source bitmap + crop state + config and returns a `Blob`. Tested separately.
- `normaliseImageOrientation(file)` — reads EXIF, returns a canvas/blob with orientation baked in.
- `mapLegacyFocalPointToCrop(focal_x, focal_y, sourceAspect, targetAspect)` — converts a legacy focal-point pair into a starting `{x, y, zoom}` for the edit path.

### 3.2 State

```js
const [activeIndex, setActiveIndex] = useState(0);
const [perImageState, setPerImageState] = useState(() =>
  images.map((img) => ({
    crop: img.existingCrop ? mapLegacyFocalPointToCrop(...) : { x: 0, y: 0 },
    zoom: img.existingCrop?.zoom ?? 1,
    rotation: 0,
    croppedAreaPixels: null,        // updated on every Cropper move
  }))
);
const [isProcessing, setIsProcessing] = useState(false);
const [error, setError] = useState(null);
const cancelRef = useRef(false);    // set true to abort the Done loop
const previewUrlsRef = useRef([]);  // tracked for cleanup
```

### 3.3 Keyboard map

- `←` / `→` — switch active image (no-op for single-image profile case)
- `+` / `=` / `-` / `_` — zoom in / out
- `r` — rotate active image 90° clockwise
- `Esc` — close modal (calls `onClose`)
- `Enter` — finalise (same as Done button)

Event handlers attached via a `useEffect` that listens on `window` while `isOpen`, removed on unmount.

### 3.4 Touch

`react-easy-crop` handles pinch-to-zoom and drag-to-pan natively. No custom touch event code.

---

## 4. Per-listing-type config

Single source of truth, exported only for testing:

```js
export const KIND_CONFIG = {
  car: {
    aspect: 16 / 10,
    outputWidth: 1600,
    outputHeight: 1000,
    shape: 'rect',
    title: 'Crop your car photos',
    hint: 'Drag to position. Pinch or scroll to zoom.',
    quality: 0.88,
  },
  bike: {
    aspect: 16 / 10,
    outputWidth: 1600,
    outputHeight: 1000,
    shape: 'rect',
    title: 'Crop your bike photos',
    hint: 'Drag to position. Pinch or scroll to zoom.',
    quality: 0.88,
  },
  plate: {
    aspect: 4 / 1,
    outputWidth: 1600,
    outputHeight: 400,
    shape: 'rect',
    title: 'Crop the plate',
    hint: 'Frame the plate edge-to-edge for the cleanest look.',
    quality: 0.92,
  },
  part: {
    aspect: 1,
    outputWidth: 1200,
    outputHeight: 1200,
    shape: 'rect',
    title: 'Crop the part',
    hint: 'Center the part in the frame.',
    quality: 0.88,
  },
  profile: {
    aspect: 1,
    outputWidth: 512,
    outputHeight: 512,
    shape: 'round',           // visual mask only; output is still square JPEG
    title: 'Crop your photo',
    hint: 'Drag to position. Pinch to zoom.',
    quality: 0.92,
  },
};
```

Output format: always JPEG, regardless of source. PNG → JPEG conversion happens at `canvas.toBlob('image/jpeg', quality)`. Source files accepted are anything `<input type="file" accept="image/*">` allows; HEIC files prompt the user to convert before upload (most browsers can't decode HEIC).

---

## 5. Upload pipeline integration

### 5.1 Caller-side flow

Each `Post<X>` page follows the same pattern:

```
1. User clicks "Add photos" → <input type="file"> → File[]
2. UnifiedCropper opens (isOpen=true) with those File objects
3. User crops each, hits Done → onComplete(results) fires
4. PostX stores results in state, closes the cropper
5. On form submit → FormData with results[i].croppedFile as the "images" field;
   no more crop_data_* entries
```

### 5.2 FormData shape

```js
// Before (PostCar.js)
const formData = new FormData();
selectedFiles.forEach((f, i) => {
  formData.append('images', f);
  formData.append(`crop_data_${i}`, JSON.stringify(imageCropSettings[i]));
});

// After
const formData = new FormData();
croppedResults.forEach(({ croppedFile }) => {
  formData.append('images', croppedFile);
  // no crop_data_* — the file IS the crop
});
```

### 5.3 Backend changes

Backend keeps accepting `crop_data_<i>` for back-compat (legacy edits could still send it) but does not require it. The image table rows for new uploads have `cropped_at = now()` set and `focal_x` / `focal_y` left NULL.

The existing direct-upload helper (`utils/directUpload.js`), the Supabase Storage path layout, and the `cars` / `bikes` / `license_plates` / `car_parts` image-table writes are unchanged. We're sending different bytes through the same plumbing.

---

## 6. Data model changes & lazy migration

### 6.1 New column

Add `cropped_at timestamptz NULL` to all four image tables:

```sql
ALTER TABLE public.car_images       ADD COLUMN IF NOT EXISTS cropped_at timestamptz;
ALTER TABLE public.bike_images      ADD COLUMN IF NOT EXISTS cropped_at timestamptz;
ALTER TABLE public.plate_images     ADD COLUMN IF NOT EXISTS cropped_at timestamptz;
ALTER TABLE public.part_images      ADD COLUMN IF NOT EXISTS cropped_at timestamptz;
```

Semantics:
- `cropped_at IS NULL` — legacy row, the stored blob is the original upload. Renderers fall back to the existing `focal_x` / `focal_y` CSS positioning path.
- `cropped_at IS NOT NULL` — the stored blob is already a cropped JPEG at the kind's target aspect ratio. Renderers render a plain `<img>` with no positioning math.

### 6.2 Rendering branch

Update the four detail pages (`CarDetail.jsx`, `BikeDetailRedesigned.jsx`, `PlateDetailRedesigned.jsx`, `PartDetailRedesigned.jsx`) and the marketplace card components:

```jsx
{image.cropped_at ? (
  <img src={image.url} alt="..." className="object-cover" />
) : (
  // legacy fallback — existing object-position style
  <img
    src={image.url}
    alt="..."
    style={{ objectPosition: `${image.focal_x ?? 50}% ${image.focal_y ?? 50}%` }}
    className="object-cover"
  />
)}
```

### 6.3 Lazy migration on edit

When a seller opens an existing listing to edit:

1. Load images from DB. For each row:
   - If `cropped_at IS NOT NULL` → render the thumbnail as-is. No crop step required on save unless the user explicitly clicks "Re-crop".
   - If `cropped_at IS NULL` (legacy) → render the thumbnail with a small "Improve crop" badge in the corner.
2. New images added during the edit → standard crop flow.
3. On submit, the upload payload contains:
   - The freshly cropped new images (always cropped).
   - The legacy images that the seller chose to re-crop (now cropped, with `cropped_at` set on save).
   - Untouched legacy images (no change).

This means most listings will organically migrate over months as sellers update their listings, with zero forced action.

### 6.4 Retirement plan

Add a one-line `data_health` metric to the existing admin dashboard: `% of image rows with cropped_at IS NOT NULL`. When that percentage exceeds 95%, we can:

1. Run a one-off backfill worker for the last 5% (much smaller batch than upfront backfill would have been).
2. Remove the CSS-positioning render path from every consumer.
3. Drop the `focal_x` / `focal_y` columns.

Not a v1 concern — explicit retirement plan for clarity.

---

## 7. Error handling & edge cases

| Case | Behaviour |
| --- | --- |
| HEIC / unsupported format | Detect via MIME at file-pick time; show "Convert to JPEG first" inline notice instead of opening the cropper for that file. Other files in the queue proceed normally. |
| Image decode failure | Per-thumbnail red banner + retry button; doesn't break the rest of the queue. |
| EXIF orientation | Normalised once at decode time via a canvas pass; the cropper always sees pixels in display order so portrait iPhone photos don't render rotated. |
| Source image > 25 MP | Downscale to 25 MP before cropping. Prevents browser OOM on DSLR photos. |
| Cancel mid-process | `cancelRef.current = true` aborts the Done loop. Any partial `URL.createObjectURL` outputs are revoked. |
| Object-URL lifetime | Every `previewUrl` we mint is tracked in `previewUrlsRef`. We `URL.revokeObjectURL` on unmount, on replace, and on cancel. (The current `ImageFramingModal` leaks these — explicit fix.) |
| Source smaller than output target | Still crop, blob is the crop region; canvas scales up. Warn ("low resolution"), don't block. |
| Network failure on direct upload (post-crop) | Existing retry path in `directUpload.js` already handles this. Cropper not involved. |

---

## 8. Testing strategy

### 8.1 Unit (Vitest/Jest)

- `getCroppedBlob` — pure async function. Tests: correct output dimensions per `kind`, JPEG format, EXIF orientation applied, sub-minimum source handled.
- `mapLegacyFocalPointToCrop` — pure. Tests: 50/50 focal point → centered crop; corner focal points → corner crops; preserves zoom.
- `normaliseImageOrientation` — pure. Tests: orientation 1 (default) no-op; orientation 6 (90° rotate); orientation 3 (180°).

### 8.2 Component (React Testing Library)

- Thumbnail strip click → `activeIndex` switches.
- Keyboard ← → cycles correctly (and is a no-op when only one image).
- `+` / `-` zoom in/out updates `perImageState[activeIndex].zoom`.
- `r` rotates 90° each press.
- "Apply current crop to all" copies the active `crop` + `zoom` + `rotation` to every entry.
- `onComplete` fires exactly once on Done with N results for N inputs.
- Profile-shape variant: thumbnail strip hidden, mask is round, no "Apply to all".

### 8.3 Integration

- `PostCar` → open `UnifiedCropper` with 3 files → crop each → Done → assert submitted `FormData` has exactly 3 `images` entries, zero `crop_data_*` entries.
- Re-edit path: open a listing with one legacy image (no `cropped_at`) and one new image → click "Improve crop" on the legacy → save → assert the legacy image now has `cropped_at` set in the DB.

### 8.4 Manual smoke

Documented in the implementation plan's final task:

- [ ] Single file, each `kind` — crop, save, confirm displayed correctly on detail page.
- [ ] 3 files of mixed orientation (landscape + portrait + square iPhone HEIC-converted-to-JPEG).
- [ ] 12 files (max).
- [ ] Mid-flow cancel — confirm no orphan blobs or memory leaks (DevTools Memory tab).
- [ ] Legacy edit path — open a pre-migration listing, "Improve crop" one image, save, refresh.
- [ ] Mobile browser (iOS Safari, Android Chrome) — pinch-to-zoom works, no accidental scroll.

---

## 9. Implementation phases

To keep the rollout safe, the implementation plan should land in this order:

1. **Foundation** — `UnifiedCropper.jsx`, `getCroppedBlob`, `mapLegacyFocalPointToCrop`, `normaliseImageOrientation`, tests. No callers wired yet.
2. **Migration column** — `ALTER TABLE … ADD cropped_at` on all four image tables; backend `image_url` responses include `cropped_at`.
3. **PostCar adoption** — replace `ImageFramingModal` with `UnifiedCropper`. CarDetail renders branch on `cropped_at`.
4. **Other listing flows** — PostBike, PostCarParts, PostPlate gain the cropper (they have none today). Detail pages add the branch.
5. **AccountSettings adoption** — swap `ImageCropModal` for `UnifiedCropper` with `kind="profile"`.
6. **Delete `ImageFramingModal.jsx`** and its CSS — the old code path is fully unused for new uploads.
7. **Admin dashboard `cropped_at` metric** — health card showing migration progress.

Once `% cropped_at IS NOT NULL` > 95%, retire the legacy CSS render path entirely (separate follow-up, not in v1 scope).

---

## 10. Open questions / deferred decisions

- **Inline edit on the listing detail page** (e.g. a seller browsing their listing decides to re-crop the hero without opening the full edit form) — deferred. The crop primitive is already split logically so this is a small follow-up.
- **AI-suggested initial crop** (e.g. detect the car/bike subject and pre-position the focal point) — deferred. The current "open with no crop applied, user adjusts" UX is fine. AI suggestion is a polish layer for v1.1.
- **Bulk re-crop tool** for existing listings — deferred. Lazy migration covers it organically.

---

## 11. Acceptance criteria for v1

The cropper ships when:

- All five surfaces (PostCar, PostBike, PostCarParts, PostPlate, AccountSettings) open the same `UnifiedCropper` component.
- A new car listing posted today: source images go through the cropper, the stored Supabase Storage blobs are real cropped JPEGs at 1600×1000, the rows have `cropped_at` set, no `crop_data_<i>` is sent.
- An old car listing edited today: legacy images render via the existing CSS path; user can opt-in to "Improve crop" per image; saved rows have `cropped_at` set.
- The marketplace card grid and detail pages render correctly for both legacy and migrated rows (mixed-mode).
- Profile photo cropping behaves identically to today — round mask, 512×512 output JPEG.
- All listed unit + component + integration tests pass.
- Manual smoke checklist passes on Chrome / Safari / iOS Safari / Android Chrome.

Phase ships when all of the above is true.
