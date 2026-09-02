# DPHClassifieds Theme + Filters Redesign — Design Spec

**Date:** 2026-09-02
**Owner:** Mobile + Web + Backend
**Status:** Approved (per user — "fix it all end to end", scoped to bug fix + Item 3 web theming for this session)
**Scope:** One bug fix + web site-wide theming. Mobile theme rollout (Item 1) and backend filter parity (Item 2) are out of scope for this session and will follow in later sessions, governed by their own plans.

---

## 1. Background and verified state (this session, fresh ground truth)

This spec was created from a fresh shell session after a previous session's context dump was found to be inaccurate. Every claim below was verified by reading the repo on 2026-09-02, in worktree `feat/theme-and-filters-rollout`.

### Verified facts

- **Monorepo structure**: `flask-react-supabase-app/frontend`, `flask-react-supabase-app/mobile`, `flask-react-supabase-app/backend`. No top-level `mobile/` or `web/`.
- **Mobile ThemeContext** at `flask-react-supabase-app/mobile/src/context/ThemeContext.js`: exports `ThemeProvider` + `useTheme()`. Default `light`, AsyncStorage key `dph-mobile-theme`, mounted at `mobile/app/_layout.tsx:72`.
- **Mobile shell wiring**: only `SettingsScreen.js` and `AndroidTabBar.js` currently consume `useTheme()` (verified by `grep -rln "useTheme" mobile/src/`). The prior-session claim of "8 sites" was wrong.
- **Backend `/api/cars`** accepts car-parity filters at `app.py:6617-6696` (Reddit handling) and `app.py:6625-6644` (allowed_filters whitelist). Helper `_collect_listing_filter_pairs` at `app.py:806-826`.
- **Backend `/api/bikes`** at `app.py:14973-15013` accepts `bike_brand`, `bike_type`, and price range. Reddit handling mirrors `/api/cars`.
- **Backend `/api/plates`** at `app.py:16799-16838` accepts `city`, `digits`. Same Reddit pattern.
- **Backend `/api/parts`** at `app.py:17128-17167` accepts some filters (line shows `_collect_listing_filter_pairs` already in use).
- **Backend `/api/listings/counts`** at `app.py:6554-6574` ignores request.args; chip counts always show global totals.
- **`_should_hide_reddit`** at `app.py:18898-18906`: returns `bool(exclude_reddit) or not reddit_on_explore`. With no `exclude_reddit` param and admin flag off (default), hides Reddit rows.
- **Web `--ex-*` tokens** defined at `frontend/src/components/ExplorePage.css:9-43`: `--ex-page-bg`, `--ex-surface-low/-/-high`, `--ex-line/-strong`, `--ex-text/-muted`, `--ex-primary/-strong`, `--ex-brand-subtle-bg`, `--ex-input-bg`, `--ex-overlay-scrim`, `--ex-card-shadow`. Light default on `:root`, dark on `.dark`. Toggle driven by `<html class>` via ThemeContext.
- **Web pages already themed** (verified by reading): Explore, Header toggle button, browse pages (CarList, CarParts, BikesRedesigned, PlatesRedesigned), buying-requests, shared CTA, SearchableSelect dropdown.
- **Web pages still hardcoded dark** (verified): Header visual styling (toggle works but visual literals don't), HomePage inline literals at lines 46, 48, CarDetailRedesigned (`--cd-*` overrides only on `prefers-color-scheme`), MyListings, auth pages (Login/Signup/ForgotPassword/ResetPassword/CheckEmail/VerifyPhone/PhoneGate/PhoneVerificationFlow/AuthCallback/SupabaseCaptcha), dealer portal pages, admin portal pages.

### The CarList "Hide Reddit" bug — CONFIRMED REAL

`frontend/src/components/CarList.jsx:48-69` defines `exclude_reddit: false` as default. Lines 204-207:
```js
Object.entries(activeFilters).forEach(([key, value]) => {
  if (value) params.append(key, value);
});
```
Skips `false` values. Backend default hides Reddit anyway (`_should_hide_reddit(False, False, False) → True`). UI label "Hide Reddit listings" with box UNCHECKED reads "show Reddit listings" but returns 0 Reddit rows. Same conceptual bug Explore had pre-fix.

### Baseline test state (verified this session)
- Backend pytest: `test_listing_filter_pairs.py` 5/5 passes.
- Frontend `react-scripts test`: 60/62 pass. 2 pre-existing failures in `src/components/ExplorePage.test.jsx` (bounded feed rendering tests) — unrelated to this work.
- `npx tsc --noEmit`: passes.
- Backend `app.py` parses with `ast`.

### Not in this session's scope
- Mobile theme rollout across 86 files (a separate Item 1 plan exists in concept; deferred to later session).
- Backend filter parity (bikes/plates/parts accept car-parity fields; counts route honors filters). Separate Item 2 plan deferred.
- Explore client→server filter migration. Deferred with Item 2.
- iOS NativeTabs tintColor (`mobile/app/(tabs)/_layout.tsx:16` hardcoded `#4CAF50`). No iOS simulator available; documented as known issue.

---

## 2. Goals (this session)

- **Bug fix**: CarList URL builder always sends `exclude_reddit` explicitly (true or false), matching UI label semantics. Verified via TDD red-green with a frontend test and a backend regression test.
- **Web site-wide theming**: Every page on the web app responds to the light/dark theme toggle. Header visual styling uses `--ex-*` tokens. CarDetailRedesigned's `--cd-*` palette has a `.dark` override. HomePage, MyListings, and the highest-traffic remaining pages migrated to `var(--ex-*)`.
- **Brand invariants preserved**: Google logo, Stripe brand colors, OAuth provider buttons stay hardcoded (out of theme scope).
- **Verification triad passes**: tsc + frontend tests + backend tests all green (modulo the 2 pre-existing ExplorePage test failures, which we will not regress).

## 3. Architecture decisions

### AD-1: Web theme tokens extended, not replaced
`ExplorePage.css:9-43` defines `--ex-*` on `:root` (light) and `.dark` (dark). Pages that don't currently import it (Header.js, MyListings.js, etc.) import it via `import './ExplorePage.css';` at the top, then replace hardcoded literals with `var(--ex-*)`.

### AD-2: Detail-page palettes get a `.dark` override
`CarDetailRedesigned.css` defines `--cd-*` on `:root` with `@media (prefers-color-scheme: dark)` overrides. The toggle-driven `.dark` class does not match the `prefers-color-scheme` media query, so dark mode does not apply when the user explicitly toggles it. Fix: copy the `prefers-color-scheme: dark` values into a `.dark :root, .dark .cd-*` block so the toggle drives them too. Same pattern for any other page that defines its own palette.

### AD-3: themeClasses helper for repeated Tailwind literals
Repeated Tailwind arbitrary-value classes (`bg-[color:var(--ex-surface)]`, `text-[color:var(--ex-text)]`, etc.) go into `frontend/src/lib/themeClasses.js`. Migrated files import named classes, e.g.:
```js
import { surfaceBg, textPrimary } from '../lib/themeClasses';
// className={`${surfaceBg} ${textPrimary}`}
```
Rationale: keeps the CSS-var mapping in one place, easier to audit and to grep for missed literals.

### AD-4: CarList Reddit fix uses explicit `exclude_reddit=false`
URL builder always sends `exclude_reddit` (true or false explicitly) on car-list fetches. This preserves the existing UI label "Hide Reddit listings" semantics without changing the backend default. New regression test verifies all three states (no param, false, true) produce the expected row counts.

---

## 4. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Edit tooling reformats a file producing a >100-line diff for a semantic <20-line change (AGENTS.md §7.2) | After each `Edit`/`Write`, run `git diff --stat -- <path>`. If diff >2x expected, `git checkout HEAD -- <path>` and re-apply surgically. |
| Detail-page `.dark` override breaks existing `prefers-color-scheme` behavior | Keep the `prefers-color-scheme` block as-is; add the `.dark` block alongside it. Verify both paths still work. |
| CarList fix breaks callers that omit the param | The CarList fetcher is the only caller that toggles `exclude_reddit` in the filter UI; other callers don't change. Backend default behavior unchanged. |
| Pre-existing 2 ExplorePage test failures attributed to my changes | Run `react-scripts test` baseline before any edit. Don't include these tests in my regression report. |
| `git diff --stat` reveals scope creep | Per §7.1, before each commit run `git status --porcelain` and `git diff --stat` to confirm only intended paths. |

---

## 5. Acceptance criteria

### Bug fix — CarList Reddit
- `frontend/src/components/CarList.jsx` URL builder always sends `exclude_reddit=true|false` explicitly (TDD verified).
- New test in `frontend/src/components/CarList.test.jsx` (or `__tests__/`) covers all three cases.
- New backend regression test covers all three cases via `/api/cars`.
- Backend default behavior unchanged (preserves compatibility for callers that don't send the param).
- 60/62 frontend tests pass (the 2 pre-existing failures unchanged).

### Web site-wide theming (Item 3, this session)
- Every file listed in the Item 3 plan migrates without leaving hardcoded dark literals.
- `npx tsc --noEmit` clean.
- `npm run build` clean.
- `npm test` shows no new failures.
- Visual sanity check (manual, documented) confirms Header, HomePage, MyListings, and CarDetailRedesigned respond to theme toggle.
