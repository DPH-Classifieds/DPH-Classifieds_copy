# Item 3: Web Site-Wide Theming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:test-driven-development (per task), superpowers:subagent-driven-development (for parallel file work), superpowers:verification-before-completion (before any completion claim).

**Goal:** Make every remaining web page respond to the light/dark theme toggle. After this plan, only brand-literal elements (Google logo, Stripe brand colors, OAuth provider buttons) remain hardcoded.

**Architecture:** Extend the existing `--ex-*` token system in `ExplorePage.css`. Pages that already import `ExplorePage.css` get the tokens for free; they may just need to replace inline literals with `var(--ex-*)`. Pages with their own palette (e.g. `--cd-*` on detail pages) get a `.dark` override added.

**Tech Stack:** React 18, Vite, Tailwind, CSS custom properties.

---

## Tokens

Already defined at `frontend/src/components/ExplorePage.css:9-43`:

```
--ex-page-bg              --ex-surface-low          --ex-surface
--ex-surface-high         --ex-line                 --ex-line-strong
--ex-text                 --ex-text-muted           --ex-primary
--ex-primary-strong       --ex-brand-subtle-bg      --ex-input-bg
--ex-overlay-scrim        --ex-card-shadow
```

If a migrated file needs a token that doesn't exist, ADD it to the same `:root` and `.dark` blocks in `ExplorePage.css`. Don't scatter token definitions across files.

---

## Files in this plan (verified scope, this session)

### A. Add new shared tokens (1 task)
Some Header literals use `#8bd6b4` (a brighter green) and `rgba(4,16,8,*)` (a darker surface) that don't have direct tokens yet. Add:
- `--ex-surface-dark` — `#040806` (header scrim base)
- `--ex-accent-green` — `#8bd6b4` (primary mint highlight)

### B. Create themeClasses helper (1 task)
**File:** `frontend/src/lib/themeClasses.js` (new file)
Exports named Tailwind class strings that wrap `var(--ex-*)`:
```js
export const surfaceBg = 'bg-[color:var(--ex-surface)]';
export const surfaceHigh = 'bg-[color:var(--ex-surface-high)]';
export const surfaceDark = 'bg-[color:var(--ex-surface-dark)]';
export const pageBg = 'bg-[color:var(--ex-page-bg)]';
export const line = 'border-[color:var(--ex-line)]';
export const textPrimary = 'text-[color:var(--ex-text)]';
export const textMuted = 'text-[color:var(--ex-text-muted)]';
export const brandBg = 'bg-[color:var(--ex-brand-subtle-bg)]';
export const accentText = 'text-[color:var(--ex-accent-green)]';
export const accentBg = 'bg-[color:var(--ex-accent-green)]';
```
Use these in every migrated file instead of inline `var(--ex-*)` strings.

### C. Migrate Header.js (1 task)
**File:** `frontend/src/components/Header.js`
**Verified literals:** `#8bd6b4` (lines 156, 192, 297, 325, 347, 443), `rgba(4,16,8,*)` (145, 146, 190, 192, 225, 227, 228, 319), `rgba(11,35,18,0.96)` (190, 228), `from-[#8bd6b4] to-[#004e37]` (297, 443), `border-white/10` (145, 319), `border-white/5` (146, 190, 225, 227).
**Migration:** replace each literal with the corresponding `themeClasses` import. Add `import './ExplorePage.css';` at top of Header.js if missing (verify first).
**TDD red:** A unit test that mounts Header with `useTheme` returning `dark`, then asserts the header element's className does NOT contain `bg-[rgba(4,16,8,0.95)]`. Mocking pattern: pass a ThemeContext.Provider with `{theme:'dark', toggleTheme:jest.fn()}` and assert className.
**TDD green:** replace literals with classes. Test passes.

### D. Migrate HomePage.js (1 task)
**File:** `frontend/src/components/HomePage.js`
**Verified literals:** lines 46 (`from-[#0b6b4c] via-[#0a5f47] to-[#004e37] shadow-[0_18px_40px_rgba(0,78,55,0.34)] hover:from-[#0d7d58] hover:via-[#0b6b4c] hover:to-[#0a5f47]`), 48 (`bg-[rgba(255,255,255,0.06)] hover:bg-[rgba(255,255,255,0.12)]`).
**Migration:** replace with `var(--ex-primary)` etc. via themeClasses.
**TDD red:** assert HomePage output uses `var(--ex-*)` and does NOT contain `from-[#0b6b4c]`.
**TDD green:** done.

### E. Add `.dark` overrides to CarDetailRedesigned.css (1 task)
**File:** `frontend/src/components/CarDetailRedesigned.css`
**Verified:** `:root` defines `--cd-*` (lines 1-17). `@media (prefers-color-scheme: dark)` overrides at lines 19-35.
**Problem:** ThemeContext toggles `<html class="dark">` (not a media query), so when the user explicitly picks dark mode, the `prefers-color-scheme` block does not apply.
**Migration:** copy the `prefers-color-scheme: dark` values into a `.dark :root { ... }` block. Keep the `prefers-color-scheme` block as-is so the no-preference path still works.
**TDD red:** a CSS-class assertion test: render CarDetailRedesigned with `<html class="dark">`, assert the rendered `--cd-color-background-primary` resolves to `#0a0a0a`.
**TDD green:** add the `.dark :root { ... }` block with the same values.

### F. Migrate MyListings.js (1 task)
**File:** `frontend/src/components/MyListings.js`
**Verified literals:** audit first via `grep -nE "rgba\\(|[^a-zA-Z]#[0-9a-fA-F]{3,6}" MyListings.js`.
**Migration:** replace with themeClasses or `var(--ex-*)`.
**TDD red:** assert classNames don't contain hardcoded literals.
**TDD green:** done.

### G. Optional scope (deferred unless time allows)
- Auth pages (10 files) — Login/Signup/ForgotPassword/ResetPassword/CheckEmail/VerifyPhone/PhoneGate/PhoneVerificationFlow/AuthCallback/SupabaseCaptcha. Audit literals first.
- Dealer pages (`DealerLayout.jsx`, `components/dealer/*`).
- Admin pages (`AdminLayout.js`, `components/admin/*`).
- Static pages (About, PrivacyPolicy, TermsOfUse, Contact, NotFound).
- UI utilities (search-bar, hover-footer, button, GlassCard, KpiTile, SegmentedControl, EmptyState, TrendChart, ActionNoticeModal).

These are tracked here for a follow-up session. The user explicitly scoped this session to "bug fix + Item 3 web theming" with the understanding that header/HomePage/MyListings/CarDetailRedesigned are the highest-impact targets.

---

## Tasks

### Task 1: Add `--ex-surface-dark` and `--ex-accent-green` tokens
**File:** `frontend/src/components/ExplorePage.css`
Add two new lines to `:root` and `.dark` blocks. Run `git diff --stat` to confirm diff is <10 lines (sanity guard against tooling accidents).

### Task 2: Create themeClasses helper
**File:** `frontend/src/lib/themeClasses.js` (new)
No tests needed (pure constants). Visual sanity: each named export is a valid Tailwind class.

### Task 3: TDD red — Header.js
Add `frontend/src/components/__tests__/Header.test.jsx`:
- Test: Header does not render className with `bg-[rgba(4,16,8` when rendered with the dark theme.
- Test: Header still renders the brand span (`DPHClassifieds`).
Run `npm test -- Header` — confirm test FAILS (red).

### Task 4: Migrate Header.js (green)
Replace literals per Task C. Run `npm test -- Header` — confirm test PASSES (green).
Then verify by `git diff --stat -- Header.js` — diff should be bounded (≤300 lines for an 800+ line file).

### Task 5: TDD red — HomePage.js
Add test: HomePage output className does not contain `from-[#0b6b4c]`.
Run — confirm FAIL.

### Task 6: Migrate HomePage.js (green)
Replace literals per Task D. Run — confirm PASS.

### Task 7: TDD red — CarDetailRedesigned.css .dark override
Add a test that imports `CarDetailRedesigned.css` and asserts that when `document.documentElement.classList.contains('dark')`, `--cd-color-background-primary` resolves to the dark value `#0a0a0a`. Use `getComputedStyle` after applying the class.
Run — confirm FAIL (the class-only override doesn't exist yet).

### Task 8: Implement CarDetailRedesigned.css .dark block (green)
Add `.dark :root { ... }` with the dark values. Run — confirm PASS.

### Task 9: TDD red — MyListings.js
Add a smoke test that mounts MyListings and asserts its rendered className does not contain `bg-[rgba(255,255,255,0.06)]` or similar.
Run — confirm FAIL.

### Task 10: Migrate MyListings.js (green)
Replace literals per Task F. Run — confirm PASS.

### Task 11: Verification triad (final)
```
cd flask-react-supabase-app/frontend
npx tsc --noEmit
npm test                    # expect 60+ passing, 2 unchanged ExplorePage failures
npm run build               # craco build
```

### Task 12: Diff scope verification (§7.1)
```
git status --porcelain
git diff --stat
```
Each modified file's diff should match the semantic change. If any file shows a >2x diff relative to the change intent, `git checkout HEAD -- <path>` and reapply surgically.

---

## Out of scope (deferred)

- Mobile theme rollout (Item 1, separate plan)
- Backend filter parity + counts (Item 2, separate plan)
- iOS NativeTabs tintColor (no simulator)
- Auth/dealer/admin static page migrations (Task G above) — defer to follow-up session; the brand-critical pages (Header, HomePage, MyListings, CarDetailRedesigned) cover the highest-traffic user paths.
