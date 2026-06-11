# Mobile App Simplification — Design

**Date:** 2026-06-11
**Scope:** `flask-react-supabase-app/mobile`
**Driver:** Screen recording (2:39) of cold-start → browse → login → post → profile → admin showed (a) ~30s to interactive on cold start, (b) two stacked auth surfaces on gated tabs, (c) bloated login form, (d) raw route-name back labels, (e) overwhelming admin dashboard with dev text leaking through, (f) form fatigue on Sell.

User vision: fewer taps, mobile-first admin, instant-feel performance.

## Goals

- **Cold start to first interactive frame: <2s** on a warm app (cached session), <5s on first install.
- **Tab switching never shows a full-screen skeleton** if data was loaded previously this session.
- **One auth surface per gated tap** — no intermediate "Sign in Required" page between the tab tap and the login modal.
- **Login fits above the keyboard** on a 6.1" iPhone with no scrolling.
- **Admin Dashboard puts the work first** — pending approvals / reports / dealer reviews above the fold.
- **Admin list rows are 2 lines max**, with swipe actions on queue lists.
- **Sell flow takes ≤3 short screens** instead of one long form, and the photo step is first.

## Non-goals

- No redesign of detail screens (CarDetail / BikeDetail / etc.).
- No backend/API contract changes beyond what `endpointMap` already supports.
- No new dependencies (use the existing `swrCache` utility, AsyncStorage, and built-in React Navigation primitives).

---

## Phase 1 — Speed + Login UX

### 1.1 Don't block render on auth check

**File:** `mobile/src/navigation/AppNavigator.js`

Today, `AppNavigator` returns `<LoadingSpinner message="Loading..." />` while `useAuth().isLoading` is true. The video shows that gate alone takes 5–10s on cold start because the session check awaits `/api/auth/me` and a Supabase refresh.

**Change:**
- `AppNavigator` renders `<NavigationContainer>` immediately. No `isLoading` gate.
- `AuthContext` persists a `cached_user` snapshot in `AsyncStorage` whenever `setUser` is called (only safe fields: id, first_name, email, is_admin, is_dealer, phone_verified).
- On mount, `AuthContext` rehydrates `user` from `cached_user` synchronously in `useState(initialValue)` form — so `useAuth().user` is non-null from the very first render for returning users.
- The backend check still runs in the background; if it disagrees with the cached snapshot (e.g. user was deactivated), it updates state. If the backend says "no user" but cache says authed, we DO NOT immediately sign out — wait one retry, then sign out only on confirmed failure.

**Acceptance:** authenticated users see their tab content immediately on cold start; unauthenticated users see Explore immediately with no spinner.

### 1.2 Persistent Explore cache, no skeleton flash on tab switch

**Files:** `mobile/src/screens/explore/ExploreScreen.js`, possibly `mobile/src/utils/swrCache.js`

`swrCache` already exists and is used by `AdminDashboardScreen`. Extend it (or use it as-is) for Explore.

**Change:**
- Explore reads cached listings from `swrGet('explore:listings:<category>')` synchronously into initial state.
- Skeleton only shows when there is no cache AND no data yet (true cold first-ever load).
- Background revalidation runs on mount and on tab focus (`useFocusEffect`), and updates state if the response differs.
- Same pattern applied to category sub-lists (`CarListScreen`, `BikeListScreen`, `PlateListScreen`, `PartListScreen`).

**Acceptance:** switching tabs and returning to Explore shows the previous listings instantly; new data appears without a skeleton flash.

### 1.3 Collapse the double-login screen

**Files:** `mobile/src/components/ui/RequireAuth.js`, `mobile/src/navigation/AppNavigator.js`

The recording shows `RequireAuth`'s "Sign in Required" page rendering at the same time as the modal Login slides up. Two surfaces for one decision.

**Change:**
- When an unauthenticated user taps a gated tab (Saved/Sell/Profile), navigate directly to `Auth → Login` modal with `redirectRoute` already set. The "Sign in Required" intermediate page is removed.
- Implementation: gated stacks (`AuthGateSavedStack`, `AuthGatePostStack`, `AuthGateProfileStack`) detect `!user` on focus and `navigation.navigate('Auth', { screen: 'Login', params: { redirect: redirectRoute } })`. While the modal is up, the gated stack renders a thin placeholder (just `<View style={{flex:1, backgroundColor: COLORS.black}} />`) — no lock icon, no buttons.
- Successful login uses the existing `redirect` param to bounce the user back to the gated tab.
- `RequireAuth.js` retains `useAuthPrompt` (used for in-screen save/contact actions) but the wrapper-component variant is replaced by a `useAuthGate(redirectRoute)` hook that performs the side-effect navigation.

**Acceptance:** tapping Saved/Sell/Profile when logged out shows ONE screen: the Login modal. No intermediate page.

### 1.4 Slim Login form

**File:** `mobile/src/screens/auth/LoginScreen.js`

Current form: huge `DPH / Classifieds` wordmark, "Sign in to continue", email, password, "Forgot Password?", "Still missing the reset email?", "Resend confirmation email", "Sign In", and a Sign Up link at bottom.

**Change:**
- Replace the giant logo with a single-line `DPH Classifieds` text mark, ~28pt, top-aligned.
- Remove the "Still missing the reset email?" caption and the "Resend confirmation email" link from the primary login surface. Move both onto `CheckEmailScreen` (where they belong contextually).
- Keep: email, password, Forgot Password (right-aligned under password), Sign In button, "Don't have an account? Sign Up" at the bottom.
- Add a small Google sign-in button below Sign In (existing `signInWithGoogle` in AuthContext is wired but the screen doesn't surface it). One-tap login is faster than typing on mobile.

**Acceptance:** Login form's primary controls (email + password + Sign In) fit above the iOS keyboard on iPhone 14 (390pt wide).

### 1.5 Fix back-button labels

**File:** `mobile/src/navigation/AppNavigator.js`

Frames 9, 27, 29, 31 show `< ExploreMain`, `< ProfileMain`, `< Admin` as back labels.

**Change:**
- Apply `headerBackTitle: 'Back'` (or `headerBackTitleVisible: false`) to `screenOptions` for all inner stacks. With `native-stack` on iOS, the default uses the previous screen's `title`; since the entry screen has `headerShown: false`, RN falls back to the route name.
- Where a context-specific label is better (e.g. `CarDetail` should say "Explore" or "Saved" depending on which stack reached it), keep the existing `headerBackTitle: 'Explore'` / `'Saved'` overrides — they're correct.

**Acceptance:** no screen header shows a raw route name.

---

## Phase 2 — Admin Console rework (single PR)

### 2.1 Dashboard reorganization

**File:** `mobile/src/screens/admin/AdminDashboardScreen.js`

Today the page is: title → time-range pills → 13 KPI cards → live visitors → lead mix → activity trend → pending approvals → dealers → recent reports → external analytics → quick actions. Quick Actions is at the BOTTOM. The most actionable content is below the fold.

**New top-to-bottom order:**
1. **Inbox** (new, above the fold) — three large tap cards in a single row, color-coded:
   - `N Pending Approvals` (warning)
   - `N Open Reports` (error)
   - `N Dealer Reviews` (info)
   Each card taps to its respective list. This replaces the bottom "Quick Actions" section.
2. **Live Visitors sparkline** (existing).
3. **Time-range pills** (existing) + **headline KPIs**: 4 cards only — Total Users, Total Listings (cars+bikes+plates+parts summed), Total Leads, Total Views.
4. **"Show all metrics" expander** — taps to reveal the other 9 KPI cards.
5. **Lead Mix** (existing).
6. **Activity Trend (7 days)** (existing).
7. **Recent Reports + Dealers** (existing, density tightened — see 2.2).
8. **External Analytics**: ONLY render when the env var is set. If not configured, the card simply doesn't appear. Today the disabled cards render dimmed with "Add EXPO_PUBLIC_GA4_MEASUREMENT_ID to env" — that text is for the developer, not the operator.

`QUICK_ACTIONS` array and the bottom Quick Actions section are deleted. The Inbox at the top replaces them.

### 2.2 Admin list density and swipe actions

**Files:** `mobile/src/screens/admin/AdminUsersScreen.js`, `AdminListingsScreen.js`, `AdminDealersScreen.js`, `AdminReportsScreen.js`

Current rows show 4 lines (name, email, phone, joined date). For 100+ users that's a lot of scroll.

**Change:**
- Row layout becomes 2 lines: **line 1** name + status badges; **line 2** one meta line (email for users, listing title for listings, company for dealers, reason for reports).
- Tap → existing detail screen (unchanged).
- On `AdminReportsScreen` and the "Pending Approvals" view on `AdminListingsScreen`, add swipe actions using `react-native-gesture-handler`'s `Swipeable` (already in the dependency tree via `@react-navigation/*`):
  - Swipe left → reject / dismiss
  - Swipe right → approve / resolve
- No swipe actions on `AdminUsersScreen` — users are reviewed, not actioned.

### 2.3 Apply singular/plural type helper

**Files:** any admin screen that builds `/api/.../${listing_type}/...` URLs.

The recent fix added `toPluralType`/`toSingularType` inline in `MyListingsScreen.js`. For Phase 2, extract them to `mobile/src/utils/listingType.js` and import wherever admin screens construct listing URLs from `item.listing_type` (currently `AdminListingsScreen.js:217` uses `item.listing_type || 'cars'` directly).

---

## Phase 3 — Sell 3-step wizard

**File:** `mobile/src/screens/listing/PostListingScreen.js` (currently 2,432 lines)

Today after category selection the user sees one long scrollable form with collapsible sections. We split this into a wizard.

### 3.1 Wizard structure

After the existing category picker:

**Step 1 — Photos**
- Title: "Show your <category>"
- Single big drop zone, "Add Photos (0/10)"
- Camera shortcut for first photo
- For Car: a "Scan Mulkiya" CTA right under the photo grid — one tap fills make/model/year/VIN in step 2.
- "Continue →" button (disabled until ≥1 photo).

**Step 2 — Essentials**
- Title: "The basics"
- Only the truly required fields:
  - Car: Make, Model, Year, Mileage, Price, Emirate
  - Bike: Brand, Model, Year, Mileage, Price, Emirate
  - Plate: City, Code, Number, Price
  - Parts: Type, Condition, Price, Emirate
- Smart defaults pre-filled:
  - Year → current year
  - Condition → Used
  - Regional Spec → GCC
  - Country code → +971
  - Seller name/email → from `user`
  - Emirate → last-used (persisted)
- "Continue →" (disabled until required fields filled).

**Step 3 — Details (all optional) + Review**
- One screen with all the existing collapsible sections (Specifications, Extra Features, Description, Location pin) — all OPTIONAL.
- Inline summary at top showing photo count + essentials, with edit links jumping back to prior steps.
- "Post Listing" button at bottom.

### 3.2 Implementation approach

- Keep `PostListingScreen` as the parent. Internally use a `step` state (1/2/3) instead of one giant render.
- Extract each step into a sub-component file under `mobile/src/screens/listing/post-steps/` (`StepPhotos.js`, `StepEssentialsCar.js`, `StepEssentialsBike.js`, etc.). Keeps each file small and focused.
- Form state (carForm, bikeForm, plateForm, partsForm, images) stays in the parent so navigating between steps doesn't lose data.
- Back button on Step 1 = back to Category. On steps 2/3 = previous step.
- Edit mode (when entered via MyListings → Edit) skips Step 1's CTA copy and dumps the user directly on a single combined "edit everything" view — wizards make sense for first creation, not for tweaking one field.

### 3.3 Smart defaults persistence

- After a successful post, save `last_emirate`, `last_area`, `last_country_code` to AsyncStorage.
- Next session reads these as initial form values.

---

## Architecture / file map

```
mobile/src/
  navigation/AppNavigator.js          # remove isLoading gate; fix back labels; collapse gated stacks
  context/AuthContext.js              # hydrate from AsyncStorage; tolerate transient backend disagreement
  utils/listingType.js                # NEW — toPluralType / toSingularType
  utils/swrCache.js                   # existing — used by Explore now too
  components/ui/RequireAuth.js        # useAuthGate(redirectRoute) hook; drop the wrapper UI
  screens/auth/LoginScreen.js         # slim form; add Google button; remove dev-recovery clutter
  screens/explore/ExploreScreen.js    # SWR cache; no skeleton on warm tab
  screens/listing/PostListingScreen.js          # becomes a thin step coordinator
  screens/listing/post-steps/StepPhotos.js      # NEW
  screens/listing/post-steps/StepEssentialsCar.js   # NEW (and bike/plate/parts variants)
  screens/listing/post-steps/StepDetails.js     # NEW (handles all four categories + review)
  screens/admin/AdminDashboardScreen.js          # Inbox up top; collapsed KPI grid; remove disabled cards
  screens/admin/AdminUsersScreen.js              # 2-line rows
  screens/admin/AdminListingsScreen.js           # 2-line rows + swipe actions on pending queue
  screens/admin/AdminDealersScreen.js            # 2-line rows + swipe actions on review queue
  screens/admin/AdminReportsScreen.js            # 2-line rows + swipe actions
```

## Risks and mitigations

- **Auth cache could go stale.** A deactivated/banned user could see authed UI for one render before the backend revokes. Mitigation: backend `/api/auth/me` runs in the background on every cold start; on confirmed `is_active=false`, clear cache and sign out.
- **SWR cache eats storage.** Cap each cache entry to 100 listings; expire after 24h on cold read.
- **Swipe actions on admin queues are destructive.** Show a confirmation toast with an Undo for 5 seconds before committing the approve/reject.
- **Wizard back navigation could lose form state.** All form state lives in the parent — moving between steps is a pure state change, not a navigator push.

## Out of scope (future)

- Search/filter UX on Explore (the recording didn't show pain there).
- Push notifications for admin queues.
- Bulk approve in admin (could come after swipe actions land and we see usage).
- Pull-to-refresh harmonization across all tabs (the recent auth fix already resolved the bounce-to-login; spinner consistency is cosmetic).

## Phasing

Three commits in three PRs, in order:
1. Phase 1 (speed + login). Highest-impact, smallest diff.
2. Phase 2 (admin console). Single PR per user's choice.
3. Phase 3 (Sell wizard). Largest lift; ship after 1 and 2 are validated in production.
