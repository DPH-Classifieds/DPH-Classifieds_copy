# Image Moderation — Client-Side NSFW & Face Detection

**Date:** 2026-07-07
**Status:** Approved — ready for implementation

---

## Goal

Hard-block listing image uploads that contain nudity or visible faces before they reach the cropper or Supabase storage. Works on both web (React) and mobile (React Native / Expo). No server-side API calls — TensorFlow.js models run entirely on the user's device.

---

## Libraries

| Package | Purpose | Platform |
|---|---|---|
| `nsfwjs` | 5-class nudity classifier (neutral/porn/sexy/hentai/drawing) | Web + Mobile |
| `@tensorflow-models/blazeface` | Face bounding-box detection | Web + Mobile |
| `@tensorflow/tfjs` | TF.js core | Web |
| `@tensorflow/tfjs-backend-webgl` | GPU backend | Web |
| `@tensorflow/tfjs-react-native` | RN bridge | Mobile |
| `expo-gl` | Required by tfjs-react-native | Mobile |

Model sizes: NSFW ~8 MB, BlazeFace ~1 MB. Both cached after first download (IndexedDB on web, app document directory on mobile).

---

## Architecture

### Shared interface

Both platforms expose:

```js
// Returns { blocked: boolean, reasons: string[] }
// reasons: [] | ['nudity'] | ['face'] | ['nudity', 'face']
moderateImage(imageSource)
```

- **Web implementation:** `frontend/src/utils/imageModeration.js` — accepts `File | Blob | HTMLImageElement`
- **Mobile implementation:** `mobile/src/utils/imageModeration.js` — accepts image URI string

Each file holds a module-level singleton for loaded models (load once, reuse). Models load lazily on first call.

### Hook point — Web

In each form component's file-selection handler, after MIME/size validation and **before** passing to `UnifiedCropper`:

- `PostCar.js`
- `PostBike.js`
- `PostCarParts.js`
- `PostPlate.js`

A blocked image is never added to the image queue and never reaches the cropper.

### Hook point — Mobile

In `PostListingScreen.js`, after `ImagePicker.launchImageLibraryAsync()` returns, before updating image state.

---

## Detection Logic

Both checks run concurrently per image (`Promise.all`).

**NSFW (nsfwjs):**
- Block if `porn > 0.60`
- Block if `hentai > 0.60`
- Block if `sexy > 0.70`

**Face (BlazeFace):**
- Block if any detected face has confidence `> 0.75`

---

## UX States

| State | Web | Mobile |
|---|---|---|
| Detecting | Spinner overlay on thumbnail, submit disabled | Inline "Checking…" text below picker |
| Nudity blocked | Red inline error below image slot: "This photo was blocked — explicit content detected. Please use photos that show the vehicle only." | Same copy as inline text |
| Face blocked | Red inline error: "This photo was blocked — a face was detected. Please use photos that show the vehicle only to protect privacy." | Same copy inline |
| Multiple images — mixed | Clean images proceed to cropper; each blocked image shows its own error inline | Same |
| Clean | No change — image passes to cropper as normal | Image added to state as normal |

No modals. Errors are inline and per-image.

---

## Performance

- Models load once per session; subsequent detections skip loading (~50–200ms per image after warm-up)
- First-ever load: ~2–3s on good connection, models cached after that
- Run detections in parallel when multiple images are selected simultaneously
- Mobile low-end devices: detection may take 2–5s — "Checking…" state must be visible

---

## Out of Scope (this iteration)

- Server-side verification (backend `GoogleVisionProvider` stub remains for later)
- Auto-blurring faces
- Admin bypass flags
- Model version update mechanism

---

## Testing Plan

1. **Unit — detection util (web):** known clean car image → `blocked: false`; test NSFW image → `blocked: true, reasons: ['nudity']`; test face image → `blocked: true, reasons: ['face']`
2. **Integration — web form:** select clean image → reaches cropper; select face image → inline error, cropper not opened
3. **Integration — multiple images:** mixed batch → clean ones proceed, blocked ones show individual errors
4. **Model caching:** reload page, select image → no second model download (check Network tab)
5. **Mobile emulator (iOS + Android):** same three cases as web integration tests
6. **End-to-end:** clean image → upload completes → listing submits successfully

---

## Files Changed

**New:**
- `frontend/src/utils/imageModeration.js`
- `mobile/src/utils/imageModeration.js`

**Modified:**
- `frontend/src/components/PostCar.js`
- `frontend/src/components/PostBike.js`
- `frontend/src/components/PostCarParts.js`
- `frontend/src/components/PostPlate.js`
- `mobile/src/screens/listing/PostListingScreen.js`
- `package.json` (frontend)
- `mobile/package.json`
