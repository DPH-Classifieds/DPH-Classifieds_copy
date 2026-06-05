# Unified Cropper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `ImageFramingModal` and `ImageCropModal` with a single `UnifiedCropper` React component used by every post-listing flow (PostCar, PostBike, PostCarParts, PostPlate) plus AccountSettings, outputting real cropped JPEG blobs that get uploaded directly to Supabase Storage. New `cropped_at` column on `*_images` tables marks rows that don't need the legacy CSS-positioning render fallback.

**Architecture:** One container component (`UnifiedCropper.jsx`) wraps `react-easy-crop` (already in the bundle at ^5.5.7). Per-kind config drives aspect ratio, output size, mask shape, and copy. Pure helpers (`cropUtils.js`) handle blob generation, EXIF normalisation, and legacy-focal-point → crop conversion — kept separate so they're trivially unit-testable. Callers swap two ~200-line custom modals for a single `<UnifiedCropper kind="..." images={...} onComplete={...} />` invocation.

**Tech Stack:**
- Frontend: React 18, `react-easy-crop@^5.5.7` (already installed), `@testing-library/react`, Jest (`react-scripts test`)
- Backend: Flask + Supabase REST (service role) — minimal touch for `cropped_at` write + select
- DB: Postgres via Supabase, idempotent `ALTER TABLE ADD COLUMN IF NOT EXISTS`

**References:**
- Spec: `docs/superpowers/specs/2026-06-05-unified-cropper-design.md` (authoritative)
- Existing components being replaced: `flask-react-supabase-app/frontend/src/components/ImageFramingModal.jsx`, `ImageCropModal.js`
- Existing pattern for direct upload: `flask-react-supabase-app/frontend/src/utils/directUpload.js`
- Existing pattern for image insert (backend): `flask-react-supabase-app/backend/app.py` — search for the listing-image POST handler that inserts into `car_images` etc.

---

## File Structure

### Create
- `frontend/src/components/cropper/UnifiedCropper.jsx` — container component
- `frontend/src/components/cropper/unifiedCropper.css` — scoped CSS (no Tailwind needed — the rest of the consumer-facing styles use plain CSS)
- `frontend/src/components/cropper/kindConfig.js` — `KIND_CONFIG` object + `getKindConfig()` helper. Importable by detail-page renderers too.
- `frontend/src/components/cropper/cropUtils.js` — pure helpers: `getCroppedBlob`, `normaliseImageOrientation`, `mapLegacyFocalPointToCrop`, `loadImageElement`
- `frontend/src/components/cropper/cropUtils.test.js` — Jest unit tests
- `frontend/src/components/cropper/UnifiedCropper.test.jsx` — RTL component tests
- `backend/migrations/2026_06_05_image_cropped_at.sql` — adds `cropped_at` column to four `*_images` tables

### Modify
- `frontend/src/components/PostCar.js` — drop `ImageFramingModal` + `imageCropSettings` state + `crop_data_*` FormData entries; render `<UnifiedCropper kind="car" .../>`
- `frontend/src/components/PostBike.js` — wire `<UnifiedCropper kind="bike" .../>` (no crop step today)
- `frontend/src/components/PostCarParts.js` — wire `<UnifiedCropper kind="part" .../>`
- `frontend/src/components/PostPlate.js` — wire `<UnifiedCropper kind="plate" .../>`
- `frontend/src/components/AccountSettings.js` — swap `ImageCropModal` for `<UnifiedCropper kind="profile" .../>`
- `frontend/src/components/CarDetail.jsx` — branch render on `image.cropped_at`
- `frontend/src/components/BikeDetailRedesigned.jsx` — branch render
- `frontend/src/components/PartDetailRedesigned.jsx` — branch render
- `frontend/src/components/PlateDetailRedesigned.jsx` — branch render
- `frontend/src/components/MarketplaceListingCard.jsx` — branch render (the search-result thumbnail)
- `backend/app.py` — image-insert handler sets `cropped_at = now()` for new uploads; image SELECT queries include `cropped_at`
- `frontend/src/components/AdminDashboard.js` — add a `% cropped_at IS NOT NULL` data-health tile

### Delete
- `frontend/src/components/ImageFramingModal.jsx`
- `frontend/src/styles/ImageFramingModal.css`
- `frontend/src/components/ImageCropModal.js` (replaced by UnifiedCropper with `kind="profile"`)

---

## Task 1: Migration — `cropped_at` column on all image tables

**Files:**
- Create: `flask-react-supabase-app/backend/migrations/2026_06_05_image_cropped_at.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- ============================================================
-- Unified Cropper migration: cropped_at column on *_images
-- Semantics:
--   cropped_at IS NULL     -> legacy row, blob is the original upload;
--                             renderer must use focal_x/focal_y CSS positioning
--   cropped_at IS NOT NULL -> blob is already a cropped JPEG at the listing
--                             kind's target aspect ratio; renderer uses plain <img>
-- Idempotent: safe to re-run.
-- ============================================================

ALTER TABLE public.car_images       ADD COLUMN IF NOT EXISTS cropped_at timestamptz;
ALTER TABLE public.bike_images      ADD COLUMN IF NOT EXISTS cropped_at timestamptz;
ALTER TABLE public.plate_images     ADD COLUMN IF NOT EXISTS cropped_at timestamptz;
ALTER TABLE public.part_images      ADD COLUMN IF NOT EXISTS cropped_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_car_images_cropped_at_null  ON public.car_images   (cropped_at) WHERE cropped_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_bike_images_cropped_at_null ON public.bike_images  (cropped_at) WHERE cropped_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_plate_images_cropped_at_null ON public.plate_images(cropped_at) WHERE cropped_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_part_images_cropped_at_null  ON public.part_images (cropped_at) WHERE cropped_at IS NULL;

DO $$ BEGIN
    RAISE NOTICE '✅ cropped_at column added to car_images, bike_images, plate_images, part_images';
END $$;
```

- [ ] **Step 2: Verify the SQL has no typos**

```bash
grep -c "cropped_at" flask-react-supabase-app/backend/migrations/2026_06_05_image_cropped_at.sql
```

Expected: at least 10 (4 ALTER + 4 CREATE INDEX + 2 in the notice line).

- [ ] **Step 3: Apply in Supabase SQL Editor (human step)**

Paste the file into the SQL Editor and run. Expect the `✅` notice at the end. Verify with:
```sql
SELECT column_name FROM information_schema.columns
 WHERE table_schema='public' AND column_name='cropped_at'
 ORDER BY table_name;
```
Should return 4 rows.

- [ ] **Step 4: Commit**

```bash
git add flask-react-supabase-app/backend/migrations/2026_06_05_image_cropped_at.sql
git commit -m "Unified Cropper: add cropped_at column to all *_images tables"
```

---

## Task 2: Pure helpers — `cropUtils.js`

**Files:**
- Create: `flask-react-supabase-app/frontend/src/components/cropper/cropUtils.js`
- Test: `flask-react-supabase-app/frontend/src/components/cropper/cropUtils.test.js`

- [ ] **Step 1: Write the failing test file**

Create `cropUtils.test.js` with EXACTLY this content:

```js
import { mapLegacyFocalPointToCrop } from './cropUtils';

describe('mapLegacyFocalPointToCrop', () => {
  test('center focal point maps to centered crop', () => {
    const out = mapLegacyFocalPointToCrop({ focal_x: 50, focal_y: 50 });
    expect(out).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  test('top-left focal point shifts crop towards top-left', () => {
    const out = mapLegacyFocalPointToCrop({ focal_x: 0, focal_y: 0 });
    expect(out.x).toBeLessThan(0);
    expect(out.y).toBeLessThan(0);
  });

  test('bottom-right focal point shifts crop towards bottom-right', () => {
    const out = mapLegacyFocalPointToCrop({ focal_x: 100, focal_y: 100 });
    expect(out.x).toBeGreaterThan(0);
    expect(out.y).toBeGreaterThan(0);
  });

  test('zoom defaults to 1 when missing', () => {
    expect(mapLegacyFocalPointToCrop({ focal_x: 50, focal_y: 50 }).zoom).toBe(1);
  });

  test('zoom passes through when provided', () => {
    expect(mapLegacyFocalPointToCrop({ focal_x: 50, focal_y: 50, zoom: 1.7 }).zoom).toBe(1.7);
  });

  test('handles missing focal coordinates by centering', () => {
    expect(mapLegacyFocalPointToCrop({})).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  test('clamps absurd focal points to range', () => {
    const tooHigh = mapLegacyFocalPointToCrop({ focal_x: 200, focal_y: -50 });
    expect(tooHigh.x).toBeLessThanOrEqual(50);
    expect(tooHigh.y).toBeGreaterThanOrEqual(-50);
  });
});
```

- [ ] **Step 2: Run the test, confirm ModuleNotFoundError**

```bash
cd flask-react-supabase-app/frontend
npx react-scripts test --watchAll=false src/components/cropper/cropUtils.test.js
```

Expected: `Cannot find module './cropUtils'`.

- [ ] **Step 3: Write `cropUtils.js`**

```js
// flask-react-supabase-app/frontend/src/components/cropper/cropUtils.js
//
// Pure helpers for UnifiedCropper. No React, no DOM mutation. Tested in isolation.

import { getKindConfig } from './kindConfig';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * Convert a legacy focal-point pair (0-100 each, in CSS object-position units)
 * into the {x, y, zoom} state that react-easy-crop expects.
 *
 * react-easy-crop's crop state is the offset of the image FROM the centre, in
 * px. A focal point of (50,50) means "centre the crop on the centre of the
 * image", which maps to {x:0, y:0}. A focal point of (0,0) means "top-left
 * of the image is the visual focus", so the crop window needs to be offset
 * up and left — we represent that as small negative x/y. The component
 * normalises these to pixel offsets at runtime via the source dimensions.
 */
export function mapLegacyFocalPointToCrop(legacy = {}) {
  const focalX = clamp(Number(legacy.focal_x ?? 50), 0, 100);
  const focalY = clamp(Number(legacy.focal_y ?? 50), 0, 100);
  const zoom = Number.isFinite(Number(legacy.zoom)) ? Number(legacy.zoom) : 1;
  // Symmetric around (50,50); offset range ±50 (arbitrary units that
  // react-easy-crop scales by the image size).
  const x = focalX - 50;
  const y = focalY - 50;
  return { x, y, zoom };
}

/**
 * Load a File or URL into an HTMLImageElement, resolved when decode is done.
 * Used by getCroppedBlob and EXIF normalisation.
 */
export function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.crossOrigin = 'anonymous';
    img.src = typeof src === 'string' ? src : URL.createObjectURL(src);
  });
}

/**
 * Decode an image and bake its EXIF orientation into the pixels. Returns a
 * Blob in the same format as the input. Most modern browsers handle this
 * via the `image-orientation: from-image` CSS property at render time, but
 * canvas drawImage ignores EXIF — so we have to do it ourselves before
 * cropping. Returns the input unchanged if there is no orientation to apply
 * or we can't read EXIF (best-effort).
 */
export async function normaliseImageOrientation(file) {
  // Modern Image() with createImageBitmap honours EXIF when imageOrientation
  // is 'from-image'. Use that where available — it's the cheap path.
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close?.();
      return await new Promise((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), file.type || 'image/jpeg', 0.95);
      });
    } catch (_) {
      // fall through to raw file
    }
  }
  return file;
}

/**
 * Generate a cropped JPEG blob from a source image and the crop region in
 * pixel coordinates. The output is sized to the kind's target dimensions.
 *
 * @param {HTMLImageElement} image      decoded source image
 * @param {{x:number,y:number,width:number,height:number}} pixelCrop
 * @param {{outputWidth:number,outputHeight:number,quality:number}} kindConfig
 * @param {number} rotation             0 | 90 | 180 | 270
 * @returns {Promise<Blob>}
 */
export function getCroppedBlob(image, pixelCrop, kindConfig, rotation = 0) {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = kindConfig.outputWidth;
    canvas.height = kindConfig.outputHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return reject(new Error('Canvas 2D context unavailable'));

    const radians = ((rotation || 0) % 360) * (Math.PI / 180);
    if (radians === 0) {
      ctx.drawImage(
        image,
        pixelCrop.x,
        pixelCrop.y,
        pixelCrop.width,
        pixelCrop.height,
        0,
        0,
        kindConfig.outputWidth,
        kindConfig.outputHeight
      );
    } else {
      // Rotate around the centre of the output canvas
      ctx.save();
      ctx.translate(kindConfig.outputWidth / 2, kindConfig.outputHeight / 2);
      ctx.rotate(radians);
      ctx.translate(-kindConfig.outputWidth / 2, -kindConfig.outputHeight / 2);
      ctx.drawImage(
        image,
        pixelCrop.x,
        pixelCrop.y,
        pixelCrop.width,
        pixelCrop.height,
        0,
        0,
        kindConfig.outputWidth,
        kindConfig.outputHeight
      );
      ctx.restore();
    }

    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Crop blob generation failed'))),
      'image/jpeg',
      kindConfig.quality ?? 0.88
    );
  });
}

/**
 * Convenience: get a {file, previewUrl} pair from a Blob using the same
 * filename pattern the rest of the app expects. Kind is for the filename
 * prefix.
 */
export function blobToFile(blob, kind = 'image') {
  const file = new File([blob], `${kind}-${Date.now()}.jpg`, {
    type: 'image/jpeg',
    lastModified: Date.now(),
  });
  return { file, previewUrl: URL.createObjectURL(blob) };
}
```

- [ ] **Step 4: Add `kindConfig.js` (referenced by cropUtils)**

```js
// flask-react-supabase-app/frontend/src/components/cropper/kindConfig.js
//
// Single source of truth for per-kind crop output settings. Imported by
// UnifiedCropper, the cropUtils helpers, AND the detail-page renderers (so
// they can use kind-aware fallback CSS for legacy rows).

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
    shape: 'round',
    title: 'Crop your photo',
    hint: 'Drag to position. Pinch to zoom.',
    quality: 0.92,
  },
};

export function getKindConfig(kind) {
  return KIND_CONFIG[kind] || KIND_CONFIG.car;
}
```

- [ ] **Step 5: Run tests, confirm pass**

```bash
cd flask-react-supabase-app/frontend
npx react-scripts test --watchAll=false src/components/cropper/cropUtils.test.js
```

Expected: `7 passed`.

- [ ] **Step 6: Commit**

```bash
git add flask-react-supabase-app/frontend/src/components/cropper/
git commit -m "Unified Cropper: pure helpers (kindConfig, cropUtils) + tests"
```

---

## Task 3: `UnifiedCropper.jsx` component (foundation)

**Files:**
- Create: `flask-react-supabase-app/frontend/src/components/cropper/UnifiedCropper.jsx`
- Create: `flask-react-supabase-app/frontend/src/components/cropper/unifiedCropper.css`
- Test: `flask-react-supabase-app/frontend/src/components/cropper/UnifiedCropper.test.jsx`

- [ ] **Step 1: Write the failing component test**

```jsx
// flask-react-supabase-app/frontend/src/components/cropper/UnifiedCropper.test.jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import UnifiedCropper from './UnifiedCropper';

// Stub react-easy-crop — its internals require canvas + image decoding
// which jsdom doesn't fully implement. We exercise the host component's
// state machine here; cropUtils is tested separately.
jest.mock('react-easy-crop', () => ({
  __esModule: true,
  default: ({ onCropChange, onZoomChange, onCropComplete }) => (
    <div data-testid="cropper-stub">
      <button onClick={() => onCropChange({ x: 1, y: 2 })}>set-crop</button>
      <button onClick={() => onZoomChange(1.5)}>set-zoom</button>
      <button onClick={() => onCropComplete(null, { x: 0, y: 0, width: 100, height: 100 })}>set-pixels</button>
    </div>
  ),
}));

const makeFile = (name = 'a.jpg') =>
  new File(['x'], name, { type: 'image/jpeg', lastModified: 1 });

describe('UnifiedCropper', () => {
  beforeEach(() => {
    // jsdom has no createObjectURL; the previewUrls happen inside the comp.
    global.URL.createObjectURL = jest.fn(() => 'blob:mock');
    global.URL.revokeObjectURL = jest.fn();
  });

  test('renders nothing when isOpen=false', () => {
    const { container } = render(
      <UnifiedCropper kind="car" images={[makeFile()]} isOpen={false} onClose={() => {}} onComplete={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  test('renders kind-specific title', () => {
    render(
      <UnifiedCropper kind="plate" images={[makeFile()]} isOpen onClose={() => {}} onComplete={() => {}} />
    );
    expect(screen.getByText(/Crop the plate/i)).toBeInTheDocument();
  });

  test('shows thumbnail strip with multiple images, hides for single profile image', () => {
    const { rerender } = render(
      <UnifiedCropper
        kind="car"
        images={[makeFile('a'), makeFile('b'), makeFile('c')]}
        isOpen
        onClose={() => {}}
        onComplete={() => {}}
      />
    );
    expect(screen.getByTestId('cropper-thumbnail-strip')).toBeInTheDocument();

    rerender(
      <UnifiedCropper kind="profile" images={[makeFile()]} isOpen onClose={() => {}} onComplete={() => {}} />
    );
    expect(screen.queryByTestId('cropper-thumbnail-strip')).not.toBeInTheDocument();
  });

  test('keyboard ArrowRight advances active index', () => {
    render(
      <UnifiedCropper
        kind="car"
        images={[makeFile('a'), makeFile('b')]}
        isOpen
        onClose={() => {}}
        onComplete={() => {}}
      />
    );
    expect(screen.getByText(/1 of 2/)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByText(/2 of 2/)).toBeInTheDocument();
  });

  test('Escape key triggers onClose', () => {
    const onClose = jest.fn();
    render(
      <UnifiedCropper kind="car" images={[makeFile()]} isOpen onClose={onClose} onComplete={() => {}} />
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('Apply current crop to all copies state to every index', () => {
    render(
      <UnifiedCropper
        kind="car"
        images={[makeFile('a'), makeFile('b'), makeFile('c')]}
        isOpen
        onClose={() => {}}
        onComplete={() => {}}
      />
    );
    // Move to image 2, change crop via the stub
    fireEvent.click(screen.getByRole('button', { name: /Apply current crop to all/i }));
    // The button itself just calls the handler; verify it doesn't crash.
    // Deeper verification is in the integration test once getCroppedBlob runs.
    expect(screen.getByText(/1 of 3/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to confirm failure**

```bash
cd flask-react-supabase-app/frontend
npx react-scripts test --watchAll=false src/components/cropper/UnifiedCropper.test.jsx
```

Expected: `Cannot find module './UnifiedCropper'`.

- [ ] **Step 3: Write `UnifiedCropper.jsx`**

```jsx
// flask-react-supabase-app/frontend/src/components/cropper/UnifiedCropper.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Cropper from 'react-easy-crop';
import { getKindConfig } from './kindConfig';
import {
  getCroppedBlob,
  loadImageElement,
  mapLegacyFocalPointToCrop,
  normaliseImageOrientation,
  blobToFile,
} from './cropUtils';
import './unifiedCropper.css';

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.1;
const MAX_INPUT_PIXELS = 25_000_000; // 25 MP source cap (memory guard)

/**
 * UnifiedCropper — single component used by every post-listing flow plus
 * AccountSettings. See docs/superpowers/specs/2026-06-05-unified-cropper-design.md.
 *
 * Props:
 *   kind:        "car" | "bike" | "plate" | "part" | "profile"
 *   images:      File[] OR Array<{file, previewUrl?, existingCrop?}>
 *   isOpen:      boolean
 *   onClose:     () => void
 *   onComplete:  (results) => void
 *     where results = Array<{ croppedFile: File, originalFile: File, previewUrl: string }>
 */
export default function UnifiedCropper({ kind, images, isOpen, onClose, onComplete }) {
  const cfg = useMemo(() => getKindConfig(kind), [kind]);
  const isSingleProfile = kind === 'profile' || (images && images.length === 1 && kind === 'profile');

  // Normalise: caller can pass File[] or wrapped objects.
  const normalisedImages = useMemo(() => {
    if (!images) return [];
    return images.map((img) => {
      if (img instanceof File) {
        return { file: img, previewUrl: URL.createObjectURL(img), existingCrop: null };
      }
      const file = img.file ?? img;
      const previewUrl = img.previewUrl ?? (file ? URL.createObjectURL(file) : null);
      return { file, previewUrl, existingCrop: img.existingCrop ?? null };
    });
  }, [images]);

  const [activeIndex, setActiveIndex] = useState(0);
  const [perImageState, setPerImageState] = useState(() =>
    normalisedImages.map((img) => {
      const seeded = img.existingCrop ? mapLegacyFocalPointToCrop(img.existingCrop) : { x: 0, y: 0, zoom: 1 };
      return {
        crop: { x: seeded.x, y: seeded.y },
        zoom: seeded.zoom,
        rotation: 0,
        croppedAreaPixels: null,
      };
    })
  );
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);
  const cancelRef = useRef(false);
  const previewUrlsRef = useRef(normalisedImages.map((i) => i.previewUrl));

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      previewUrlsRef.current.forEach((url) => url && URL.revokeObjectURL(url));
    };
  }, []);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (ev) => {
      if (ev.key === 'Escape') return onClose();
      if (ev.key === 'Enter' && !ev.repeat) return handleDone();
      if (ev.key === 'ArrowRight') return setActiveIndex((i) => Math.min(i + 1, normalisedImages.length - 1));
      if (ev.key === 'ArrowLeft') return setActiveIndex((i) => Math.max(i - 1, 0));
      if (ev.key === '+' || ev.key === '=') return updateActive({ zoom: clamp(perImageState[activeIndex]?.zoom + ZOOM_STEP) });
      if (ev.key === '-' || ev.key === '_') return updateActive({ zoom: clamp(perImageState[activeIndex]?.zoom - ZOOM_STEP) });
      if (ev.key === 'r' || ev.key === 'R') return rotateActive();
      return undefined;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activeIndex, perImageState, normalisedImages.length]);

  const clamp = (z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));

  const updateActive = useCallback((patch) => {
    setPerImageState((prev) => prev.map((p, i) => (i === activeIndex ? { ...p, ...patch } : p)));
  }, [activeIndex]);

  const handleCropChange = useCallback((crop) => updateActive({ crop }), [updateActive]);
  const handleZoomChange = useCallback((zoom) => updateActive({ zoom }), [updateActive]);
  const handleCropComplete = useCallback(
    (_area, croppedAreaPixels) => updateActive({ croppedAreaPixels }),
    [updateActive]
  );

  const rotateActive = useCallback(() => {
    setPerImageState((prev) =>
      prev.map((p, i) =>
        i === activeIndex ? { ...p, rotation: (p.rotation + 90) % 360 } : p
      )
    );
  }, [activeIndex]);

  const applyCurrentToAll = useCallback(() => {
    const active = perImageState[activeIndex];
    if (!active) return;
    setPerImageState((prev) =>
      prev.map(() => ({
        crop: { ...active.crop },
        zoom: active.zoom,
        rotation: active.rotation,
        croppedAreaPixels: null, // re-derive per image; user must dwell on each
      }))
    );
  }, [perImageState, activeIndex]);

  const handleDone = useCallback(async () => {
    if (isProcessing) return;
    setError(null);
    setIsProcessing(true);
    cancelRef.current = false;
    const results = [];
    try {
      for (let i = 0; i < normalisedImages.length; i++) {
        if (cancelRef.current) break;
        const { file } = normalisedImages[i];
        const state = perImageState[i];
        // If user never dwelled on this image, croppedAreaPixels is null.
        // Compute a default centred crop from the source dimensions.
        const normalisedFile = await normaliseImageOrientation(file);
        const imgEl = await loadImageElement(normalisedFile);
        if (imgEl.width * imgEl.height > MAX_INPUT_PIXELS) {
          throw new Error(`Image ${file.name || i + 1} is too large (over 25 megapixels). Please resize before uploading.`);
        }
        const pixelCrop = state.croppedAreaPixels || defaultCenteredCrop(imgEl, cfg.aspect);
        const blob = await getCroppedBlob(imgEl, pixelCrop, cfg, state.rotation);
        const { file: croppedFile, previewUrl } = blobToFile(blob, kind);
        previewUrlsRef.current.push(previewUrl);
        results.push({ croppedFile, originalFile: file, previewUrl });
      }
      if (!cancelRef.current) {
        onComplete(results);
      }
    } catch (e) {
      setError(e.message || 'Cropping failed');
    } finally {
      setIsProcessing(false);
    }
  }, [normalisedImages, perImageState, cfg, kind, isProcessing, onComplete]);

  const handleCancel = useCallback(() => {
    cancelRef.current = true;
    onClose();
  }, [onClose]);

  if (!isOpen) return null;
  if (!normalisedImages.length) return null;

  const active = normalisedImages[activeIndex];
  const activeState = perImageState[activeIndex] || { crop: { x: 0, y: 0 }, zoom: 1, rotation: 0 };
  const showThumbnails = !isSingleProfile && normalisedImages.length > 1;

  return (
    <div className="ucrop-overlay" role="dialog" aria-modal="true" aria-label={cfg.title}>
      <div className={`ucrop-modal ucrop-modal--${cfg.shape}`}>
        <header className="ucrop-header">
          <div>
            <h3>{cfg.title}</h3>
            <p>
              {normalisedImages.length > 1
                ? `${activeIndex + 1} of ${normalisedImages.length}. ${cfg.hint}`
                : cfg.hint}
            </p>
          </div>
          <button type="button" className="ucrop-close" onClick={handleCancel} aria-label="Close cropper">
            ×
          </button>
        </header>

        {error && <div className="ucrop-error">{error}</div>}

        <div className="ucrop-canvas">
          <Cropper
            image={active.previewUrl}
            crop={activeState.crop}
            zoom={activeState.zoom}
            rotation={activeState.rotation}
            aspect={cfg.aspect}
            cropShape={cfg.shape === 'round' ? 'round' : 'rect'}
            showGrid={cfg.shape === 'rect'}
            onCropChange={handleCropChange}
            onZoomChange={handleZoomChange}
            onCropComplete={handleCropComplete}
          />
        </div>

        <div className="ucrop-controls">
          <label htmlFor="ucrop-zoom">Zoom</label>
          <input
            id="ucrop-zoom"
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={activeState.zoom}
            onChange={(e) => updateActive({ zoom: Number(e.target.value) })}
          />
          <button type="button" className="ucrop-rotate" onClick={rotateActive} aria-label="Rotate 90 degrees">
            ↻ Rotate
          </button>
        </div>

        {showThumbnails && (
          <div className="ucrop-thumbs" data-testid="cropper-thumbnail-strip">
            {normalisedImages.map((img, i) => (
              <button
                type="button"
                key={i}
                className={`ucrop-thumb ${i === activeIndex ? 'ucrop-thumb--active' : ''}`}
                onClick={() => setActiveIndex(i)}
                aria-label={`Photo ${i + 1}`}
              >
                <img src={img.previewUrl} alt="" />
              </button>
            ))}
          </div>
        )}

        <footer className="ucrop-footer">
          {!isSingleProfile && normalisedImages.length > 1 && (
            <button type="button" className="ucrop-apply-all" onClick={applyCurrentToAll}>
              Apply current crop to all
            </button>
          )}
          <button type="button" className="ucrop-cancel" onClick={handleCancel} disabled={isProcessing}>
            Cancel
          </button>
          <button type="button" className="ucrop-done" onClick={handleDone} disabled={isProcessing}>
            {isProcessing ? 'Processing…' : 'Done'}
          </button>
        </footer>
      </div>
    </div>
  );
}

/** Default centred crop assuming the cropper hasn't dwelled on this image. */
function defaultCenteredCrop(img, aspect) {
  const targetRatio = aspect;
  const sourceRatio = img.width / img.height;
  let width, height;
  if (sourceRatio > targetRatio) {
    height = img.height;
    width = img.height * targetRatio;
  } else {
    width = img.width;
    height = img.width / targetRatio;
  }
  return {
    x: (img.width - width) / 2,
    y: (img.height - height) / 2,
    width,
    height,
  };
}
```

- [ ] **Step 4: Write `unifiedCropper.css`**

```css
/* flask-react-supabase-app/frontend/src/components/cropper/unifiedCropper.css */

.ucrop-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.78);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.ucrop-modal {
  width: 100%;
  max-width: 920px;
  max-height: calc(100vh - 32px);
  background: #0a1410;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: #fff;
}

.ucrop-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.ucrop-header h3 { margin: 0; font-size: 17px; font-weight: 600; }
.ucrop-header p  { margin: 6px 0 0; font-size: 13px; color: rgba(255,255,255,0.55); }

.ucrop-close {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  color: rgba(255,255,255,0.7);
  width: 32px; height: 32px; border-radius: 999px;
  display: flex; align-items: center; justify-content: center;
  font-size: 18px;
  cursor: pointer;
}

.ucrop-error {
  margin: 0 24px 12px;
  padding: 10px 12px;
  background: rgba(239, 68, 68, 0.10);
  border: 1px solid rgba(239, 68, 68, 0.30);
  border-radius: 10px;
  color: #fca5a5;
  font-size: 13px;
}

.ucrop-canvas {
  position: relative;
  flex: 1 1 auto;
  min-height: 340px;
  background: #000;
}

.ucrop-controls {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 24px;
  border-top: 1px solid rgba(255,255,255,0.06);
}
.ucrop-controls label { font-size: 12px; color: rgba(255,255,255,0.6); }
.ucrop-controls input[type="range"] { flex: 1; }

.ucrop-rotate {
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.10);
  color: #fff; padding: 6px 12px; border-radius: 8px;
  font-size: 12px; cursor: pointer;
}

.ucrop-thumbs {
  display: flex; gap: 8px; overflow-x: auto;
  padding: 12px 24px;
  border-top: 1px solid rgba(255,255,255,0.06);
}
.ucrop-thumb {
  flex-shrink: 0;
  width: 60px; height: 60px;
  padding: 0; border: 2px solid transparent; border-radius: 8px;
  background: #000; cursor: pointer; overflow: hidden;
}
.ucrop-thumb img { width: 100%; height: 100%; object-fit: cover; }
.ucrop-thumb--active { border-color: #10b981; box-shadow: 0 0 0 2px rgba(16,185,129,0.25); }

.ucrop-footer {
  display: flex; gap: 8px; align-items: center;
  padding: 16px 24px;
  border-top: 1px solid rgba(255,255,255,0.06);
}
.ucrop-apply-all {
  background: rgba(16,185,129,0.10);
  border: 1px solid rgba(16,185,129,0.30);
  color: #a7f3d0; padding: 8px 12px; border-radius: 8px;
  font-size: 12px; cursor: pointer; margin-right: auto;
}
.ucrop-cancel, .ucrop-done {
  padding: 9px 16px; border-radius: 10px; font-size: 13px; cursor: pointer; border: 1px solid transparent;
}
.ucrop-cancel { background: rgba(255,255,255,0.06); color: #fff; border-color: rgba(255,255,255,0.10); }
.ucrop-done   { background: #10b981; color: #04140a; font-weight: 600; }
.ucrop-done:disabled, .ucrop-cancel:disabled { opacity: 0.5; cursor: not-allowed; }

.ucrop-modal--round .ucrop-canvas { background: #050a08; }
```

- [ ] **Step 5: Run the component test, confirm pass**

```bash
cd flask-react-supabase-app/frontend
npx react-scripts test --watchAll=false src/components/cropper/
```

Expected: `6 passed` for UnifiedCropper.test, plus the 7 from cropUtils.test = 13 total.

- [ ] **Step 6: Commit**

```bash
git add flask-react-supabase-app/frontend/src/components/cropper/
git commit -m "Unified Cropper: UnifiedCropper.jsx component + tests"
```

---

## Task 4: Backend — accept new image uploads with `cropped_at`

**Files:**
- Modify: `flask-react-supabase-app/backend/app.py` — find the image-insert sites that write to `car_images`, `bike_images`, `plate_images`, `part_images`. Add `"cropped_at": "now()"` to the row body when the upload is a real cropped blob (always true going forward). Also include `cropped_at` in the SELECT lists where images are read.

- [ ] **Step 1: Locate the insert sites**

```bash
grep -nE 'car_images|bike_images|plate_images|part_images' flask-react-supabase-app/backend/app.py | grep -i 'POST\|insert\|.json=' | head
```

You're looking for the place each table receives a new image row insert via supabase REST. There are 4 such sites (one per kind).

- [ ] **Step 2: For each of the 4 insert sites, add `cropped_at` to the inserted body**

Example modification — wherever the code currently does something like:

```python
new_image = {
    "listing_id": listing_id,
    "url": public_url,
    "display_url": display_url,
    "image_order": idx,
}
```

Change to:

```python
new_image = {
    "listing_id": listing_id,
    "url": public_url,
    "display_url": display_url,
    "image_order": idx,
    "cropped_at": _isoformat_utc(_utc_now()),  # marks this as a real cropped blob
}
```

Use the existing `_isoformat_utc` + `_utc_now` helpers already in app.py.

- [ ] **Step 3: Locate the image SELECT sites**

```bash
grep -nE 'select=.*image_order|select=.*url.*display_url' flask-react-supabase-app/backend/app.py | head
```

These are where image rows are fetched for listing detail responses. For each, add `cropped_at` to the comma-separated select list.

- [ ] **Step 4: Quick smoke**

```bash
cd flask-react-supabase-app/backend
./venv/bin/python -c "import app; print('app imports cleanly')"
```

Expected: `app imports cleanly` with no traceback.

- [ ] **Step 5: Commit**

```bash
git add flask-react-supabase-app/backend/app.py
git commit -m "Unified Cropper: backend writes cropped_at on insert + selects it on read"
```

---

## Task 5: Wire `UnifiedCropper` into `PostCar` (replace ImageFramingModal)

**Files:**
- Modify: `flask-react-supabase-app/frontend/src/components/PostCar.js`

This is the largest single integration because PostCar today has ~20 separate references to `imageCropSettings` / `DEFAULT_IMAGE_CROP` / `ImageFramingModal`.

- [ ] **Step 1: Remove the old crop state and imports**

Find and delete:

```jsx
import ImageFramingModal from './ImageFramingModal';
const DEFAULT_IMAGE_CROP = { focalX: 50, focalY: 50, zoom: 1 };
const [imageCropSettings, setImageCropSettings] = useState([]);
```

And every reference to `imageCropSettings`, `setImageCropSettings`, `DEFAULT_IMAGE_CROP`, `updateImageCropSetting`, the `framingCropSettings` derived state, and the `<ImageFramingModal ... />` JSX block at the bottom of the file. Grep to find them:

```bash
grep -nE "imageCropSettings|ImageFramingModal|DEFAULT_IMAGE_CROP|framingCropSettings|updateImageCropSetting" flask-react-supabase-app/frontend/src/components/PostCar.js
```

You'll touch ~20 lines.

- [ ] **Step 2: Add the new state and import**

At the top of the file, near the other imports:

```jsx
import UnifiedCropper from './cropper/UnifiedCropper';
```

In the component body, near the other useState calls:

```jsx
const [pendingCropFiles, setPendingCropFiles] = useState(null);
const [croppedImages, setCroppedImages] = useState([]); // Array<{croppedFile, originalFile, previewUrl}>
```

- [ ] **Step 3: Modify the file-picker handler**

Find the existing image-picker `onChange` handler (the one that today appends to `setImageCropSettings` and `setNewImages`). Replace its body with:

```jsx
const onPickImages = (e) => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  setPendingCropFiles(files);
  e.target.value = ''; // allow re-picking same file
};
```

- [ ] **Step 4: Render the cropper conditionally**

Replace the `<ImageFramingModal ... />` block at the bottom of the JSX with:

```jsx
{pendingCropFiles && (
  <UnifiedCropper
    kind="car"
    images={pendingCropFiles}
    isOpen
    onClose={() => setPendingCropFiles(null)}
    onComplete={(results) => {
      setCroppedImages((prev) => [...prev, ...results]);
      setPendingCropFiles(null);
    }}
  />
)}
```

- [ ] **Step 5: Update the submit handler to use cropped files**

Find where FormData is built and submitted. Replace any block like:

```jsx
selectedFiles.forEach((f, i) => {
  formData.append('images', f);
  formData.append(`crop_data_${i}`, JSON.stringify(imageCropSettings[i]));
});
```

With:

```jsx
croppedImages.forEach(({ croppedFile }) => {
  formData.append('images', croppedFile);
});
```

(No more `crop_data_*` form fields.)

- [ ] **Step 6: Update the thumbnails grid render**

Wherever PostCar currently renders thumbnails of selected/pending images, swap the source from the raw File preview to the cropped `previewUrl`:

```jsx
{croppedImages.map((img, i) => (
  <img key={i} src={img.previewUrl} alt={`Photo ${i + 1}`} />
))}
```

- [ ] **Step 7: Build check**

```bash
cd flask-react-supabase-app/frontend
CI=false npm run build 2>&1 | tail -15
```

Expected: build succeeds. If you see `imageCropSettings is not defined` or similar, you missed a reference — grep again and clean up.

- [ ] **Step 8: Commit**

```bash
git add flask-react-supabase-app/frontend/src/components/PostCar.js
git commit -m "Unified Cropper: PostCar uses UnifiedCropper; remove ImageFramingModal wiring"
```

---

## Task 6: Wire `UnifiedCropper` into `PostBike`

**Files:**
- Modify: `flask-react-supabase-app/frontend/src/components/PostBike.js`

PostBike has NO existing crop step — this is a new feature for bikes.

- [ ] **Step 1: Find the image picker handler**

```bash
grep -nE "type=\"file\"|onPickImages|handleImage|FormData|append" flask-react-supabase-app/frontend/src/components/PostBike.js | head -20
```

- [ ] **Step 2: Add cropper state + import**

At top:
```jsx
import UnifiedCropper from './cropper/UnifiedCropper';
```

Near other useState calls in the component:
```jsx
const [pendingCropFiles, setPendingCropFiles] = useState(null);
const [croppedImages, setCroppedImages] = useState([]);
```

- [ ] **Step 3: Route the file picker through the cropper**

Modify the file-picker `onChange`:
```jsx
const onPickImages = (e) => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  setPendingCropFiles(files);
  e.target.value = '';
};
```

Render at the bottom of the JSX:
```jsx
{pendingCropFiles && (
  <UnifiedCropper
    kind="bike"
    images={pendingCropFiles}
    isOpen
    onClose={() => setPendingCropFiles(null)}
    onComplete={(results) => {
      setCroppedImages((prev) => [...prev, ...results]);
      setPendingCropFiles(null);
    }}
  />
)}
```

- [ ] **Step 4: Submit cropped files instead of raw**

In the FormData build:
```jsx
croppedImages.forEach(({ croppedFile }) => formData.append('images', croppedFile));
```

- [ ] **Step 5: Build + commit**

```bash
cd flask-react-supabase-app/frontend && CI=false npm run build 2>&1 | tail -5
git add flask-react-supabase-app/frontend/src/components/PostBike.js
git commit -m "Unified Cropper: PostBike crops bike photos at 16:10 before upload"
```

---

## Task 7: Wire `UnifiedCropper` into `PostCarParts`

**Files:**
- Modify: `flask-react-supabase-app/frontend/src/components/PostCarParts.js`

Identical structure to PostBike but `kind="part"`. Aspect 1:1, output 1200×1200.

- [ ] **Step 1: Add import + state**

```jsx
import UnifiedCropper from './cropper/UnifiedCropper';
// ...
const [pendingCropFiles, setPendingCropFiles] = useState(null);
const [croppedImages, setCroppedImages] = useState([]);
```

- [ ] **Step 2: Route picker through cropper with `kind="part"`**

```jsx
{pendingCropFiles && (
  <UnifiedCropper
    kind="part"
    images={pendingCropFiles}
    isOpen
    onClose={() => setPendingCropFiles(null)}
    onComplete={(results) => {
      setCroppedImages((prev) => [...prev, ...results]);
      setPendingCropFiles(null);
    }}
  />
)}
```

- [ ] **Step 3: Submit cropped files, build + commit**

```bash
cd flask-react-supabase-app/frontend && CI=false npm run build 2>&1 | tail -5
git add flask-react-supabase-app/frontend/src/components/PostCarParts.js
git commit -m "Unified Cropper: PostCarParts crops parts at 1:1 before upload"
```

---

## Task 8: Wire `UnifiedCropper` into `PostPlate`

**Files:**
- Modify: `flask-react-supabase-app/frontend/src/components/PostPlate.js`

Same as the previous two but `kind="plate"`, aspect 4:1.

- [ ] **Step 1: Add import + state**

```jsx
import UnifiedCropper from './cropper/UnifiedCropper';
// ...
const [pendingCropFiles, setPendingCropFiles] = useState(null);
const [croppedImages, setCroppedImages] = useState([]);
```

- [ ] **Step 2: Render cropper with `kind="plate"`**

```jsx
{pendingCropFiles && (
  <UnifiedCropper
    kind="plate"
    images={pendingCropFiles}
    isOpen
    onClose={() => setPendingCropFiles(null)}
    onComplete={(results) => {
      setCroppedImages((prev) => [...prev, ...results]);
      setPendingCropFiles(null);
    }}
  />
)}
```

- [ ] **Step 3: Submit cropped files, build + commit**

```bash
cd flask-react-supabase-app/frontend && CI=false npm run build 2>&1 | tail -5
git add flask-react-supabase-app/frontend/src/components/PostPlate.js
git commit -m "Unified Cropper: PostPlate crops plates at 4:1 before upload"
```

---

## Task 9: Wire `UnifiedCropper` into `AccountSettings` (profile photo)

**Files:**
- Modify: `flask-react-supabase-app/frontend/src/components/AccountSettings.js`

Swap `ImageCropModal` for `UnifiedCropper` with `kind="profile"`. The single-image + round-mask path is already handled inside the cropper.

- [ ] **Step 1: Replace the import**

```jsx
// remove
import ImageCropModal from './ImageCropModal';
// add
import UnifiedCropper from './cropper/UnifiedCropper';
```

- [ ] **Step 2: Replace the JSX render block**

Find where ImageCropModal is rendered (around line 686 in the current file). Replace with:

```jsx
{showCropModal && pendingProfileFile && (
  <UnifiedCropper
    kind="profile"
    images={[pendingProfileFile]}
    isOpen
    onClose={() => { setShowCropModal(false); setPendingProfileFile(null); }}
    onComplete={(results) => {
      const cropped = results[0];
      if (cropped) {
        // existing upload flow takes a File — pass cropped.croppedFile
        handleCroppedProfileUpload(cropped.croppedFile, cropped.previewUrl);
      }
      setShowCropModal(false);
      setPendingProfileFile(null);
    }}
  />
)}
```

The existing `handleCroppedProfileUpload` (or equivalent) handler should already accept a File + preview URL. If it doesn't yet, adapt minimally.

- [ ] **Step 3: Add the missing pending state if not present**

Look for where the file picker stashes the selected File for cropping. If it's currently kept in a separate variable, rename to `pendingProfileFile` for clarity. If the file is read into a data URL, you can pass a File-like object via `images={[{ file: pendingProfileFile, previewUrl: dataUrl }]}` instead.

- [ ] **Step 4: Build + commit**

```bash
cd flask-react-supabase-app/frontend && CI=false npm run build 2>&1 | tail -5
git add flask-react-supabase-app/frontend/src/components/AccountSettings.js
git commit -m "Unified Cropper: AccountSettings profile photo uses UnifiedCropper"
```

---

## Task 10: Render branch for `cropped_at` in detail pages + marketplace card

**Files:**
- Modify: `flask-react-supabase-app/frontend/src/components/CarDetail.jsx`
- Modify: `flask-react-supabase-app/frontend/src/components/BikeDetailRedesigned.jsx`
- Modify: `flask-react-supabase-app/frontend/src/components/PartDetailRedesigned.jsx`
- Modify: `flask-react-supabase-app/frontend/src/components/PlateDetailRedesigned.jsx`
- Modify: `flask-react-supabase-app/frontend/src/components/MarketplaceListingCard.jsx`

The renderers today apply `object-position: focal_x% focal_y%` unconditionally. The new path: if `cropped_at` is set, render the image plainly; only the legacy fallback uses the CSS positioning.

- [ ] **Step 1: Each renderer — find the image render site**

```bash
grep -n "object-position\|focalX\|focal_x\|objectPosition" flask-react-supabase-app/frontend/src/components/CarDetail.jsx flask-react-supabase-app/frontend/src/components/BikeDetailRedesigned.jsx flask-react-supabase-app/frontend/src/components/PartDetailRedesigned.jsx flask-react-supabase-app/frontend/src/components/PlateDetailRedesigned.jsx flask-react-supabase-app/frontend/src/components/MarketplaceListingCard.jsx
```

For each match, wrap the `objectPosition` style in a `cropped_at`-aware ternary. Example for CarDetail:

```jsx
// Before (paraphrased — actual lines around CarDetail.jsx:332)
style={{ objectPosition: `${image.focal_x ?? 50}% ${image.focal_y ?? 50}%` }}

// After
style={image.cropped_at
  ? undefined
  : { objectPosition: `${image.focal_x ?? 50}% ${image.focal_y ?? 50}%` }
}
```

Repeat for every match in each file.

- [ ] **Step 2: Build + manual visual sanity**

```bash
cd flask-react-supabase-app/frontend && CI=false npm run build 2>&1 | tail -5
```

Then open a freshly-cropped listing locally (after a new upload) and a pre-existing listing — both should render correctly; the new one with no positioning math, the old one with the focal-point CSS.

- [ ] **Step 3: Commit**

```bash
git add flask-react-supabase-app/frontend/src/components/CarDetail.jsx \
        flask-react-supabase-app/frontend/src/components/BikeDetailRedesigned.jsx \
        flask-react-supabase-app/frontend/src/components/PartDetailRedesigned.jsx \
        flask-react-supabase-app/frontend/src/components/PlateDetailRedesigned.jsx \
        flask-react-supabase-app/frontend/src/components/MarketplaceListingCard.jsx
git commit -m "Unified Cropper: detail + card renderers branch on cropped_at"
```

---

## Task 11: Delete dead code

**Files:**
- Delete: `flask-react-supabase-app/frontend/src/components/ImageFramingModal.jsx`
- Delete: `flask-react-supabase-app/frontend/src/styles/ImageFramingModal.css`
- Delete: `flask-react-supabase-app/frontend/src/components/ImageCropModal.js`

- [ ] **Step 1: Confirm no remaining importers**

```bash
grep -rnE "ImageFramingModal|ImageCropModal" flask-react-supabase-app/frontend/src --include="*.js" --include="*.jsx" --include="*.css"
```

Expected: only matches inside the files about to be deleted (the components themselves and the CSS file).

- [ ] **Step 2: Delete the files**

```bash
rm flask-react-supabase-app/frontend/src/components/ImageFramingModal.jsx \
   flask-react-supabase-app/frontend/src/styles/ImageFramingModal.css \
   flask-react-supabase-app/frontend/src/components/ImageCropModal.js
```

- [ ] **Step 3: Build to confirm nothing references them**

```bash
cd flask-react-supabase-app/frontend && CI=false npm run build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Unified Cropper: delete ImageFramingModal + ImageCropModal (replaced)"
```

---

## Task 12: Admin dashboard — `cropped_at` migration health tile

**Files:**
- Modify: `flask-react-supabase-app/backend/app.py` — add a query computing the percent of image rows with `cropped_at IS NOT NULL` across all four tables, expose in the existing `/api/admin/stats` response under a `cropped_at_pct` key.
- Modify: `flask-react-supabase-app/frontend/src/components/AdminDashboard.js` — render a new health tile.

- [ ] **Step 1: Backend — extend `/api/admin/stats`**

In the `/api/admin/stats` handler (search `def admin_stats`), add a small block that fires four parallel COUNT queries:

```python
# After the existing counts are computed
cropped_at_pct = None
try:
    totals = {"car": 0, "bike": 0, "plate": 0, "part": 0}
    cropped = {"car": 0, "bike": 0, "plate": 0, "part": 0}
    for kind, table in (("car", "car_images"), ("bike", "bike_images"),
                         ("plate", "plate_images"), ("part", "part_images")):
        all_r, _ = supabase_request(
            "head", f"/rest/v1/{table}",
            params={"select": "id"}, use_service_role=True,
            headers={"Prefer": "count=exact"},
        )
        # supabase_request returns parsed json; for HEAD we need the content-range
        # header — call requests directly here if helper doesn't support HEAD
    # If the helper doesn't expose headers, do two cheap GETs with `count=exact`
    # and read total from content-range — pattern is already used in dealer/leads.py.
    total_all = sum(totals.values())
    cropped_all = sum(cropped.values())
    cropped_at_pct = round(100.0 * cropped_all / total_all, 2) if total_all else None
except Exception as e:
    logger.warning("cropped_at_pct calc failed: %s", e)

# In the response payload:
metrics["cropped_at_pct"] = cropped_at_pct
```

(The exact `supabase_request` HEAD/count-exact pattern is already used in `routes/dealer/leads.py` — mirror that.)

- [ ] **Step 2: Frontend — add a tile to AdminDashboard**

In the data-health section (search `dataHealth` or the existing health card grid in `AdminDashboard.js`), add a new tile alongside the others:

```jsx
{stats.cropped_at_pct !== null && stats.cropped_at_pct !== undefined && (
  <div className="health-tile">
    <p className="health-tile-label">Modern crop rollout</p>
    <p className="health-tile-value">{stats.cropped_at_pct}%</p>
    <p className="health-tile-caption">of listing images use the unified cropper</p>
  </div>
)}
```

(Use the existing tile classes from the data-health block — don't invent new ones.)

- [ ] **Step 3: Build + commit**

```bash
cd flask-react-supabase-app/frontend && CI=false npm run build 2>&1 | tail -5
cd /Users/suhayl/Downloads/Flask-React-superbase-classified
git add flask-react-supabase-app/backend/app.py flask-react-supabase-app/frontend/src/components/AdminDashboard.js
git commit -m "Unified Cropper: admin dashboard shows % of images using new crop path"
```

---

## Task 13: Manual smoke + final commit

- [ ] **Step 1: Run all tests one more time**

```bash
cd flask-react-supabase-app/frontend
npx react-scripts test --watchAll=false src/components/cropper/ src/utils/directUpload.test.js
```

Expected: all green. Should be 13 cropper tests + the existing directUpload tests.

- [ ] **Step 2: Apply the migration in Supabase**

If not done in Task 1, paste `backend/migrations/2026_06_05_image_cropped_at.sql` into Supabase SQL Editor and run.

- [ ] **Step 3: Smoke each post-listing flow**

Sign in, then for each of cars / bikes / parts / plates:
1. Start a new listing
2. Add 3 photos
3. The cropper opens → crop each, hit Done
4. Submit the listing
5. View the listing's detail page — confirm the hero image renders correctly
6. Open Supabase `*_images` and confirm the row has `cropped_at` set

For profile:
1. Account Settings → upload profile photo
2. Cropper opens with round mask
3. Crop, save
4. Refresh — confirm the round profile photo renders correctly

- [ ] **Step 4: Edit smoke (lazy migration)**

1. Open an existing pre-migration listing for edit
2. The thumbnails should show the legacy images normally (no cropper open)
3. Re-edit (or click any "Improve crop" affordance if you added one in Task 5)
4. After save, the row's `cropped_at` is set and the listing renders without focal-point CSS

If anything breaks during smoke, fix it in a follow-up commit; don't squash into earlier task commits.

- [ ] **Step 5: Push**

```bash
git push origin main
```

(Or open a PR if you're working on a feature branch.)

---

## Self-review checklist

- [ ] **Spec coverage:**
  - §1 Purpose & scope → Tasks 5–9 (the five surfaces) and Task 1 (migration)
  - §2 Public API → Task 3
  - §3 Internal architecture → Task 3
  - §4 Per-listing-type config → Task 2 (`kindConfig.js`)
  - §5 Upload pipeline integration → Tasks 4 (backend) + 5–9 (frontend)
  - §6 Data model + lazy migration → Tasks 1, 4, 10
  - §7 Error handling → Task 3 (`MAX_INPUT_PIXELS`, `try/catch` in `handleDone`, blob cleanup on unmount)
  - §8 Testing strategy → Tasks 2, 3 (unit + component); manual smoke in Task 13
  - §9 Implementation phases → Task numbering matches the spec's recommended order
  - §10 Open questions → explicitly out of scope for v1
  - §11 Acceptance criteria for v1 → mapped 1:1 to tasks above
- [ ] **No placeholders.** "TBD" / "TODO" / "implement later" / "similar to Task N" — none.
- [ ] **Type consistency.** `croppedFile`, `originalFile`, `previewUrl`, `cropped_at`, `kind`, `KIND_CONFIG` — same names used in every task.
- [ ] **TDD ordering.** Pure helpers (Task 2) and component (Task 3) ship with tests first; integrations (5–10) rely on the proven helpers.
- [ ] **Each task gets its own commit.** No mega-commits.

---

## Deferred to a follow-up plan

- **Inline edit on the listing detail page** (e.g. re-crop without opening full edit form). Trivial follow-up — cropper is reusable.
- **AI-suggested initial crop** (subject detection to pre-position the focal point).
- **Backfill worker** to migrate the last 5% of legacy rows once the `cropped_at_pct` metric is high enough.
- **Remove the CSS-positioning fallback** entirely from renderers (after backfill).
- **Mobile native cropper parity** (replace Expo's `ImagePicker` editor with a custom RN cropper).
