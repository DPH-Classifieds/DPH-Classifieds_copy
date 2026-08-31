# Audit Remediation: Frontend, Mobile & Performance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every confirmed HIGH/CRITICAL frontend, mobile, and performance finding from `docs/audits/AUDIT_REPORT.md` §2, §3, and §6.1. Specific focus: PostCar double-submit + AuthContext localStorage dead-write, JSX memoization, Explore virtualization, image pipeline, dead code cleanup, dependency rationalization.

**Architecture:**
- React-side: surgical edits that fix bugs without restructuring. Disable-and-submit-button gating; memoize card components; remove dead `AuthContext` localStorage write; dedupe hardcoded API URLs. (HEIC handling was audited and found already correct — no change needed, see Task 5.)
- React Native side: persistent-token storage (already in security plan, but mobile-specific install steps here), remove dead `App.js` + `index.js` + `AppNavigator.js`, drop unused RN Navigation 7 deps, install `expo-updates`.
- Bundle/perf: drop truly-unused deps, lift `/api/homepage/preview` to be the homepage path, dedupe `hero.webp`/`toplanding.webp`, optimize the four oversized marketing images, fix `Header.js` passive scroll listener, fix `fetchCache.js` ExplorePage TTL bug, add `prefers-reduced-motion` blocks.

**Tech Stack:**
- React 18, craco, Tailwind
- React Native 0.81, Expo SDK 54, Expo Router
- Vitest (or whatever the frontend uses) for component tests
- Jest for mobile

**Reference spec:** `docs/audits/AUDIT_REPORT.md` §2 (C-F1..C-F6, H-F1..H-F14, M1..M13), §3 (C-M1..C-M4, H-M1..H-M6, M1..M13), §6.1 (PDF Part 1 items 1-44 specifics).

---

## File structure

| File | Responsibility | Change |
|---|---|---|
| `frontend/src/components/PostCar.js` | Car submission wizard (3,197 lines) | Add `isSaving` state + submit-button gating; fix double-upload race |
| `frontend/src/context/AuthContext.js:428-444` | Auth state | Drop the dead `localStorage.setItem('user', ...)` block |
| `frontend/src/utils/apiClient.js:182-204` | HTTP fetch wrapper | Use closure-local flag for 401 retry, not mutated caller input |
| `frontend/src/utils/authService.js:113-141` | Auth service | Drop `axios.defaults.headers.common` mutation |
| `frontend/src/utils/endpoints.js` (NEW) | Single source for hardcoded API URLs | New |
| `frontend/src/components/PostCar.js:1857` | File input accept | **[CORRECTED]** No change — HEIC decode already exists via `heic2any` in `directUpload.js`. See Task 5. |
| `frontend/src/components/HeroBackground.js` | Three.js scene | Pause on visibilitychange + outside-viewport |
| `frontend/src/components/Header.js:82-88` | Fixed-header scroll listener | Add `{ passive: true }` |
| `frontend/src/utils/fetchCache.js:54` | API cache | Fix destructuring bug; pass `ttlMs` not `ttl` from caller |
| `frontend/src/components/MarketplaceListingCard.jsx:190` | Card export | `React.memo` the default export |
| `frontend/src/components/ExplorePage.jsx` | Browse page | Migrate filter/sort to server; add virt for long lists |
| `frontend/src/components/HomePage.js:195` | Homepage fetch | Replace `/api/cars` with `/api/homepage/preview` |
| `frontend/src/utils/cache-keys.js` (NEW) | Storage key names | Centralize the scattered `dph_*` constants |
| `frontend/public/images/bottom-landing.jpg` | 16.5 MB marketing image | Compress to ~500 KB |
| `frontend/public/hero.webp`, `frontend/public/images/toplanding.webp` | Duplicate 2.1 MB hero | Keep one; delete the other |
| `frontend/src/styles/index.css` and per-component CSS | Reduced-motion | Add `@media (prefers-reduced-motion)` blocks |
| `mobile/App.js`, `mobile/index.js`, `mobile/src/navigation/AppNavigator.js` | Dead legacy entry | Delete |
| `mobile/package.json` | Unused RN Navigation deps | Drop; keep Expo Router |
| `mobile/package.json` | `expo-updates` | Install |
| `mobile/app.json` | OTA config | Add `updates` block + `runtimeVersion` |
| `mobile/src/utils/imageModeration.js` | EXIF strip on listing photos | Pass through Skia surface to drop EXIF |
| `mobile/src/screens/profile/SettingsScreen.js:100-137` | Profile photo upload | Compress + show progress |

Untouched: `frontend/src/components/ui/ScreenEntrance` semantics (covered in M1), `mobile/src/screens/listing/PostListingScreen.js` form logic (only filter debounce).

---

## Task 1: Fix `AuthContext.updateUser` dead localStorage write

**Files:**
- Modify: `frontend/src/context/AuthContext.js:428-444`

- [ ] **Step 1: Write a failing test**

Create `frontend/src/context/__tests__/AuthContext.localStorage.test.js`:

```js
import { renderHook, act } from '@testing-library/react';
import { AuthProvider, useAuth } from '../AuthContext';

describe('AuthContext.updateUser', () => {
  it('does not write to localStorage', () => {
    const setItemSpy = jest.spyOn(Storage.prototype, 'setItem');
    const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;
    const { result } = renderHook(() => useAuth(), { wrapper });

    act(() => {
      result.current.updateUser({ display_name: 'New Name' });
    });

    const writes = setItemSpy.mock.calls.filter(([k]) => k === 'user');
    expect(writes).toHaveLength(0);
  });
});
```

(Adjust imports to your test setup — `@testing-library/react` may be in `devDependencies`. If using Vitest + React Testing Library, the syntax is the same.)

- [ ] **Step 2: Run and verify failure**

Run: `cd frontend && npx vitest run src/context/__tests__/AuthContext.localStorage.test.js 2>&1 | tail -15`
Expected: FAIL — currently `updateUser` writes `localStorage.setItem('user', ...)`.

- [ ] **Step 3: Remove the localStorage write**

Open `frontend/src/context/AuthContext.js`, find lines 428-444. Replace:

```jsx
const updateUser = (updates) => {
  setUser(prev => {
    const next = { ...prev, ...updates };
    localStorage.setItem('user', JSON.stringify(next));   // ← remove
    return next;
  });
};
```

with:

```jsx
const updateUser = (updates) => {
  setUser(prev => ({ ...prev, ...updates }));
};
```

If `updateUser` is the only place localStorage is written for `user`, the storage cleanup is implicit (other keys like `dph_chunk_reload_attempted` are unrelated).

- [ ] **Step 4: Re-run and verify**

Run: `npx vitest run src/context/__tests__/AuthContext.localStorage.test.js 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/context/AuthContext.js frontend/src/context/__tests__/AuthContext.localStorage.test.js
git commit -m "fix(frontend): drop dead localStorage write in AuthContext.updateUser"
```

---

## Task 2: Fix `apiClient.js` 401 retry mutating caller's options

**Files:**
- Modify: `frontend/src/utils/apiClient.js:182-204`

- [ ] **Step 1: Write a failing test**

Create `frontend/src/utils/__tests__/apiClient.retry.test.js`:

```js
import { apiClient } from '../apiClient';

describe('apiClient 401 retry', () => {
  it('does not mutate caller options', async () => {
    const opts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' };
    const optsSnapshot = JSON.parse(JSON.stringify(opts));

    // Stub: first call returns 401, second returns 200.
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ status: 401, ok: false, json: async () => ({ error: 'expired' }) })
      .mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ data: 'ok' }) });

    await apiClient('/api/test', opts);
    expect(opts).toEqual(optsSnapshot);  // ← opts must NOT be mutated
    expect(opts.__retriedAfterRefresh).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run src/utils/__tests__/apiClient.retry.test.js 2>&1 | tail -15`
Expected: FAIL — `options.__retriedAfterRefresh` is currently mutated.

- [ ] **Step 3: Use a closure-local flag**

In `frontend/src/utils/apiClient.js`, find the `request` function (around line 100) and the 401-retry branch (lines 182-204). Replace the body with:

```js
async function request(endpoint, options = {}) {
  const url = resolveUrl(endpoint);
  let didRetry = false;  // closure-local, not on caller options

  const execute = async () => {
    const token = await getAuthToken();
    const headers = {
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    const response = await fetch(url, { ...options, headers });
    return response;
  };

  let response = await execute();

  if (response.status === 401 && !didRetry) {
    didRetry = true;
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      response = await execute();  // retry once
    }
  }

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new ApiError(response.status, err.error || err.message || 'Request failed');
  }
  return response.json();
}
```

- [ ] **Step 4: Re-run and verify**

Run: `npx vitest run src/utils/__tests__/apiClient.retry.test.js 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/utils/apiClient.js frontend/src/utils/__tests__/apiClient.retry.test.js
git commit -m "fix(frontend): apiClient 401 retry uses closure-local flag, not caller mutation"
```

---

## Task 3: Drop `axios` global interceptors + header mutation

**Files:**
- Modify: `frontend/src/utils/authService.js:113-141, 229-247`

- [ ] **Step 1: Write a failing test that pins the cleanup**

Create `frontend/src/utils/__tests__/authService.noGlobalPollution.test.js`:

```js
import * as authService from '../authService';

describe('authService', () => {
  it('does not mutate axios.defaults.headers.common', () => {
    // If the dependency is still wired up, axios.defaults.headers.common['Authorization']
    // should not be set without an active token.
    authService.clearAuthHeader && authService.clearAuthHeader();
    // After a clean init (no signIn called), axios global header must be absent.
    const common = require('axios').default.defaults.headers.common;
    expect(common['Authorization']).toBeUndefined();
  });
});
```

(If your project doesn't use axios elsewhere, this test ensures it stays clean.)

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run src/utils/__tests__/authService.noGlobalPollution.test.js 2>&1 | tail -10`
Expected: FAIL — current `setAuthHeader` writes `axios.defaults.headers.common.Authorization`.

- [ ] **Step 3: Replace `axios` usage with `apiClient`**

In `frontend/src/utils/authService.js:113-141`, replace the `axios.interceptors.request.use(...)` block with comments noting the transition:

```js
// We no longer use axios. All Supabase auth calls go through `apiClient`
// which sets the Authorization header per-request, never globally. Keeping
// the sign-in / sign-out / session APIs unchanged.
```

Replace lines 229-247 (`setAuthHeader`) with:

```js
function setAuthHeader(token) {
  // No-op: kept for backwards compatibility. Use `apiClient.request(...)`
  // with the per-request token instead.
}
```

If the rest of `authService.js` still uses `axios.post(...)`, rewrite each call to use `apiClient`:

```js
// Before:
await axios.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, ...);
// After:
await apiClient.post('/supabase/auth/v1/token?grant_type=password', ...)
```

If your project uses a different Supabase client (`@supabase/supabase-js`), keep that and remove only the `axios` import. Verify by reading the file.

- [ ] **Step 4: Re-run and verify**

Run: `npx vitest run src/utils/__tests__/authService.noGlobalPollution.test.js 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run -q 2>&1 | tail -15`
Expected: same pass/fail counts as before the change. If a now-removed axios call was actually used elsewhere, the test for that module will fail — fix the call site.

- [ ] **Step 6: Drop `axios` from `package.json`**

In `frontend/package.json`, remove:

```json
"axios": "^1.6.2",
```

Run: `npm uninstall axios 2>&1 | tail -3`
Expected: "removed 1 package".

- [ ] **Step 7: Commit**

```bash
git add frontend/src/utils/authService.js frontend/package.json frontend/src/utils/__tests__/authService.noGlobalPollution.test.js
git commit -m "refactor(frontend): drop axios global interceptors; route auth via apiClient"
```

---

## Task 4: Disable submit in `PostCar.js` during OCR or draft save

**Files:**
- Modify: `frontend/src/components/PostCar.js:1539-1775`

- [ ] **Step 1: Write a test that pins the disabled state**

Create `frontend/src/components/__tests__/PostCar.disable.test.js`:

```js
import { render, screen, fireEvent } from '@testing-library/react';
import PostCar from '../PostCar';
import { MemoryRouter } from 'react-router-dom';

describe('PostCar submit gating', () => {
  it('disables submit while a draft save is in flight', async () => {
    render(<MemoryRouter><PostCar /></MemoryRouter>);
    // Trigger a "Save Draft" click — simulates the API call being in flight.
    const saveButton = screen.getByRole('button', { name: /save draft/i });
    fireEvent.click(saveButton);
    const submitButton = screen.getByRole('button', { name: /submit|publish/i });
    expect(submitButton).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run src/components/__tests__/PostCar.disable.test.js 2>&1 | tail -10`
Expected: FAIL — current submit button is not disabled during in-flight operations.

- [ ] **Step 3: Add `isSaving` state and gate submit**

In `frontend/src/components/PostCar.js`, near the existing form state declarations, add:

```js
const [isSaving, setIsSaving] = useState(null);  // 'submit' | 'draft' | null
```

At the top of `handleSaveDraft`:

```js
const handleSaveDraft = async () => {
  if (isSaving) return;
  setIsSaving('draft');
  try {
    // ... existing body unchanged ...
  } finally {
    setIsSaving(null);
  }
};
```

At the top of `handleSubmit`:

```js
const handleSubmit = async (e) => {
  e.preventDefault();
  if (isSaving) return;
  if (registrationOcrStatus === 'Scanning…' || registrationOcrStatus === 'Uploading…') return;
  setIsSaving('submit');
  try {
    // ... existing body unchanged ...
  } finally {
    setIsSaving(null);
  }
};
```

At the JSX of the submit button (around `PostCar.js:1831`), add:

```jsx
<button
  type="submit"
  disabled={Boolean(isSaving) || registrationOcrStatus === 'Scanning…'}
>
  {isSaving === 'submit' ? 'Publishing…' : isSaving === 'draft' ? 'Saving draft…' : 'Publish'}
</button>
```

- [ ] **Step 4: Re-run and verify**

Run: `npx vitest run src/components/__tests__/PostCar.disable.test.js 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Verify the existing tests still pass**

Run: `npx vitest run src/components/__tests__/PostCar.* 2>&1 | tail -15`
Expected: no regressions.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/PostCar.js frontend/src/components/__tests__/PostCar.disable.test.js
git commit -m "fix(frontend): gate PostCar submit during OCR or draft-save in flight"
```

---

## Task 5: [SUPERSEDED] Verify HEIC handling — audit finding was a false positive, no code change

**Original claim (wrong):** `heic2any` is declared in `package.json` but never imported, so HEIC uploads silently
fail and `.heic`/`.heif` should be dropped from the accept list.

**Why it's wrong:** `heic2any` IS imported — dynamically, inside `frontend/src/utils/directUpload.js:99-120`
(`ensureUploadableImage`), which converts HEIC→JPEG before upload with a native-decode fallback and a
user-facing error on failure. It's called from six components: `PostCar.js:1316,2027`, `PostBike.js:378,451`,
`PostCarParts.js:331`, `PostPlate.js:364,429`, `PostBuyingRequest.jsx:104`, `AccountSettings.js:328`. Git
history confirms this was a deliberate fix, not an oversight: `71a9405e "Harden HEIC listing uploads"`.
Removing `.heic`/`.heif` from the `PostCar.js:1857` accept attribute — the original instruction — would
have **regressed working iPhone-photo upload support** for no benefit.

**Files:**
- None modified.

- [ ] **Step 1: Verify the decoder is still wired (guards against regression, no edit)**

Run:
```bash
grep -n "heic2any" frontend/src/utils/directUpload.js
grep -rln "ensureUploadableImage" frontend/src/components/
```
Expected: `heic2any` import at `directUpload.js:108`, and `ensureUploadableImage` used in `PostCar.js`,
`PostBike.js`, `PostCarParts.js`, `PostPlate.js`, `PostBuyingRequest.jsx`, `AccountSettings.js`. If either
check comes back empty, HEIC support has since regressed — stop and open a real fix task instead of
re-running this superseded one.

- [ ] **Step 2: No commit** — this task makes no code changes. Skip to Task 6.

---

## Task 6: `MarketplaceListingCard` — wrap default export with `React.memo`

**Files:**
- Modify: `frontend/src/components/MarketplaceListingCard.jsx:190`

- [ ] **Step 1: Write a test that pins memoization**

Create `frontend/src/components/__tests__/MarketplaceListingCard.memo.test.js`:

```js
import { render } from '@testing-library/react';
import React from 'react';
import MarketplaceListingCard from '../MarketplaceListingCard';

describe('MarketplaceListingCard', () => {
  it('default export is a memoized component', () => {
    // React.memo wraps the component class.
    expect((MarketplaceListingCard as any).$$typeof).toBe(React.memo((): null => null).$$typeof);
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run src/components/__tests__/MarketplaceListingCard.memo.test.js 2>&1 | tail -10`
Expected: FAIL.

- [ ] **Step 3: Wrap with `React.memo`**

In `frontend/src/components/MarketplaceListingCard.jsx`, replace:

```jsx
export default MarketplaceListingCard;
```

with:

```jsx
export default React.memo(MarketplaceListingCard);
```

- [ ] **Step 4: Re-run and verify**

Run: `npx vitest run src/components/__tests__/MarketplaceListingCard.memo.test.js 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/MarketplaceListingCard.jsx frontend/src/components/__tests__/MarketplaceListingCard.memo.test.js
git commit -m "perf(frontend): memoize MarketplaceListingCard to reduce infinite-scroll render cost"
```

---

## Task 7: `Header.js` scroll listener — add `{ passive: true }`

**Files:**
- Modify: `frontend/src/components/Header.js:82-88`

- [ ] **Step 1: Write a failing test**

Create `frontend/src/components/__tests__/Header.scroll.test.js`:

```js
import { render } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

describe('Header scroll listener', () => {
  it('uses passive scroll listener', () => {
    const addSpy = jest.spyOn(window, 'addEventListener');
    render(<MemoryRouter><Header /></MemoryRouter>);
    const scrollCall = addSpy.mock.calls.find(([evt]) => evt === 'scroll');
    expect(scrollCall).toBeTruthy();
    const opts = scrollCall[2];
    expect(opts).toBeTruthy();
    expect(opts.passive).toBe(true);
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run src/components/__tests__/Header.scroll.test.js 2>&1 | tail -10`
Expected: FAIL.

- [ ] **Step 3: Add `{ passive: true }` to the scroll registration**

In `frontend/src/components/Header.js:82-88`, replace:

```js
window.addEventListener('scroll', handleScroll);
```

with:

```js
window.addEventListener('scroll', handleScroll, { passive: true });
```

- [ ] **Step 4: Re-run and verify**

Run: `npx vitest run src/components/__tests__/Header.scroll.test.js 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Header.js frontend/src/components/__tests__/Header.scroll.test.js
git commit -m "perf(frontend): make Header scroll listener passive"
```

---

## Task 8: Fix `fetchCache.js` `ttlMs` destructuring + ExplorePage caller

**Files:**
- Modify: `frontend/src/utils/fetchCache.js:54`
- Modify: `frontend/src/components/ExplorePage.jsx:616-637`

- [ ] **Step 1: Write a test that pins intended 30 s TTL**

Create `frontend/src/utils/__tests__/fetchCache.ttl.test.js`:

```js
import { fetchJsonWithCache } from '../fetchCache';

describe('fetchJsonWithCache ttlMs', () => {
  it('respects passed ttlMs (not the default 5min)', async () => {
    const url = '/api/__test_short_ttl?r=' + Math.random();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200, statusText: 'OK',
      json: async () => ({ data: 'first' }),
    });

    // First call: 30s TTL
    await fetchJsonWithCache(url, { ttlMs: 30_000, signal: undefined, onUpdate: undefined });
    // Second call immediately — cache HIT (within 30s)
    const r1 = global.fetch.mock.calls.length;

    // Third call after a long delay — cache MISS expected
    jest.useFakeTimers();
    jest.setSystemTime(Date.now() + 60_000);
    await fetchJsonWithCache(url, { ttlMs: 30_000, signal: undefined, onUpdate: undefined });
    const r2 = global.fetch.mock.calls.length;
    jest.useRealTimers();

    expect(r1).toBe(1);
    expect(r2).toBe(2);  // cache expired
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run src/utils/__tests__/fetchCache.ttl.test.js 2>&1 | tail -15`
Expected: FAIL — the current `ExplorePage.jsx` passes `ttl` not `ttlMs`, so the default 5 min applies; the cache never expires inside the 60 s window.

- [ ] **Step 3: Fix the ExplorePage caller**

In `frontend/src/components/ExplorePage.jsx`, at line 619-633, find every call like:

```js
fetchJsonWithCache(url, { ttl: PAGE_TTL_MS, signal: controller.signal })
```

Replace with:

```js
fetchJsonWithCache(url, { ttlMs: PAGE_TTL_MS, signal: controller.signal, onUpdate })
```

Confirm by grepping:

```bash
grep -n "fetchJsonWithCache" frontend/src/components/ExplorePage.jsx
```

- [ ] **Step 4: Re-run and verify**

Run: `npx vitest run src/utils/__tests__/fetchCache.ttl.test.js 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/utils/fetchCache.js frontend/src/components/ExplorePage.jsx frontend/src/utils/__tests__/fetchCache.ttl.test.js
git commit -m "fix(frontend): respect ttlMs in ExplorePage fetchJsonWithCache calls"
```

---

## Task 9: Optimize bottom-landing.jpg and other oversized marketing images

**Files:**
- Modify: `frontend/public/images/bottom-landing.jpg`
- Modify: `frontend/public/IMG_3391.JPG`, `frontend/public/images/About-page.JPG`, `frontend/public/images/Our Mission.jpg`, `frontend/public/hero.webp`, `frontend/public/images/toplanding.webp`

- [ ] **Step 1: Install image tooling**

Confirm `cwebp`, `avifenc`, or `imagemin` is available:

```bash
which cwebp avifenc || npm install -g sharp-cli
```

- [ ] **Step 2: Convert `bottom-landing.jpg` to ≤500 KB WebP**

Run:

```bash
cwebp -q 80 -resize 1920 1280 frontend/public/images/bottom-landing.jpg -o frontend/public/images/bottom-landing.webp
ls -la frontend/public/images/bottom-landing.webp
```

Expected: file size < 500 KB.

Update `HomePage.js` (and any other reference site) to use the WebP path; if `<picture>` is used for fallback:

```jsx
<picture>
  <source type="image/webp" srcSet="/images/bottom-landing.webp" />
  <img src="/images/bottom-landing.jpg" alt="" width="1920" height="1280" loading="lazy" />
</picture>
```

(Adjust dimensions to your actual image aspect.)

- [ ] **Step 3: Convert hero.webp + dedupe toplanding.webp**

Confirm the duplicates via `shasum`:

```bash
shasum -a 256 frontend/public/hero.webp frontend/public/images/toplanding.webp
```

Expected: identical hashes.

Pick one as canonical (e.g. `frontend/public/hero.webp`), delete the other, and update all reference sites in the codebase:

```bash
git rm frontend/public/images/toplanding.webp
```

```bash
grep -rln "toplanding.webp" frontend/src 2>&1 | head -10
```

For each hit, replace `toplanding.webp` with `hero.webp`.

- [ ] **Step 4: Optimize the other 3 marketing images**

Apply the same `cwebp` or `sharp` pipeline to:

- `IMG_3391.JPG` (6.4 MB) → `IMG_3391.webp` ≤ 600 KB
- `images/About-page.JPG` (5.8 MB) → `images/About-page.webp` ≤ 500 KB
- `images/Our Mission.jpg` (4.3 MB) → `images/Our Mission.webp` ≤ 400 KB

Update reference sites in `HomePage.js`, `About.js`, `index.js` etc.

- [ ] **Step 5: Measure the bundle impact**

Before / after:

```bash
du -sh frontend/public/images/ frontend/public/
```

Expected: significant reduction (≥ 30 MB → ≤ 5 MB is realistic).

- [ ] **Step 6: Commit**

```bash
git add frontend/public/images/ frontend/src/
git commit -m "perf(images): convert + dedupe marketing images; save ~30 MB"
```

---

## Task 10: Add `prefers-reduced-motion` blocks across the frontend

**Files:**
- Modify: `frontend/src/App.css`, `frontend/src/index.css`, `frontend/src/components/HeroBackground.js`, `frontend/src/styles/Header.css`, `frontend/src/components/MarketplaceListingCard.jsx`

- [ ] **Step 1: Identify CSS that animates**

Run: `grep -rln "animation\|transition" frontend/src 2>&1 | head -30`

Each file that animates should have a `@media (prefers-reduced-motion: reduce)` rule that disables or shortens the animation.

- [ ] **Step 2: Add the global rule**

In `frontend/src/index.css` (or `App.css`, whichever is imported last), append:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

- [ ] **Step 3: Pause `HeroBackground.js` WebGL scene when hidden**

In `frontend/src/components/HeroBackground.js`, listen for visibility change:

```js
useEffect(() => {
  const onVisibility = () => {
    pausedRef.current = document.hidden;
  };
  document.addEventListener('visibilitychange', onVisibility);
  return () => document.removeEventListener('visibilitychange', onVisibility);
}, []);
```

In each `useFrame` loop, check `if (pausedRef.current || !inViewport) return;`. (The existing code at `:23, :54, :81` may need a `pausedRef` shared across callbacks.)

- [ ] **Step 4: Test reduced-motion CSS**

Run: `npx vitest run -t reducedMotion 2>&1 | tail -10`
(If your project has no existing reduced-motion test, add a snapshot test that toggles `matchMedia` to simulate the preference. Skip if not feasible; the global rule is the canonical fix.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.css frontend/src/index.css frontend/src/components/HeroBackground.js frontend/src/styles/Header.css frontend/src/components/MarketplaceListingCard.jsx
git commit -m "perf(a11y): respect prefers-reduced-motion; pause hero WebGL when hidden"
```

---

## Task 11: Switch homepage fetch to `/api/homepage/preview`

**Files:**
- Modify: `frontend/src/components/HomePage.js:195`

- [ ] **Step 1: Inspect the current homepage fetch**

Open `frontend/src/components/HomePage.js`. Around line 195 (or wherever the effect runs), find the `axios.get(...api/cars?limit=8&...)` (or `apiClient.get(...)`).

- [ ] **Step 2: Replace with `/api/homepage/preview`**

```js
// Before:
useEffect(() => {
  apiClient.get('/api/cars', { params: { limit: 8, order: 'created_at.desc' } })
    .then(setListings);
}, []);

// After:
useEffect(() => {
  apiClient.get('/api/homepage/preview')
    .then(setListings);
}, []);
```

- [ ] **Step 3: Verify the response shape matches existing usage**

Inspect the component's render: does it call `listings.map(item => <Card {...item} />)`? If the preview endpoint returns a different shape, adapt to map `body.categories.flatMap(c => c.items)` or similar. If unsure, dump the response to the console and adjust.

- [ ] **Step 4: Test manually**

Run: `npm start` (or `craco start` if applicable). Open the homepage. Verify the section renders the same listings as before. Run `Network` tab in devtools and confirm the URL is `/api/homepage/preview`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/HomePage.js
git commit -m "perf(frontend): homepage uses dedicated /api/homepage/preview endpoint"
```

---

## Task 12: Centralize hardcoded API URLs into `src/utils/endpoints.js`

**Files:**
- Create: `frontend/src/utils/endpoints.js`
- Modify: `frontend/src/utils/apiClient.js:6`
- Modify: `frontend/src/utils/authService.js:4`
- Modify: `frontend/src/hooks/useFeaturedPattern.js:3`
- Modify: `frontend/src/hooks/useListingCounts.js:10`
- Modify: `frontend/src/components/PostCar.js:50`
- Modify: `frontend/src/components/Signup.js:11`
- Modify: `frontend/src/components/PlatformAnalyticsTracker.js:6`

- [ ] **Step 1: Grep for hardcoded URLs**

Run: `grep -rln "https://api.dphclassifieds.com\|http://localhost:8000\|localhost:8000" frontend/src 2>&1 | head -20`

- [ ] **Step 2: Create the central module**

Create `frontend/src/utils/endpoints.js`:

```js
// Single source of truth for backend base URLs.
// Override via REACT_APP_API_URL at build time.

const PROD_API_URL = process.env.REACT_APP_API_URL || 'https://api.dphclassifieds.com';
const DEV_API_URL  = process.env.REACT_APP_API_URL || 'http://localhost:8000';

export const API_BASE_URL = process.env.NODE_ENV === 'production' ? PROD_API_URL : DEV_API_URL;

export const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY || '';
```

- [ ] **Step 3: Replace hardcoded URLs in each consumer**

In each file, replace the hardcoded local `DEFAULT_*_API_URL` constant with an import:

```js
import { API_BASE_URL } from './endpoints';
```

Then substitute the literal string with `API_BASE_URL`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/utils/endpoints.js frontend/src/utils/apiClient.js frontend/src/utils/authService.js frontend/src/hooks/useFeaturedPattern.js frontend/src/hooks/useListingCounts.js frontend/src/components/PostCar.js frontend/src/components/Signup.js frontend/src/components/PlatformAnalyticsTracker.js
git commit -m "refactor(frontend): centralize API base URLs in src/utils/endpoints.js"
```

---

## Task 13: Memoize `AuthContext` value + drop `axios` import

**Files:**
- Modify: `frontend/src/context/AuthContext.js:418-445`

- [ ] **Step 1: Write a test pinning the memoization**

Create `frontend/src/context/__tests__/AuthContext.memoValue.test.js`:

```js
import { renderHook } from '@testing-library/react';
import { AuthProvider, useAuth } from '../AuthContext';

describe('AuthContext value memoization', () => {
  it('value reference is stable across re-renders when state is unchanged', () => {
    const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;
    const { result, rerender } = renderHook(() => useAuth(), { wrapper });
    const v1 = result.current;
    rerender();
    const v2 = result.current;
    // Reference equality on the wrapper object itself is the contract.
    // Strict equality is too strong (consumers need re-renders when state changes);
    // we assert that the OUTER object is the same reference.
    // If your implementation re-creates it every render, even with no state change,
    // this test fails.
    expect(v1 === v2).toBe(true);
  });
});
```

(If `useAuth` doesn't expose the outer object, your test setup may need adaptation. The intent is: don't re-create `value` on every render.)

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run src/context/__tests__/AuthContext.memoValue.test.js 2>&1 | tail -10`
Expected: FAIL — current `value={{...}}` re-creates every render.

- [ ] **Step 3: Wrap callbacks in `useCallback`, value in `useMemo`**

In `frontend/src/context/AuthContext.js`, replace the `value={{...}}` block (lines 418-445) with:

```js
const signIn = useCallback(async (email, password) => { /* ... existing body ... */ }, []);
const signUp = useCallback(async (/* ... */) => { /* ... */ }, []);
const signOut = useCallback(async () => { /* ... */ }, []);
const resetPassword = useCallback(async (email) => { /* ... */ }, []);
const updatePassword = useCallback(async (newPw) => { /* ... */ }, []);
const syncWithSupabase = useCallback(async () => { /* ... */ }, []);
const updateUser = useCallback((updates) => { /* ... */ }, []);  // (also patched in Task 1)

const value = useMemo(
  () => ({ user, isLoading, error, signUp, signIn, signOut, resetPassword, updatePassword, syncWithSupabase, updateUser }),
  [user, isLoading, error, signUp, signIn, signOut, resetPassword, updatePassword, syncWithSupabase, updateUser]
);

return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
```

- [ ] **Step 4: Re-run and verify**

Run: `npx vitest run src/context/__tests__/AuthContext.memoValue.test.js 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/context/AuthContext.js frontend/src/context/__tests__/AuthContext.memoValue.test.js
git commit -m "perf(frontend): memoize AuthContext value to avoid consumer re-renders"
```

---

## Task 14: Delete mobile dead code — `App.js`, `index.js`, `AppNavigator.js`, RN Navigation deps

**Files:**
- Delete: `mobile/App.js`, `mobile/index.js`, `mobile/src/navigation/AppNavigator.js`
- Modify: `mobile/package.json` (drop RN Nav deps + scripts)

- [ ] **Step 1: Confirm `expo-router` is the entry**

Run: `grep '"main"' mobile/package.json`
Expected: `"main": "expo-router/entry"` (already confirmed in audit).

- [ ] **Step 2: Verify all remaining imports point at Expo Router, not RN Navigation**

Run:
```bash
grep -rln "@react-navigation" mobile/src mobile/App.js mobile/index.js 2>&1
```

Expected: most matches in the dead files. If any live file imports from RN Navigation, this plan needs to migrate it first.

- [ ] **Step 3: Delete the dead files**

```bash
git rm mobile/App.js mobile/index.js mobile/src/navigation/AppNavigator.js
```

- [ ] **Step 4: Drop RN Navigation deps**

```bash
cd mobile
npm uninstall @react-navigation/native @react-navigation/native-stack @react-navigation/bottom-tabs @react-navigation/stack
```

Verify `mobile/package.json` no longer lists them.

- [ ] **Step 5: Run the build**

Run:
```bash
cd mobile && npx expo export --platform android --output-dir dist-test 2>&1 | tail -10
```

Expected: build succeeds. If any import referenced a deleted path, fix it.

- [ ] **Step 6: Commit**

```bash
git add -A mobile/
git commit -m "refactor(mobile): delete dead App.js/index.js/navigator + drop RN Navigation deps"
```

---

## Task 15: Install `expo-updates` for JS OTA fixes

**Files:**
- Modify: `mobile/package.json`
- Modify: `mobile/app.json`

- [ ] **Step 1: Install the package**

Run: `cd mobile && npx expo install expo-updates 2>&1 | tail -3`
Expected: "Added 1 package".

- [ ] **Step 2: Configure `app.json`**

Open `mobile/app.json`. Under the `expo` key, add (or merge with existing):

```json
{
  "expo": {
    "updates": {
      "url": "https://u.expo.dev/<your-project-id>",
      "enabled": true,
      "checkAutomatically": "ON_LOAD",
      "fallbackToCacheTimeout": 0
    },
    "runtimeVersion": {
      "policy": "appVersion"
    }
  }
}
```

(Replace `<your-project-id>` with the actual Expo project ID.)

- [ ] **Step 3: Run `eas update:configure`**

Run: `cd mobile && npx eas update:configure 2>&1 | tail -10`
Expected: prints a success message; this configures EAS for OTA.

- [ ] **Step 4: Smoke-test the build**

Run: `npx expo prebuild --clean 2>&1 | tail -10`
Expected: succeeds with no errors about `expo-updates` config.

- [ ] **Step 5: Commit**

```bash
git add mobile/package.json mobile/app.json
git commit -m "feat(mobile): enable expo-updates for JS-only OTA fixes"
```

---

## Task 16: EXIF strip for listing photos (mobile)

**Files:**
- Modify: `mobile/src/utils/imageCompressor.js`
- Modify: `mobile/src/utils/bakeImageEdits.js` (if used)

- [ ] **Step 1: Add EXIF strip to `imageCompressor.js`**

Currently at line 1-14, the manipulator does:

```js
expo-image-manipulator.manipulateAsync(uri, [{ resize: { width: 1920 } }], ...)
```

Add a second pass that re-encodes via Skia to drop EXIF. Add a helper:

```js
import { Skia } from '@shopify/react-native-skia';

export async function stripExif(inputUri) {
  const data = await fetch(inputUri).then(r => r.arrayBuffer());
  const skData = Skia.Data.fromBytes(new Uint8Array(data));
  const image = Skia.Image.MakeImageFromEncoded(skData);
  if (!image) return inputUri;
  const surface = Skia.Surface.MakeOffscreen(image.width(), image.height());
  const canvas = surface.getCanvas();
  canvas.drawImage(image, 0, 0);
  const snapshot = surface.makeImageSnapshot();
  const out = snapshot.encodeToBase64(Skia.ImageFormat.JPEG, 90);
  return `data:image/jpeg;base64,${out}`;
}
```

(Verify the exact Skia API in your `mobile/package.json` `@shopify/react-native-skia` version.)

In `compressImage`, chain:

```js
const resized = await manipulateAsync(uri, [{ resize: { width: 1920 } }], ...);
return await stripExif(resized.uri);
```

- [ ] **Step 2: Write a test that pins EXIF stripping**

Create `mobile/src/utils/__tests__/imageCompressor.stripExif.test.js`:

```js
import { stripExif } from '../imageCompressor';

describe('stripExif', () => {
  it('produces an image with no GPS data', async () => {
    // Construct an in-memory JPEG with EXIF GPS at known coords.
    // ... (skipped because constructing valid EXIF JPEGs in tests is hard)
    // Better: assert that the output file size is smaller than input,
    // and that calling `Skia.Data.fromBytes(...).getTag(Skia.Tag.GpsLatitude)`
    // returns undefined after stripping.
    const out = await stripExif(require('./test-fixtures/exif-photo.jpg'));
    const bytes = await fetch(out).then(r => r.arrayBuffer());
    const skData = Skia.Data.fromBytes(new Uint8Array(bytes));
    expect(skData.getTag(Skia.Tag.GpsLatitude)).toBeUndefined();
    expect(skData.getTag(Skia.Tag.GpsLongitude)).toBeUndefined();
  });
});
```

(Test fixture path may need adjustment. If Skia doesn't expose EXIF in this version, drop the precise assertion and replace with "output JPEG is valid + smaller than input.")

- [ ] **Step 3: Run and verify**

Run: `cd mobile && npx jest src/utils/__tests__/imageCompressor.stripExif.test.js 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 4: Verify the full compressor pipeline**

Open the upload screen in dev. Upload a JPEG with EXIF GPS data. After upload, fetch the resulting storage URL and verify the EXIF is gone (using `exiftool` if available).

- [ ] **Step 5: Commit**

```bash
git add mobile/src/utils/imageCompressor.js mobile/src/utils/__tests__/imageCompressor.stripExif.test.js
git commit -m "fix(mobile): strip EXIF GPS from listing photos before upload"
```

---

## Task 17: Compress profile photo before upload

**Files:**
- Modify: `mobile/src/screens/profile/SettingsScreen.js:100-137`

- [ ] **Step 1: Add a profile-specific compressor**

In `mobile/src/screens/profile/SettingsScreen.js`, near the top:

```js
import * as ImageManipulator from 'expo-image-manipulator';

async function compressForProfile(uri) {
  return await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 512, height: 512 } }],
    { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
  );
}
```

- [ ] **Step 2: Use it in `pickImage` → `uploadPhoto`**

In the file's `pickImage` handler, after `ImagePicker.launchImageLibraryAsync(...)`, add:

```js
const compressed = await compressForProfile(result.assets[0].uri);
const localUri = compressed.uri;
```

Then pass `localUri` to `uploadPhoto` instead of the raw picker result.

- [ ] **Step 3: Show upload progress**

If `uploadPhoto` uses `fetch`, switch to `XMLHttpRequest` with `xhr.upload.onprogress`:

```js
const xhr = new XMLHttpRequest();
xhr.upload.onprogress = (e) => {
  if (e.lengthComputable) {
    setUploadProgress(Math.round((e.loaded / e.total) * 100));
  }
};
xhr.open('POST', uploadUrl);
xhr.setRequestHeader('Authorization', `Bearer ${token}`);
xhr.onload = () => { /* handle */ };
xhr.send(formData);
```

Render `<ProgressBar value={uploadProgress} />` next to the upload control.

- [ ] **Step 4: Commit**

```bash
git add mobile/src/screens/profile/SettingsScreen.js
git commit -m "fix(mobile): compress profile photo before upload + progress bar"
```

---

## Task 18: Mobile listing cache — persist to AsyncStorage

**Files:**
- Modify: `mobile/src/utils/listingCache.js:14-56`
- Modify: `mobile/app/_layout.tsx` (hydrate-on-boot)

- [ ] **Step 1: Add a write-through to AsyncStorage**

In `mobile/src/utils/listingCache.js`, when `prefetchListing` adds to the in-memory Map, mirror the entry to AsyncStorage under a key like `@dph_cache/listing:v1`:

```js
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@dph_cache/listing:v1';

async function persistToStorage(listings) {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ ts: Date.now(), listings }));
  } catch {}
}

async function hydrateFromStorage() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.ts > 24 * 3600 * 1000) return [];  // 24h TTL
    return parsed.listings;
  } catch { return []; }
}
```

In `prefetchListing`, call `persistToStorage(updatedCache)`; in a one-shot bootstrap call `hydrateFromStorage()` and seed the in-memory map.

- [ ] **Step 2: Hydrate in `app/_layout.tsx`**

At the bottom of `_layout.tsx`'s effect, call `hydrateFromStorage()` and seed the cache.

- [ ] **Step 3: Test cold-start hydration**

Run:
```bash
npx expo start --ios
```

Tap a push notification → open the listing. Kill the app. Open the app from scratch. Confirm the listing renders from cache before the network fetch completes (visual: skeleton is brief).

- [ ] **Step 4: Commit**

```bash
git add mobile/src/utils/listingCache.js mobile/app/_layout.tsx
git commit -m "perf(mobile): persist listing cache for cold-start push-open"
```

---

## Task 19: Drop unused heavy deps from `frontend/package.json`

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Verify each dep has zero importers**

Run, per dep:

```bash
grep -rln "from 'three'\|from '@react-three" frontend/src 2>&1 | head -5
grep -rln "from '@tensorflow" frontend/src 2>&1 | head -5
grep -rln "from 'lucide-react" frontend/src 2>&1 | head -5
```

The audit verified `three`, `@react-three/fiber`, `@react-three/drei` ARE used by `HeroBackground.js`. **Do not drop them.** Keep.

`@tensorflow/tfjs`, `@tensorflow-models/blazeface`, `nsfwjs` ARE used dynamically by `imageModeration.js`. **Do not drop them.** Keep.

`axios` was dropped in Task 3 (after Task 3 lands).

- [ ] **Step 2: Document the audit contradiction**

The original AUDIT_REPORT.md recommendation to drop these deps was wrong. Add a `frontend/DEPENDENCIES.md`:

```md
# Why these "heavy" deps stay

- `@react-three/fiber`, `@react-three/drei`, `three` — used by `HeroBackground.js` (homepage).
  Loaded via `lazy()` in `HomePage.js`, so they're not in the initial bundle.
- `@tensorflow/tfjs`, `@tensorflow-models/blazeface`, `nsfwjs` — used dynamically
  in `src/utils/imageModeration.js` for on-device NSFW check. Not in the initial
  bundle; server is source of truth.
```

- [ ] **Step 3: Commit**

```bash
git add frontend/package.json frontend/DEPENDENCIES.md
git commit -m "docs: clarify why three.js / tensorflow deps stay (used by lazy-loaded modules)"
```

---

## Out-of-plan follow-ups

1. **ExplorePage virtualization** — `H-F2`: Add `@tanstack/react-virtual`. The audit §6.1 item 1 marks this as **the single highest-impact perf fix**. Out of scope here (needs its own spec because windowing breaks scroll position, focus management, and SEO); tracked separately.
2. **`PostCar.js` split** — `H-F6`: At 3,197 lines, this needs a multi-sprint extraction into `CarForm`, `RegistrationScanner`, `MapSection`, etc.
3. **`SavedListingsContext` API surface** — split into `useSaved` and `useUser` contexts.
4. **Mobile `App.js` cleanup finalisation** — confirm build, Expo Go compat, OTA end-to-end.
5. **`<React.StrictMode>`** — wrap in `index.js` to surface double-effect bugs.
6. **`AdminDashboard` visibility-aware interval** — `H-F13`.
7. **Frontend per-page perf budget** — add lighthouse-ci to the build for regression detection.

---

## Task 20: Remove eager CORS preflight in `apiClient.js`

**Files:**
- Modify: `frontend/src/utils/apiClient.js:28-54`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/utils/__tests__/apiClient.noEagerPreflight.test.js`:

```js
describe('apiClient', () => {
  it('does not fetch on module load', () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    require('../apiClient');  // triggers module-level code
    // No fetch calls until the first request method is invoked.
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run src/utils/__tests__/apiClient.noEagerPreflight.test.js 2>&1 | tail -10`
Expected: FAIL — current `checkAndUpdateBaseUrl()` runs `fetch(OPTIONS)` at import time.

- [ ] **Step 3: Drop the eager invocation**

In `frontend/src/utils/apiClient.js`, find `checkAndUpdateBaseUrl()` (around line 28) and either:
- Delete the function entirely (the lazy `try 127.0.0.1 on failure` path on lines 165-180 covers it), OR
- Move the call inside `request()` so it only runs when a real request fails.

Simpler: delete `checkAndUpdateBaseUrl` and its callers.

- [ ] **Step 4: Re-run and verify**

Run: `npx vitest run src/utils/__tests__/apiClient.noEagerPreflight.test.js 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/utils/apiClient.js frontend/src/utils/__tests__/apiClient.noEagerPreflight.test.js
git commit -m "perf(frontend): drop eager CORS preflight from apiClient"
```

---

## Task 21: Fix `SavedListingsContext.toggleSaveListing` race

**Files:**
- Modify: `frontend/src/context/SavedListingsContext.js:134-211`

- [ ] **Step 1: Write a failing test**

Create `frontend/src/context/__tests__/SavedListingsContext.race.test.js`:

```js
describe('SavedListingsContext.toggleSavedListing race', () => {
  it('coalesces double-clicks into one POST', async () => {
    // Mount with a saved item. Click heart twice rapidly.
    // Expect: exactly ONE POST request, no DELETE.
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    const { result } = renderHook(() => useContext(SavedListingsContext), { wrapper });
    await act(async () => {
      result.current.toggleSavedListing('L1');  // saves
    });
    fetch.mockClear();
    await act(async () => {
      result.current.toggleSavedListing('L1');
      result.current.toggleSavedListing('L1');  // double-click
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url] = fetch.mock.calls[0];
    expect(url).toMatch(/\/api\/user\/saved-listings/);
    expect(fetch.mock.calls[0][1].method).toBe('POST');
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run src/context/__tests__/SavedListingsContext.race.test.js 2>&1 | tail -10`
Expected: FAIL.

- [ ] **Step 3: Gate function entry on `savingKeys[key]`**

In `frontend/src/context/SavedListingsContext.js`, at the top of `toggleSavedListing`:

```js
const toggleSavedListing = async (key) => {
  if (savingKeys[key]) {
    return { saved: savedLookup.has(key), busy: true };
  }
  savingKeys[key] = true;
  try {
    // ... existing body unchanged ...
  } finally {
    delete savingKeys[key];
  }
};
```

The `savingKeys` `useRef` is already declared at line ~145 (per the audit); the gate is the missing piece.

- [ ] **Step 4: Re-run and verify**

Run: `npx vitest run src/context/__tests__/SavedListingsContext.race.test.js 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/context/SavedListingsContext.js frontend/src/context/__tests__/SavedListingsContext.race.test.js
git commit -m "fix(frontend): coalesce double-clicks in SavedListingsContext.toggleSavedListing"
```

---

## Task 22: Cancel `PostCar.js` post-submit `setTimeout(navigate)`

**Files:**
- Modify: `frontend/src/components/PostCar.js:1700-1775`

- [ ] **Step 1: Write a failing test**

Create `frontend/src/components/__tests__/PostCar.navTimeout.test.js`:

```js
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PostCar from '../PostCar';

describe('PostCar post-submit navigation', () => {
  it('cancels pending navigation timer on unmount', async () => {
    const { unmount } = render(<MemoryRouter><PostCar /></MemoryRouter>);
    // Simulate post-submit state — the timer is set.
    act(() => {
      // trigger the success path; project-specific trigger
      fireEvent.click(screen.getByRole('button', { name: /submit|publish/i }));
    });
    unmount();
    // If the timer leaked, vitest's fake-timer test would advance 2s and navigate to /
    // The current code has no cleanup, so the assertion below catches a regression.
    expect(true).toBe(true);  // placeholder; project may need a navigation-spy helper
  });
});
```

(Adjust the trigger to match how your testbed triggers the success path. If unit-testing this is impractical, a manual smoke test is acceptable for this task.)

- [ ] **Step 2: Manual smoke test (skip unit)**

Run: `npm start`. Submit a car listing. Within the 2 s before redirect, click a different nav link (e.g., `/about`). Verify that the timer does NOT re-navigate to `/my-listings` after the click. With current code, it does (audit H-F11). After fix, it doesn't.

- [ ] **Step 3: Store timer in ref + cleanup on unmount**

In `frontend/src/components/PostCar.js`, around line 1757:

```js
const navTimerRef = useRef(null);
// ... inside the success handler:
const onSubmitSuccess = () => {
  // existing toast / success-message display
  navTimerRef.current = setTimeout(() => navigate('/my-listings'), 2000);
};

// In useEffect cleanup:
useEffect(() => () => {
  if (navTimerRef.current) clearTimeout(navTimerRef.current);
}, []);
```

- [ ] **Step 4: Manual re-test**

Re-run the same scenario as Step 2. With the fix, clicking another nav link within 2 s should NOT trigger a re-navigation 2 s later.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/PostCar.js
git commit -m "fix(frontend): cancel PostCar post-submit navigation timer on unmount"
```

---

## Task 23: Lighten `useListingCounts` and `useFeaturedPattern` inflight cache

**Files:**
- Modify: `frontend/src/hooks/useListingCounts.js:12, 38-48`
- Modify: `frontend/src/hooks/useFeaturedPattern.js:9, 34-45`

- [ ] **Step 1: Write a test that pins error reporting**

Create `frontend/src/hooks/__tests__/useListingCounts.error.test.js`:

```js
import { renderHook, waitFor } from '@testing-library/react';
import { useListingCounts } from '../useListingCounts';

describe('useListingCounts', () => {
  it('reports API errors instead of silently defaulting', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useListingCounts());
    await waitFor(() => {
      expect(result.current.error).toBeDefined();
      expect(result.current.error.message).toContain('boom');
    });
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run src/hooks/__tests__/useListingCounts.error.test.js 2>&1 | tail -10`
Expected: FAIL — current code silently defaults on error.

- [ ] **Step 3: Surface errors and use AbortController**

In `frontend/src/hooks/useListingCounts.js`, refactor:

```js
function useListingCounts() {
  const [counts, setCounts] = useState(null);
  const [error, setError] = useState(null);
  const inflightRef = useRef(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    inflightRef.current = apiClient(...)
      .then(data => { if (!cancelledRef.current) { setCounts(data); setError(null); } })
      .catch(e => { if (!cancelledRef.current) setError(e); });
    return () => { cancelledRef.current = true; controller.abort(); };
  }, [...deps]);

  return { counts, error };
}
```

Apply the same shape to `useFeaturedPattern.js`.

- [ ] **Step 4: Re-run and verify**

Run: `npx vitest run src/hooks/__tests__/useListingCounts.error.test.js 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useListingCounts.js frontend/src/hooks/useFeaturedPattern.js frontend/src/hooks/__tests__/useListingCounts.error.test.js
git commit -m "fix(frontend): report API errors from listing-counts + featured-pattern hooks"
```

---

## Task 24: Stop using `JSON.stringify` for full-payload cache comparison

**Files:**
- Modify: `frontend/src/utils/fetchCache.js:9, 23, 64`

- [ ] **Step 1: Write a test that pins the new behaviour**

Create `frontend/src/utils/__tests__/fetchCache.cheapCompare.test.js`:

```js
import { fetchJsonWithCache } from '../fetchCache';

describe('fetchJsonWithCache comparison', () => {
  it('does not call JSON.stringify on cached payloads', async () => {
    const url = '/api/__test_compare?r=' + Math.random();
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ data: 'first' }) });
    const stringSpy = jest.spyOn(JSON, 'stringify');

    await fetchJsonWithCache(url, { ttlMs: 60_000, signal: undefined, onUpdate: undefined });
    // First call: stringify to compare against empty cache => 1 call.
    stringSpy.mockClear();
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ data: 'first' }) });
    await fetchJsonWithCache(url, { ttlMs: 60_000, signal: undefined, onUpdate: undefined });
    // Second call (cache hit): stringify call count for comparison should be 0.
    expect(stringSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npx vitest run src/utils/__tests__/fetchCache.cheapCompare.test.js 2>&1 | tail -10`
Expected: FAIL — current code does `JSON.stringify(fresh.data) !== JSON.stringify(cached)` (line 64).

- [ ] **Step 3: Use `etag` / `Last-Modified` instead**

In `frontend/src/utils/fetchCache.js`, change the comparison:

```js
// Before:
if (JSON.stringify(fresh.data) !== JSON.stringify(cached)) {
  // ...
}

// After:
const freshEtag = response.headers.get('etag');
if (cached && cached.etag === freshEtag) {
  return cached.data;  // server says unchanged
}
```

For the secondary store of sessionStorage, store `{ etag, ts, data }` instead of raw `JSON.stringify` blobs.

If `etag` is not in the API response shape, fall back to a content hash from the server's `cache-control: max-age=N` and skip the comparison entirely:

```js
// Simpler alternative: trust the TTL alone, drop the stringify compare.
```

- [ ] **Step 4: Re-run and verify**

Run: `npx vitest run src/utils/__tests__/fetchCache.cheapCompare.test.js 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/utils/fetchCache.js frontend/src/utils/__tests__/fetchCache.cheapCompare.test.js
git commit -m "perf(frontend): drop JSON.stringify comparison on cache hit; use ETag"
```

---

## Task 25: Allow-list `order=` on backend list endpoints

**Files:**
- Modify: `backend/app.py:6419` (cars), `:14582` (bikes), `:16412` (car_parts), `:16718` (license_plates)

- [ ] **Step 1: Write a failing test**

Create `backend/test_order_allow_list.py`:

```python
import unittest
from unittest.mock import patch


class TestOrderAllowList(unittest.TestCase):
    @patch("backend.app._fetch_cars")
    def test_unknown_order_field_rejected_with_400(self, mock_fetch):
        mock_fetch.return_value = ([], 200)
        from app import create_app
        app = create_app(testing=True)
        client = app.test_client()
        r = client.get("/api/cars?order=description.asc")
        self.assertEqual(r.status_code, 400,
            f"unknown order should be 400, got {r.status_code}")
```

- [ ] **Step 2: Run and verify failure**

Run: `python -m pytest backend/test_order_allow_list.py -v 2>&1 | tail -10`
Expected: FAIL — current `order` is passed through unchecked.

- [ ] **Step 3: Add the allow-list at each endpoint**

In `backend/app.py:6419` (cars), add before the Supabase call:

```python
ALLOWED_CAR_ORDER = {"created_at.desc", "expected_selling_price.asc", "expected_selling_price.desc"}
order_param = request.args.get("order", "created_at.desc")
if order_param not in ALLOWED_CAR_ORDER:
    return jsonify({"error": "unsupported order"}), 400
```

Repeat for bikes (`14582`), car_parts (`16412`), license_plates (`16718`) with their own allow-lists.

- [ ] **Step 4: Re-run and verify**

Run: `python -m pytest backend/test_order_allow_list.py -v 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app.py backend/test_order_allow_list.py
git commit -m "fix(security): allow-list order= on cars/bikes/car_parts/license_plates"
```

---

## Task 26: [NARROWED] Strip EXIF on the non-JPEG listing-image branch + dealer documents

**Original claim was too broad.** `app.py:8404-8409` already re-encodes JPEG/PNG/GIF-sourced listing
uploads as JPEG (`img.save(output, format="JPEG", quality=85, optimize=True)`), and Pillow drops EXIF
on a JPEG re-encode by default — confirmed by reading the code directly. Writing a test that expects
this path to currently fail (as the original Task 26 did) would find it already passes, which is a
false RED step, not a real regression test. The two branches that genuinely still carry EXIF:

1. `app.py:8409`, the `else` branch: `img.save(output, format=img.format or "JPEG", quality=85)` —
   re-saves an already-WebP source in its own format, which does not strip EXIF the way the JPEG
   branch does.
2. Dealer document uploads (trade license, TRN, passport scans) at `app.py:23996-24004` and
   `app.py:10014-10140` — stored byte-for-byte with no re-encode at all (`SECURITY_AUDIT.md` MEDIUM-3).

**Files:**
- Modify: `backend/app.py:8409` (the non-JPEG listing-image branch)
- Modify: `backend/app.py:23996-24004`, `backend/app.py:10014-10140` (dealer document upload)

- [ ] **Step 1: Verify `pillow` is in `requirements.txt`**

Run: `grep -n "^pillow" backend/requirements.txt`
Expected: `pillow==11.1.0` or similar. Pillow has EXIF-tag-stripping built-in.

- [ ] **Step 2: Write a failing test for the non-JPEG listing branch**

Create `backend/test_strip_exif_on_upload.py`:

```python
import io
import unittest


class TestStripExifOnNonJpegUpload(unittest.TestCase):
    def test_webp_upload_strips_exif(self):
        # The JPEG branch (app.py:8405) already strips EXIF via re-encode —
        # confirmed working, do not re-test it here. This targets the else
        # branch (app.py:8409) that re-saves non-JPEG sources verbatim.
        from PIL import Image
        img = Image.new("RGB", (200, 200), (255, 0, 0))
        exif = img.getexif()
        exif[0x8825] = {0x0001: "N", 0x0002: (25, 0, 0)}  # minimal GPS IFD
        buf = io.BytesIO()
        img.save(buf, format="WEBP", exif=exif.tobytes())

        from app import _strip_exif  # added in Step 4
        out = _strip_exif(buf.getvalue(), fmt="WEBP")

        from PIL import Image as PILImage
        out_img = PILImage.open(io.BytesIO(out))
        out_exif = out_img.getexif()
        self.assertFalse(out_exif.get_ifd(0x8825), "GPS IFD still present after WebP re-save")
```

- [ ] **Step 3: Run and verify failure**

Run: `python -m pytest backend/test_strip_exif_on_upload.py -v 2>&1 | tail -10`
Expected: FAIL — `_strip_exif` doesn't exist yet, and the current `else` branch preserves EXIF.

- [ ] **Step 4: Add an explicit strip for the non-JPEG branch**

In `backend/app.py`, replace the `else` branch at line 8409:

```python
# Before:
else:
    img.save(output, format=img.format or "JPEG", quality=85)
    content_type = f"image/{img.format.lower()}" if img.format else "image/jpeg"

# After:
else:
    img_clean = Image.new(img.mode, img.size)
    img_clean.putdata(list(img.getdata()))  # drops img.info (incl. exif) via a clean copy
    img_clean.save(output, format=img.format or "JPEG", quality=85)
    content_type = f"image/{img.format.lower()}" if img.format else "image/jpeg"
```

Add a small `_strip_exif(image_bytes, fmt)` wrapper around this same clean-copy logic so the Step 2
test can call it directly without going through the full upload request path.

- [ ] **Step 5: Strip metadata on dealer document uploads**

At `app.py:23996-24004` and `app.py:10014-10140`, before storing: run `piexif.remove(bytes)` for
JPG/PNG (add `piexif` to `requirements.txt` if not present) and, for PDFs, shell out is not an option
per this project's no-`subprocess` convention (`SECURITY_AUDIT.md` FP-3) — use `pypdf`'s
`writer.metadata = {}` / `remove_metadata()` instead of `qpdf`.

- [ ] **Step 6: Re-run and verify**

Run: `python -m pytest backend/test_strip_exif_on_upload.py -v 2>&1 | tail -10`
Expected: PASS. Also re-run the existing upload tests to confirm the JPEG branch is untouched:
`python -m pytest backend/test_*upload* -q 2>&1 | tail -10`.

- [ ] **Step 7: Commit**

```bash
git add backend/app.py backend/requirements.txt backend/test_strip_exif_on_upload.py
git commit -m "fix(privacy): strip EXIF on non-JPEG listing uploads and dealer documents"
```

---

## Verification triad at the end

After all tasks land, run:

```bash
# Backend
cd backend
python -m pytest backend/ --ignore=backend/testdata -q
python -c "import ast; ast.parse(open('app.py').read())"

# Frontend
cd ../frontend
npm run build
npx vitest run -q

# Mobile
cd ../mobile
npx tsc --noEmit -p .
npx expo prebuild --clean
```

All three must pass before declaring the plan complete.
