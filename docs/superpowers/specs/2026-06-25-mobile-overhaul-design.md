# Mobile App Overhaul — Design Spec
**Date:** 2026-06-25  
**Scope:** React Native app at `flask-react-supabase-app/mobile`  
**Dealer dashboard:** excluded (desktop-only for now)  
**Animation target:** Smooth & native (spring physics, skeleton loaders, staggered entrances)

---

## Background

An audit of the mobile app against the web frontend and the backend changes shipped on 2026-06-25 identified three categories of work:

1. Silent failures, unused dependencies, pagination bugs, and missing image compression making the app fragile in production.
2. Inconsistent and incomplete animation system — existing Reanimated primitives exist but are not applied uniformly.
3. Missing screens: buying requests, image cropper, listing renewal, CAPTCHA in auth; plus admin screens not yet reflecting backend changes.

Work is split into three shippable phases. Each phase produces a deployable build.

---

## Phase 1 — Foundation

### 1.1 Dependency Cleanup

Remove from `package.json`:
- `axios` — declared but never imported anywhere in the codebase
- `async-storage` — duplicate of `@react-native-async-storage/async-storage`
- `expo-router` — installed but entire app uses React Navigation; dead weight

Add:
- `react-native-toast-message` — single notification surface for all API feedback
- `@shopify/flash-list` — high-performance list renderer to replace FlatList on heavy screens
- `expo-image-manipulator` — image resize/compress before upload

### 1.2 Toast Notification System

**New file:** `src/utils/toast.js`

Exports `showToast(type, title, message)` — a thin wrapper around `react-native-toast-message`. Types: `success`, `error`, `info`.

`ToastMessage` component mounted once at the root in `App.js` above the navigator.

**All silent `catch` blocks replaced.** Every screen and context method that calls the API wraps errors with `showToast('error', 'Something went wrong', err.message)`. Specific cases:
- Network timeout → "Check your connection and try again"
- 401 → navigate to Login (already handled in apiClient; add toast before redirect)
- 403 → "You don't have permission to do that"
- 400 with `error` field → show the server's error message directly
- 5xx → "Server error — please try again"

`SavedListingsContext` save/remove errors currently revert state silently — show toast and keep the optimistic update reverted so the user understands why.

### 1.3 Image Compression

**New file:** `src/utils/imageCompressor.js`

```js
compressImage(uri) → Promise<{ uri, width, height, size }>
```

Uses `expo-image-manipulator`:
- Resize to max 1920px on longest side (maintains aspect ratio)
- JPEG quality 0.85
- Returns compressed URI

`PostListingScreen` calls `compressImage` on each picked image before adding it to state. Upload size reduced ~60–70% for typical 12MP phone photos.

`FadeInImage` gets an `onError` prop that shows a grey placeholder icon instead of blank space.

### 1.4 FlashList Migration

Replace `FlatList` with `FlashList` (from `@shopify/flash-list`) on:
- `CarListScreen`
- `BikeListScreen`
- `PlateListScreen`
- `PartListScreen`
- `ExploreScreen` (search results)
- `AdminListingsScreen`
- `AdminUsersScreen`

Each screen provides `estimatedItemSize` based on card height. `keyExtractor` already present — no other changes needed per screen.

### 1.5 Pagination Fix

`CarListScreen` (and equivalents) bug: when filters change, `page` resets to 1 but existing `listings` array is not cleared before the new fetch resolves, causing a flash of old results.

Fix: reset `listings = []` and `page = 1` synchronously in the filter `useEffect` before triggering the fetch. Add `useCallback` memoisation on filter handlers to prevent unnecessary re-renders.

`hasMore` logic change: currently `data.length < PAGE_SIZE` is used as a sentinel. Replace with an explicit `total` count from the API response header (`Content-Range`) when available, falling back to the current heuristic.

### 1.6 SWR Cache Fix

`src/utils/swrCache.js` has no TTL. Add:
- `set(key, value, ttlSeconds = 60)` — stores value with `expiresAt = Date.now() + ttlSeconds * 1000`
- `get(key)` — returns `null` if expired
- `invalidate(key)` — explicit eviction
- `invalidatePrefix(prefix)` — evict all keys starting with prefix (used after create/edit/delete)

### 1.7 Console Cleanup

Wrap all `console.log`, `console.warn`, `console.error` calls with `if (__DEV__)` guard. Affects: `ocrScanner.js`, `config.js`, `authService.js`, `leadTracking.js`, `analytics.js`, and scattered screen-level logs.

Remove empty `setAuthHeader()` stub from `authService.js`.

---

## Phase 2 — Animation Overhaul

### 2.1 Motion Constants

**New file:** `src/constants/motion.js`

```js
export const SPRING_FAST   = { damping: 20, stiffness: 300 };
export const SPRING_NORMAL = { damping: 18, stiffness: 200 };
export const SPRING_SLOW   = { damping: 15, stiffness: 120 };
export const FADE_DURATION = 220;
export const STAGGER_DELAY = 40; // ms per list item
export const ENTRANCE_DISTANCE = 16; // px translate on screen entrance
```

All animation components import from here — one place to tune feel across the whole app.

### 2.2 ScreenEntrance Wrapper

**New component:** `src/components/ui/ScreenEntrance.js`

Wraps screen content. On mount: fades in (opacity 0→1) and translates up (translateY 16→0) over 280ms using `withTiming`. Every screen's root `ScrollView` or `View` wrapped with `ScreenEntrance`.

Applied in `screenOptions` via a `contentStyle` + `animation` prop at the navigator level where possible; otherwise wrapped per-screen.

### 2.3 Staggered List Entrance

**New hook:** `src/hooks/useStaggeredEntrance.js`

```js
useStaggeredEntrance(index) → animatedStyle
```

Returns `useAnimatedStyle` with `opacity` and `translateY` driven by `withDelay(index * STAGGER_DELAY, withSpring(0, SPRING_FAST))`. Each list card receives its index and spreads the animated style.

Applied to all FlashList `renderItem` calls (CarList, BikeList, PlateList, PartList, AdminListings, AdminUsers, SavedScreen, MyListings, ExploreScreen results).

First 8 items animate; items beyond index 8 skip animation (already scrolled past viewport on initial load).

### 2.4 Shimmer Skeleton

**Updated component:** `src/components/ui/ListingSkeleton.js`

Replace static grey boxes with a left-to-right shimmer using `withRepeat(withTiming(1, {duration: 900}), -1, true)` driving a gradient position via `react-native-linear-gradient` (already transitively available via expo-linear-gradient).

Skeleton shape matches actual card layout: image placeholder (16:9 ratio), two text lines, a price line. Used on all list screens and detail screens during initial load.

New specialised skeletons:
- `ProfileSkeleton` — avatar circle + three stat tiles
- `AdminStatsSkeleton` — four KPI tiles + sparkline placeholder
- `DetailSkeleton` — full-bleed image + spec rows

### 2.5 Universal Press Animation

**Updated component:** `src/components/ui/AnimatedCard.js`

Already has Reanimated scale. Extend to export a `PressableScale` primitive that any component can use:

```js
<PressableScale onPress={fn} scale={0.97} haptic="light">
  {children}
</PressableScale>
```

Replace all raw `TouchableOpacity` and `Pressable` across:
- All listing cards in list screens
- All buttons in detail screens (Call, WhatsApp, Save, Report)
- All admin action buttons
- Profile screen stat tiles
- Settings rows

Haptic feedback: `light` on list card press, `medium` on primary action (save/call/submit), `success` (notification) on successful form submission.

### 2.6 Detail Screen Parallax

`CarDetailScreen`, `BikeDetailScreen`, `PlateDetailScreen`, `PartDetailScreen` each have image carousels at the top. Wire up `ParallaxHeader` (already built at `src/components/ui/ParallaxHeader.js`) to the scroll position.

Header title fades in as user scrolls past the image (opacity driven by `scrollY` interpolated between image height and image height + 40px).

Back button stays pinned at top-left throughout scroll (absolute positioned outside the parallax wrapper).

### 2.7 Tab Bar Animation

Bottom tab icons get a scale spring on selection: selected icon scales to 1.15 with `withSpring(SPRING_FAST)`, unselected returns to 1.0. Implemented via a custom `tabBarIcon` render function in `AppNavigator.js`.

---

## Phase 3 — Missing Screens & Backend Sync

### 3.1 Buying Requests

**Three new screens:**

**`BuyingRequestsScreen`**
- Route: added to Explore stack as `BuyingRequests`
- Entry point: new tile in ExploreScreen category grid ("Wanted" label, search icon)
- Fetches `GET /api/buying-requests` with filters: `category`, `budget_max`, `offset`/`limit`
- FlashList of request cards: title, budget range, category badge, posted date
- Pull-to-refresh + infinite scroll
- Empty state with "Be the first to post a buying request" CTA

**`BuyingRequestDetailScreen`**
- Route: `BuyingRequestDetail` (receives `requestId` param)
- Fetches `GET /api/buying-requests/{id}`
- Shows: description, budget, category, make/model preferences, poster's contact (WhatsApp/call)
- Lead tracking: `POST /api/listings/buying_request/{id}/lead-events` on contact tap
- Report button (existing `ReportButton` component)
- ScreenEntrance + ParallaxHeader (if poster has a photo)

**`PostBuyingRequestScreen`**
- Route: added to Post tab stack
- Fields: category (picker), make (optional), model (optional), budget min/max (numeric inputs), description (multiline), contact preference (phone/WhatsApp)
- Submits `POST /api/buying-requests`
- Requires auth — gated by `RequireAuth` wrapper
- On success: toast + navigate back to BuyingRequestsScreen

### 3.2 ImageCropperModal

**New component:** `src/components/ui/ImageCropperModal.js`

Bottom sheet modal (uses existing `BottomSheet.js`).

Interface:
```js
<ImageCropperModal
  visible={bool}
  imageUri={string}
  onConfirm={(compressedUri) => void}
  onCancel={() => void}
/>
```

Internally:
- Shows image in a `react-native-gesture-handler` pan/pinch container
- Aspect ratio toggle: Free / 4:3 / 16:9 / 1:1
- On confirm: runs `expo-image-manipulator` crop + compress (quality 0.85)
- Returns single compressed URI to caller

`PostListingScreen` updated: after picking each image from gallery/camera, opens `ImageCropperModal` before adding to the list. The existing flow of showing previews remains unchanged.

### 3.3 RenewListingModal

**New component:** `src/components/ui/RenewListingModal.js`

Bottom sheet triggered from the three-dot action menu on expired/expiring listing cards in `MyListingsScreen`.

Shows:
- Current expiry date
- New expiry date (current + 30 days, computed client-side for display)
- "Renew listing" confirm button + cancel

On confirm: `POST /api/user/listings/{type}/{id}/outcome` with `{ outcome: 'renew' }`. On success: toast "Listing renewed — active for another 30 days", invalidate `user/listings` cache, refresh list.

`MyListingsScreen` updated to show a "Renew" action in the listing card menu alongside existing Edit/Delete. Renew only shown when listing status is `expired` or `expiring_soon`.

### 3.4 CAPTCHA in Auth

`LoginScreen` and `SignupScreen` get Cloudflare Turnstile integration.

**New utility:** `src/utils/turnstile.js`

Opens a local HTML page in `expo-web-browser` (or an inline `WebView`) containing the Turnstile widget. Listens for a `postMessage` from the page containing the token. Returns `Promise<string>` (the token) or throws if user dismisses.

The Turnstile site key is read from `src/constants/config.js` (new `TURNSTILE_SITE_KEY` constant).

Flow:
1. User fills in email + password
2. On submit tap: `turnstile.getToken()` called → Turnstile widget appears
3. User solves (usually automatic)
4. Token forwarded to `POST /api/auth/login` or `POST /api/auth/signup` as `cf_turnstile_token` body field
5. Backend validates (already implemented on web)

If `TURNSTILE_SITE_KEY` is empty, the step is skipped (graceful degradation for dev builds).

### 3.5 Backend Sync — Admin Screens

**`AdminDashboardScreen`**

The `/api/admin/stats` response now includes `data_source`, `unique_visitors_source`, and the `edge_*` fields. Update the dashboard to:
- Show "Cloudflare (exact)" badge in orange when `unique_visitors_source === 'cf_rest'`
- Show "Cloudflare (estimated)" badge in amber when `unique_visitors_source === 'cf_graphql_estimate'`
- Show "In-app tracker" badge in grey when `data_source === 'platform_events'`
- Display `edge_requests`, `edge_threats`, `edge_cached_requests` as additional stat tiles when `data_source === 'cloudflare'`

Badge tooltip shown via `ActionNoticeModal` on long-press.

**`AdminMetricsScreen`**

The `/api/admin/metrics/overview` response now includes `unique_visitors_source`. Apply the same badge logic as above to the metrics screen header.

**Car posting sync**

No mobile-specific changes needed — the `user_email` DB fix is backend-only. Verify that `PostListingScreen` for cars does not manually set `auto_review_reasons` (it doesn't — confirmed in audit).

---

## File Change Summary

### New Files
| File | Purpose |
|------|---------|
| `src/utils/toast.js` | Centralised toast wrapper |
| `src/utils/imageCompressor.js` | Compress before upload |
| `src/utils/turnstile.js` | Turnstile CAPTCHA token fetch |
| `src/constants/motion.js` | Animation constants |
| `src/hooks/useStaggeredEntrance.js` | Stagger hook |
| `src/components/ui/ScreenEntrance.js` | Screen mount animation |
| `src/components/ui/PressableScale.js` | Universal press primitive |
| `src/components/ui/ImageCropperModal.js` | Crop + compress modal |
| `src/components/ui/RenewListingModal.js` | Listing renewal bottom sheet |
| `src/screens/listing/BuyingRequestsScreen.js` | Buying requests list |
| `src/screens/listing/BuyingRequestDetailScreen.js` | Request detail |
| `src/screens/listing/PostBuyingRequestScreen.js` | Post a request |

### Modified Files
| File | Change |
|------|--------|
| `package.json` | Remove axios/async-storage/expo-router; add flash-list/toast-message/image-manipulator |
| `App.js` | Add ToastMessage root component |
| `src/navigation/AppNavigator.js` | Add buying request routes; tab icon spring; ScreenEntrance screenOptions |
| `src/utils/swrCache.js` | Add TTL + invalidation |
| `src/utils/imageCompressor.js` | New (see above) |
| `src/context/SavedListingsContext.js` | Replace silent errors with toasts |
| `src/components/ui/ListingSkeleton.js` | Shimmer animation |
| `src/components/ui/AnimatedCard.js` | Export PressableScale |
| `src/components/ui/FadeInImage.js` | Add onError placeholder |
| `src/screens/home/HomeScreen.js` | ScreenEntrance; PressableScale on cards |
| `src/screens/explore/ExploreScreen.js` | FlashList; stagger; buying requests tile |
| `src/screens/listing/CarListScreen.js` | FlashList; stagger; pagination fix |
| `src/screens/listing/BikeListScreen.js` | FlashList; stagger; pagination fix |
| `src/screens/listing/PlateListScreen.js` | FlashList; stagger; pagination fix |
| `src/screens/listing/PartListScreen.js` | FlashList; stagger; pagination fix |
| `src/screens/listing/CarDetailScreen.js` | Parallax; PressableScale; ScreenEntrance |
| `src/screens/listing/BikeDetailScreen.js` | Same as CarDetail |
| `src/screens/listing/PlateDetailScreen.js` | Same as CarDetail |
| `src/screens/listing/PartDetailScreen.js` | Same as CarDetail |
| `src/screens/listing/PostListingScreen.js` | ImageCropperModal; compressImage; toasts |
| `src/screens/profile/MyListingsScreen.js` | RenewListingModal; PressableScale |
| `src/screens/profile/ProfileScreen.js` | ScreenEntrance; shimmer skeleton |
| `src/screens/profile/SavedScreen.js` | Stagger; PressableScale |
| `src/screens/admin/AdminDashboardScreen.js` | CF source badge; edge stat tiles; parallel fetches |
| `src/screens/admin/AdminMetricsScreen.js` | CF source badge; unique_visitors_source |
| `src/screens/admin/AdminListingsScreen.js` | FlashList; stagger |
| `src/screens/admin/AdminUsersScreen.js` | FlashList; stagger |
| `src/screens/auth/LoginScreen.js` | Turnstile before submit; toasts |
| `src/screens/auth/SignupScreen.js` | Turnstile before submit; toasts |
| `src/utils/authService.js` | Remove empty setAuthHeader stub |
| `src/constants/config.js` | Add TURNSTILE_SITE_KEY |
| All files with console.log | Add __DEV__ guard |

---

## Success Criteria

- [ ] No unused packages in `node_modules` after cleanup
- [ ] Zero silent `catch` blocks — every API failure surfaces a toast
- [ ] Image uploads are compressed before sending (verify with network inspector)
- [ ] List screens show shimmer skeleton during first load
- [ ] Every list item entrance is staggered (visible on fresh load)
- [ ] Every tappable surface uses PressableScale (scale 0.97 + haptic)
- [ ] Detail screens have working parallax header
- [ ] Buying requests: list, detail, and post all functional end-to-end
- [ ] ImageCropperModal opens after image pick, compressed image returned
- [ ] RenewListingModal functional on expired listings
- [ ] CAPTCHA step present on Login and Signup (bypassed when site key absent)
- [ ] Admin dashboard shows CF source badge (exact/estimated/platform)
- [ ] All console.log/warn/error gated by __DEV__
- [ ] Pagination: filter change clears old results before fetch resolves

---

## Out of Scope

- Dealer dashboard (desktop-only, excluded by design decision)
- TypeScript migration (separate project, significant scope)
- Offline mode / service worker equivalent
- Push notifications
- Advanced user behaviour session tracking
- Accessibility / screen reader audit
