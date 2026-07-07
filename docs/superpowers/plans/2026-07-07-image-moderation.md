# Image Moderation (NSFW + Face Detection) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hard-block listing image uploads that contain nudity or visible faces, client-side, on both web and mobile, before images reach the cropper or Supabase storage.

**Architecture:** Two `imageModeration.js` utilities (one per platform) expose a single `moderateImage(source)` → `{ blocked, reasons }` function. Models (nsfwjs + BlazeFace) load lazily on first call and are cached. Each listing form component hooks the moderation call between file-selection validation and the cropper/upload step.

**Tech Stack:** nsfwjs, @tensorflow-models/blazeface, @tensorflow/tfjs (web) + @tensorflow/tfjs-react-native + expo-gl (mobile)

---

## File Map

| File | Change |
|---|---|
| `frontend/src/utils/imageModeration.js` | **Create** — web moderation utility |
| `frontend/src/utils/imageModeration.test.js` | **Create** — unit tests (Jest, fully mocked) |
| `frontend/src/components/PostCar.js` | **Modify** — make `processFiles` async, add moderation before `setPendingCropFiles` |
| `frontend/src/components/PostBike.js` | **Modify** — same pattern as PostCar |
| `frontend/src/components/PostCarParts.js` | **Modify** — same pattern as PostCar |
| `frontend/src/components/PostPlate.js` | **Modify** — add moderation in `handleProofFileChange` before upload |
| `mobile/src/utils/imageModeration.js` | **Create** — RN moderation utility |
| `mobile/src/screens/listing/PostListingScreen.js` | **Modify** — add moderation in `pickImages` before `setCropperUri` |
| `flask-react-supabase-app/frontend/package.json` | **Modify** — add nsfwjs, blazeface, tfjs |
| `flask-react-supabase-app/mobile/package.json` | **Modify** — add tfjs-react-native, expo-gl |

---

## Phase 1 — Web

### Task 1: Install web dependencies

**Files:**
- Modify: `flask-react-supabase-app/frontend/package.json`

- [ ] **Step 1: Install packages**

```bash
cd flask-react-supabase-app/frontend
npm install nsfwjs @tensorflow-models/blazeface @tensorflow/tfjs @tensorflow/tfjs-backend-webgl
```

Expected output: packages added, no peer dep errors.

- [ ] **Step 2: Verify install**

```bash
node -e "require('nsfwjs'); require('@tensorflow-models/blazeface'); console.log('ok')"
```

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add flask-react-supabase-app/frontend/package.json flask-react-supabase-app/frontend/package-lock.json
git commit -m "chore(web): add nsfwjs + blazeface + tfjs for client-side image moderation"
```

---

### Task 2: Create web imageModeration utility + unit tests

**Files:**
- Create: `flask-react-supabase-app/frontend/src/utils/imageModeration.js`
- Create: `flask-react-supabase-app/frontend/src/utils/imageModeration.test.js`

- [ ] **Step 1: Write the failing tests first**

Create `flask-react-supabase-app/frontend/src/utils/imageModeration.test.js`:

```js
// Mock all TF.js / model modules before any imports
jest.mock('nsfwjs');
jest.mock('@tensorflow-models/blazeface');
jest.mock('@tensorflow/tfjs', () => ({}));
jest.mock('@tensorflow/tfjs-backend-webgl', () => ({}));

import nsfwjs from 'nsfwjs';
import * as blazeface from '@tensorflow-models/blazeface';
import { moderateImage, _resetModels } from './imageModeration';

// Minimal File stub — JSDOM doesn't provide a real File with type
function makeFile(name = 'car.jpg', type = 'image/jpeg') {
  return new File(['x'], name, { type });
}

// Stub URL.createObjectURL / revokeObjectURL
beforeAll(() => {
  global.URL.createObjectURL = jest.fn(() => 'blob:mock');
  global.URL.revokeObjectURL = jest.fn();
  // Stub Image so fileToImageElement resolves immediately
  global.Image = class {
    set src(_) { setTimeout(() => this.onload?.(), 0); }
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  _resetModels();
});

function mockModels({ porn = 0, hentai = 0, sexy = 0, faces = [] } = {}) {
  nsfwjs.load.mockResolvedValue({
    classify: jest.fn().mockResolvedValue([
      { className: 'Neutral', probability: 1 - porn - hentai - sexy },
      { className: 'Porn', probability: porn },
      { className: 'Hentai', probability: hentai },
      { className: 'Sexy', probability: sexy },
      { className: 'Drawing', probability: 0 },
    ]),
  });
  blazeface.load.mockResolvedValue({
    estimateFaces: jest.fn().mockResolvedValue(faces),
  });
}

test('clean image is not blocked', async () => {
  mockModels();
  const result = await moderateImage(makeFile());
  expect(result.blocked).toBe(false);
  expect(result.reasons).toEqual([]);
});

test('porn > 0.60 is blocked as nudity', async () => {
  mockModels({ porn: 0.85 });
  const result = await moderateImage(makeFile());
  expect(result.blocked).toBe(true);
  expect(result.reasons).toContain('nudity');
});

test('hentai > 0.60 is blocked as nudity', async () => {
  mockModels({ hentai: 0.75 });
  const result = await moderateImage(makeFile());
  expect(result.blocked).toBe(true);
  expect(result.reasons).toContain('nudity');
});

test('sexy > 0.70 is blocked as nudity', async () => {
  mockModels({ sexy: 0.80 });
  const result = await moderateImage(makeFile());
  expect(result.blocked).toBe(true);
  expect(result.reasons).toContain('nudity');
});

test('sexy <= 0.70 is NOT blocked', async () => {
  mockModels({ sexy: 0.65 });
  const result = await moderateImage(makeFile());
  expect(result.blocked).toBe(false);
});

test('face with probability > 0.75 is blocked', async () => {
  mockModels({ faces: [{ probability: [0.95] }] });
  const result = await moderateImage(makeFile());
  expect(result.blocked).toBe(true);
  expect(result.reasons).toContain('face');
});

test('face with probability <= 0.75 is NOT blocked', async () => {
  mockModels({ faces: [{ probability: [0.60] }] });
  const result = await moderateImage(makeFile());
  expect(result.blocked).toBe(false);
});

test('face AND nudity returns both reasons deduplicated', async () => {
  mockModels({ porn: 0.90, faces: [{ probability: [0.95] }] });
  const result = await moderateImage(makeFile());
  expect(result.blocked).toBe(true);
  expect(result.reasons).toContain('nudity');
  expect(result.reasons).toContain('face');
  expect(result.reasons.length).toBe(2);
});

test('models load once and are reused across calls', async () => {
  mockModels();
  await moderateImage(makeFile());
  await moderateImage(makeFile());
  expect(nsfwjs.load).toHaveBeenCalledTimes(1);
  expect(blazeface.load).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run tests — expect them to fail with "Cannot find module './imageModeration'"**

```bash
cd flask-react-supabase-app/frontend
npx react-scripts test --watchAll=false --testPathPattern=imageModeration.test.js 2>&1 | tail -20
```

Expected: `Cannot find module './imageModeration'`

- [ ] **Step 3: Create the implementation**

Create `flask-react-supabase-app/frontend/src/utils/imageModeration.js`:

```js
import * as nsfwjs from 'nsfwjs';
import * as blazeface from '@tensorflow-models/blazeface';
import '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-webgl';

let nsfwModel = null;
let faceModel = null;

// Exported for test resets only — not for production use
export function _resetModels() {
  nsfwModel = null;
  faceModel = null;
}

async function loadModels() {
  if (!nsfwModel || !faceModel) {
    [nsfwModel, faceModel] = await Promise.all([
      nsfwjs.load(),
      blazeface.load(),
    ]);
  }
}

function fileToImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')); };
    img.src = url;
  });
}

/**
 * @param {File|Blob} file
 * @returns {Promise<{ blocked: boolean, reasons: string[] }>}
 *   reasons: subset of ['nudity', 'face']
 */
export async function moderateImage(file) {
  await loadModels();
  const img = await fileToImageElement(file);

  const [predictions, faces] = await Promise.all([
    nsfwModel.classify(img),
    faceModel.estimateFaces(img, false),
  ]);

  const reasons = [];

  const prob = Object.fromEntries(predictions.map(p => [p.className, p.probability]));
  if ((prob.Porn || 0) > 0.60) reasons.push('nudity');
  if ((prob.Hentai || 0) > 0.60) reasons.push('nudity');
  if ((prob.Sexy || 0) > 0.70) reasons.push('nudity');

  const faceDetected = faces.some(f => {
    const p = Array.isArray(f.probability) ? f.probability[0] : (f.probability ?? 1);
    return p > 0.75;
  });
  if (faceDetected) reasons.push('face');

  return { blocked: reasons.length > 0, reasons: [...new Set(reasons)] };
}
```

- [ ] **Step 4: Run tests — expect all 9 to pass**

```bash
cd flask-react-supabase-app/frontend
npx react-scripts test --watchAll=false --testPathPattern=imageModeration.test.js 2>&1 | tail -15
```

Expected: `9 passed`

- [ ] **Step 5: Commit**

```bash
git add flask-react-supabase-app/frontend/src/utils/imageModeration.js flask-react-supabase-app/frontend/src/utils/imageModeration.test.js
git commit -m "feat(web): add imageModeration utility — nsfwjs + blazeface, lazy singleton, 9 tests"
```

---

### Task 3: Hook moderation into PostCar.js

**Files:**
- Modify: `flask-react-supabase-app/frontend/src/components/PostCar.js`

The hook goes inside `processFiles`. Currently `processFiles` is synchronous and ends with `setPendingCropFiles(dedupedNewFiles)`. We make it async, run moderation per file concurrently, filter clean files through, and set per-file error state for blocked ones.

- [ ] **Step 1: Add import and moderation error state**

At the top of `PostCar.js`, add the import after the existing utils imports:

```js
import { moderateImage } from '../utils/imageModeration';
```

Inside the component, after the existing `useState` declarations (around line 90), add:

```js
const [moderationErrors, setModerationErrors] = useState({}); // { [filename]: errorMessage }
const [moderating, setModerating] = useState(false);
```

- [ ] **Step 2: Replace `processFiles` with an async version**

Find the existing `processFiles` function (around line 1666). Replace the entire function:

```js
const processFiles = async (files) => {
  const nextFiles = files.filter((file) => file && file.type?.startsWith('image/'));
  if (nextFiles.length === 0) {
    setError('Please select image files only.');
    return;
  }

  const dedupedNewFiles = nextFiles.filter((file) => {
    const signature = `${file.name}-${file.size}-${file.lastModified}`;
    return !croppedImages.some(
      ({ originalFile }) =>
        originalFile &&
        `${originalFile.name}-${originalFile.size}-${originalFile.lastModified}` === signature
    );
  });

  const totalFiles = existingImages.length + croppedImages.length + dedupedNewFiles.length;
  if (totalFiles > 10) {
    setError('You can only upload up to 10 images.');
    return;
  }

  const invalidTypeFile = dedupedNewFiles.find((file) => !SUPPORTED_IMAGE_TYPES.includes((file.type || '').toLowerCase()));
  if (invalidTypeFile) {
    setError('Only JPG, PNG, WEBP, and GIF images are supported.');
    return;
  }

  const oversizedFile = dedupedNewFiles.find((file) => file.size > MAX_IMAGE_SIZE_BYTES);
  if (oversizedFile) {
    setError('Each image must be 20MB or smaller.');
    return;
  }

  setError(null);
  setModerating(true);
  setModerationErrors({});

  try {
    const results = await Promise.all(
      dedupedNewFiles.map(file => moderateImage(file).then(r => ({ file, ...r })))
    );

    const newErrors = {};
    const cleanFiles = [];
    for (const { file, blocked, reasons } of results) {
      if (blocked) {
        newErrors[file.name] = reasons.includes('nudity')
          ? 'This photo was blocked — explicit content detected. Please use photos that show the vehicle only.'
          : 'This photo was blocked — a face was detected. Please use photos that show the vehicle only to protect privacy.';
      } else {
        cleanFiles.push(file);
      }
    }

    setModerationErrors(newErrors);
    if (cleanFiles.length > 0) setPendingCropFiles(cleanFiles);
  } catch (err) {
    // If moderation itself errors, allow the files through (fail open)
    console.warn('Image moderation failed, allowing files:', err);
    setPendingCropFiles(dedupedNewFiles);
  } finally {
    setModerating(false);
  }
};
```

- [ ] **Step 3: Make `handleFileChange` and `handleDrop` await processFiles**

Find `handleFileChange` (around line 1640):

```js
const handleFileChange = (e) => {
  const files = Array.from(e.target.files);
  processFiles(files);
  e.target.value = '';
};
```

Replace with:

```js
const handleFileChange = async (e) => {
  const files = Array.from(e.target.files);
  await processFiles(files);
  e.target.value = '';
};
```

Find `handleDrop` (around line 1714). It calls `processFiles(files)` — add `await`:

```js
await processFiles(files);
```

- [ ] **Step 4: Add inline error display in the JSX**

Find the image upload area in the JSX (search for `moderating` won't exist yet — look for the file `<input>` near line 2165). After the file input element, add the moderation feedback block:

```jsx
{moderating && (
  <p style={{ color: '#6b7280', fontSize: '0.85rem', margin: '4px 0 0' }}>
    Checking images…
  </p>
)}
{Object.entries(moderationErrors).map(([filename, msg]) => (
  <p key={filename} style={{ color: '#dc2626', fontSize: '0.85rem', margin: '4px 0 0' }}>
    <strong>{filename}:</strong> {msg}
  </p>
))}
```

- [ ] **Step 5: Manual test**

Start the dev server: `cd flask-react-supabase-app/frontend && npm start`

1. Go to Post Car listing form
2. Upload a clean car photo → should pass to cropper as normal
3. Upload a photo with a visible face → should show red error message, NOT open cropper
4. Upload a photo with explicit nudity → should show red nudity error
5. Upload mixed batch (clean + blocked) → clean ones go to cropper, blocked ones show errors

- [ ] **Step 6: Commit**

```bash
git add flask-react-supabase-app/frontend/src/components/PostCar.js
git commit -m "feat(web): block NSFW/face images in PostCar before cropper"
```

---

### Task 4: Hook moderation into PostBike.js

**Files:**
- Modify: `flask-react-supabase-app/frontend/src/components/PostBike.js`

PostBike uses the same `setPendingCropFiles` pattern. The file handler is at line ~370 and ends with `setPendingCropFiles(validFiles)`.

- [ ] **Step 1: Add import and state**

At the top of `PostBike.js`, add:

```js
import { moderateImage } from '../utils/imageModeration';
```

Inside the component after existing `useState` declarations, add:

```js
const [moderationErrors, setModerationErrors] = useState({});
const [moderating, setModerating] = useState(false);
```

- [ ] **Step 2: Replace the file handler's `setPendingCropFiles(validFiles)` call**

Find the file change handler in PostBike.js. It validates files and ends with:

```js
if (!validFiles.length) return;
setError(null);
setPendingCropFiles(validFiles);
e.target.value = '';
```

Replace that block with:

```js
if (!validFiles.length) return;
setError(null);
setModerating(true);
setModerationErrors({});
e.target.value = '';

try {
  const results = await Promise.all(
    validFiles.map(file => moderateImage(file).then(r => ({ file, ...r })))
  );
  const newErrors = {};
  const cleanFiles = [];
  for (const { file, blocked, reasons } of results) {
    if (blocked) {
      newErrors[file.name] = reasons.includes('nudity')
        ? 'This photo was blocked — explicit content detected. Please use photos that show the vehicle only.'
        : 'This photo was blocked — a face was detected. Please use photos that show the vehicle only to protect privacy.';
    } else {
      cleanFiles.push(file);
    }
  }
  setModerationErrors(newErrors);
  if (cleanFiles.length > 0) setPendingCropFiles(cleanFiles);
} catch (err) {
  console.warn('Image moderation failed, allowing files:', err);
  setPendingCropFiles(validFiles);
} finally {
  setModerating(false);
}
```

Also make the handler function itself `async`:

```js
const handleFileChange = async (e) => {
```

- [ ] **Step 3: Add inline error display**

In the JSX, after the file input, add:

```jsx
{moderating && (
  <p style={{ color: '#6b7280', fontSize: '0.85rem', margin: '4px 0 0' }}>Checking images…</p>
)}
{Object.entries(moderationErrors).map(([filename, msg]) => (
  <p key={filename} style={{ color: '#dc2626', fontSize: '0.85rem', margin: '4px 0 0' }}>
    <strong>{filename}:</strong> {msg}
  </p>
))}
```

- [ ] **Step 4: Manual test**

On the Post Bike form, repeat the same three manual test cases as PostCar (clean / face / nudity).

- [ ] **Step 5: Commit**

```bash
git add flask-react-supabase-app/frontend/src/components/PostBike.js
git commit -m "feat(web): block NSFW/face images in PostBike before cropper"
```

---

### Task 5: Hook moderation into PostCarParts.js

**Files:**
- Modify: `flask-react-supabase-app/frontend/src/components/PostCarParts.js`

Identical pattern to PostBike. File handler ends with `setPendingCropFiles(validFiles)` at line ~338.

- [ ] **Step 1: Add import and state**

```js
import { moderateImage } from '../utils/imageModeration';
```

```js
const [moderationErrors, setModerationErrors] = useState({});
const [moderating, setModerating] = useState(false);
```

- [ ] **Step 2: Replace `setPendingCropFiles(validFiles)` block**

Find the end of the file handler where `setPendingCropFiles(validFiles)` is called and replace with the same async moderation block used in Task 4 (verbatim — same code, same error messages):

```js
if (!validFiles.length) return;
setError(null);
setModerating(true);
setModerationErrors({});
e.target.value = '';

try {
  const results = await Promise.all(
    validFiles.map(file => moderateImage(file).then(r => ({ file, ...r })))
  );
  const newErrors = {};
  const cleanFiles = [];
  for (const { file, blocked, reasons } of results) {
    if (blocked) {
      newErrors[file.name] = reasons.includes('nudity')
        ? 'This photo was blocked — explicit content detected. Please use photos that show the vehicle only.'
        : 'This photo was blocked — a face was detected. Please use photos that show the vehicle only to protect privacy.';
    } else {
      cleanFiles.push(file);
    }
  }
  setModerationErrors(newErrors);
  if (cleanFiles.length > 0) setPendingCropFiles(cleanFiles);
} catch (err) {
  console.warn('Image moderation failed, allowing files:', err);
  setPendingCropFiles(validFiles);
} finally {
  setModerating(false);
}
```

Make handler `async`:

```js
const handleFileChange = async (e) => {
```

- [ ] **Step 3: Add inline error display in JSX** (same markup as Task 4)

- [ ] **Step 4: Manual test** on Post Car Parts form — same three cases.

- [ ] **Step 5: Commit**

```bash
git add flask-react-supabase-app/frontend/src/components/PostCarParts.js
git commit -m "feat(web): block NSFW/face images in PostCarParts before cropper"
```

---

### Task 6: Hook moderation into PostPlate.js

**Files:**
- Modify: `flask-react-supabase-app/frontend/src/components/PostPlate.js`

PostPlate accepts JPG/PNG/WEBP/PDF. PDF files cannot be analyzed by TF.js image models — skip moderation for PDFs and only check images.

- [ ] **Step 1: Add import and state**

```js
import { moderateImage } from '../utils/imageModeration';
```

```js
const [moderationError, setModerationError] = useState(null);
const [moderating, setModerating] = useState(false);
```

- [ ] **Step 2: Add moderation in `handleProofFileChange`**

`handleProofFileChange` is already `async`. It starts by validating file type and size, then calls `setProofFile(file)` at line ~358 followed by `setIsUploadingProof(true)`. Insert moderation between the validation and `setProofFile`:

```js
// After the type/size validation checks and BEFORE setProofFile(file):
if (file.type !== 'application/pdf') {
  setModerating(true);
  setModerationError(null);
  try {
    const { blocked, reasons } = await moderateImage(file);
    if (blocked) {
      setModerationError(
        reasons.includes('nudity')
          ? 'This photo was blocked — explicit content detected. Please upload a valid proof of ownership document.'
          : 'This photo was blocked — a face was detected. Please upload a valid proof of ownership document.'
      );
      return;
    }
  } catch (err) {
    console.warn('Image moderation failed, allowing file:', err);
  } finally {
    setModerating(false);
  }
}
```

- [ ] **Step 3: Add error display in JSX**

Find the proof upload area (around line 572). Below the upload widget, add:

```jsx
{moderating && (
  <p style={{ color: '#6b7280', fontSize: '0.85rem', marginTop: 4 }}>Checking document…</p>
)}
{moderationError && (
  <p style={{ color: '#dc2626', fontSize: '0.85rem', marginTop: 4 }}>{moderationError}</p>
)}
```

- [ ] **Step 4: Manual test**

1. Upload a clean JPG as proof → upload proceeds normally
2. Upload a photo with a face → blocked, error shown, no upload
3. Upload a PDF → moderation skipped, upload proceeds normally

- [ ] **Step 5: Commit**

```bash
git add flask-react-supabase-app/frontend/src/components/PostPlate.js
git commit -m "feat(web): block NSFW/face images in PostPlate proof upload (skip PDFs)"
```

---

## Phase 2 — Mobile

### Task 7: Install mobile dependencies

**Files:**
- Modify: `flask-react-supabase-app/mobile/package.json`

- [ ] **Step 1: Install packages**

```bash
cd flask-react-supabase-app/mobile
npx expo install expo-gl
npm install @tensorflow/tfjs @tensorflow/tfjs-react-native @tensorflow-models/blazeface nsfwjs
```

- [ ] **Step 2: Verify tfjs-react-native resolves**

```bash
node -e "require('@tensorflow/tfjs-react-native'); console.log('ok')"
```

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add flask-react-supabase-app/mobile/package.json flask-react-supabase-app/mobile/package-lock.json
git commit -m "chore(mobile): add tfjs-react-native + expo-gl + nsfwjs + blazeface"
```

---

### Task 8: Create mobile imageModeration utility

**Files:**
- Create: `flask-react-supabase-app/mobile/src/utils/imageModeration.js`

Note: `@tensorflow/tfjs-react-native` must call `tf.ready()` once to register the RN backend before any model operations. Models load from CDN on first call and are cached by tfjs in the app's document directory automatically.

- [ ] **Step 1: Create the utility**

Create `flask-react-supabase-app/mobile/src/utils/imageModeration.js`:

```js
import * as tf from '@tensorflow/tfjs';
import { decodeJpeg } from '@tensorflow/tfjs-react-native';
import * as nsfwjs from 'nsfwjs';
import * as blazeface from '@tensorflow-models/blazeface';
import * as FileSystem from 'expo-file-system';

let nsfwModel = null;
let faceModel = null;
let tfReady = false;

async function ensureReady() {
  if (!tfReady) {
    await tf.ready();
    tfReady = true;
  }
  if (!nsfwModel || !faceModel) {
    [nsfwModel, faceModel] = await Promise.all([
      nsfwjs.load(),
      blazeface.load(),
    ]);
  }
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function uriToTensor(uri) {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const uint8 = base64ToUint8Array(base64);
  return decodeJpeg(uint8, 3);
}

/**
 * @param {string} uri — image URI from expo-image-picker
 * @returns {Promise<{ blocked: boolean, reasons: string[] }>}
 */
export async function moderateImage(uri) {
  await ensureReady();
  const tensor = await uriToTensor(uri);

  let predictions, faces;
  try {
    [predictions, faces] = await Promise.all([
      nsfwModel.classify(tensor),
      faceModel.estimateFaces(tensor, false),
    ]);
  } finally {
    tensor.dispose();
  }

  const reasons = [];

  const prob = Object.fromEntries(predictions.map(p => [p.className, p.probability]));
  if ((prob.Porn || 0) > 0.60) reasons.push('nudity');
  if ((prob.Hentai || 0) > 0.60) reasons.push('nudity');
  if ((prob.Sexy || 0) > 0.70) reasons.push('nudity');

  const faceDetected = faces.some(f => {
    const p = Array.isArray(f.probability) ? f.probability[0] : (f.probability ?? 1);
    return p > 0.75;
  });
  if (faceDetected) reasons.push('face');

  return { blocked: reasons.length > 0, reasons: [...new Set(reasons)] };
}
```

- [ ] **Step 2: Manual smoke test on simulator**

Temporarily add to any screen:

```js
import { moderateImage } from '../utils/imageModeration';
// In a useEffect or button press:
moderateImage('https://upload.wikimedia.org/wikipedia/commons/thumb/4/43/Cute_dog.jpg/1200px-Cute_dog.jpg')
  .then(r => console.log('moderation result:', r));
```

Expected console output: `moderation result: { blocked: false, reasons: [] }`

Remove the temporary test code after confirming.

- [ ] **Step 3: Commit**

```bash
git add flask-react-supabase-app/mobile/src/utils/imageModeration.js
git commit -m "feat(mobile): add imageModeration utility — tfjs-react-native + nsfwjs + blazeface"
```

---

### Task 9: Hook moderation into PostListingScreen.js

**Files:**
- Modify: `flask-react-supabase-app/mobile/src/screens/listing/PostListingScreen.js`

The `pickImages` function (line ~652) is async. It calls `ImagePicker.launchImageLibraryAsync`, gets one image URI, then calls `setCropperUri` and `setCropperVisible(true)`. Insert moderation after getting the URI and before setting the cropper.

- [ ] **Step 1: Add import and blocked state**

Near the top of `PostListingScreen.js`, add the import:

```js
import { moderateImage } from '../../utils/imageModeration';
```

Inside the component, near the other `useState` declarations (around line ~439), add:

```js
const [imageBlockedError, setImageBlockedError] = useState(null);
const [moderatingImage, setModeratingImage] = useState(false);
```

- [ ] **Step 2: Replace `pickImages` with moderation-aware version**

Find `pickImages` (around line 652) and replace the entire function:

```js
const pickImages = useCallback(async () => {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsMultipleSelection: false,
    selectionLimit: 1,
    quality: 0.7,
  });

  if (!result.canceled && result.assets && result.assets.length > 0) {
    const uri = result.assets[0].uri;
    setImageBlockedError(null);
    setModeratingImage(true);
    try {
      const { blocked, reasons } = await moderateImage(uri);
      if (blocked) {
        setImageBlockedError(
          reasons.includes('nudity')
            ? 'This photo was blocked — explicit content detected. Please use photos that show the vehicle only.'
            : 'This photo was blocked — a face was detected. Please use photos that show the vehicle only to protect privacy.'
        );
        return;
      }
      setCropperUri(uri);
      setCropperVisible(true);
    } catch (err) {
      console.warn('Image moderation failed, allowing image:', err);
      setCropperUri(uri);
      setCropperVisible(true);
    } finally {
      setModeratingImage(false);
    }
  }
}, [images.length]);
```

- [ ] **Step 3: Add feedback in the ImageSection / near the pick button**

Find the `ImageSection` usage (line ~1852 and others — it appears 4 times for each listing type). Below each `<ImageSection .../>` usage, add the moderation feedback. A clean way: add it once to the `ImageSection` component itself, or add it conditionally in the parent where `moderatingImage` / `imageBlockedError` are visible.

Add this wherever `ImageSection` is rendered (all four listing type sections in PostListingScreen.js):

```jsx
{moderatingImage && (
  <Text style={{ color: '#6b7280', fontSize: 13, marginTop: 4 }}>
    Checking image…
  </Text>
)}
{imageBlockedError && (
  <Text style={{ color: '#dc2626', fontSize: 13, marginTop: 4 }}>
    {imageBlockedError}
  </Text>
)}
```

- [ ] **Step 4: Manual test on iOS simulator and Android emulator**

1. Open Post Listing → any category
2. Tap image picker → select a clean car photo → should pass to cropper
3. Select a photo with a visible face → should show red error text, cropper does NOT open
4. Select a photo with nudity → should show nudity error
5. Select image that was previously blocked → error clears when picker reopens, new image checked fresh

- [ ] **Step 5: Commit**

```bash
git add flask-react-supabase-app/mobile/src/screens/listing/PostListingScreen.js
git commit -m "feat(mobile): block NSFW/face images in PostListingScreen before cropper"
```

---

## Phase 3 — End-to-End Test Checklist

### Task 10: End-to-end verification (web + mobile + VIN decoder)

No code in this task — structured test steps.

**Test images to use:**

| Category | Source | Expected |
|---|---|---|
| Clean car | Any car photo from your listings | `blocked: false` |
| Face | Any photo with a person's face visible | `blocked: true, reasons: ['face']` |
| NSFW | Use NSFWJS test images: `https://nsfwjs.com/` (their demo page lists sample URLs) | `blocked: true, reasons: ['nudity']` |

- [ ] **Web — PostCar end-to-end**

1. `cd flask-react-supabase-app/frontend && npm start`
2. Log in, go to Post Car
3. Upload clean car photo → passes to cropper → crop → submit → listing created ✓
4. Upload face photo → red error appears, cropper does not open, submit button not blocked ✓
5. Upload clean + face together → clean goes to cropper, face shows error ✓
6. Check Network tab → after first detection, no new model downloads on subsequent images ✓

- [ ] **Web — PostBike, PostCarParts, PostPlate**

Repeat the clean / face / NSFW cases on each form. PDF in PostPlate should skip detection.

- [ ] **Mobile — iOS simulator**

1. `cd flask-react-supabase-app/mobile && npx expo start`
2. Open on iOS simulator
3. Pick clean image → cropper opens ✓
4. Pick face image → "This photo was blocked — a face was detected" shown, cropper does NOT open ✓
5. Retry with clean image → error clears, cropper opens ✓

- [ ] **Mobile — Android emulator**

Same 3 cases as iOS.

- [ ] **VIN decoder end-to-end**

```bash
cd flask-react-supabase-app/backend
python3 -m pytest test_vin_decoder.py test_auto_review_vin_gate.py test_vin_integration.py -v
```

Expected: 20 passed, 2 skipped.

Then on the live web form:
1. Type `1HGCM82633A004352` → green "VIN format looks good." ✓
2. Type `1HGCM82633A004353` (bad checksum, US VIN) → red "Invalid VIN — check for typos" ✓
3. Type a UAE Toyota VIN starting with `J` (e.g. `JTMRJREV0HD090336`) → green (no checksum required) ✓
4. Type 16 chars → counter "1 characters remaining" shown ✓
5. Type 17 good chars → green ✓
6. Clear field → help text "Where to find it" shown ✓

- [ ] **Final push to GitHub**

```bash
git push origin main
```

---

## Thresholds Reference

| Check | Threshold | Reason |
|---|---|---|
| `Porn` | `> 0.60` | Explicit content |
| `Hentai` | `> 0.60` | Animated explicit content |
| `Sexy` | `> 0.70` | Partial nudity / suggestive (higher threshold to avoid false positives on swimwear shots) |
| Face confidence | `> 0.75` | Reduces false positives from partial faces in background |

## Fail-Open Policy

If `moderateImage()` throws (model load fails, network error, TF.js crash), **images are allowed through**. The server-side `NullVisionProvider` will then route the listing to human review as a safety net. Never block a user from uploading because our moderation infrastructure is down.
