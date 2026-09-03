# DPHClassifieds Light-Mode Parity + Smoother Legal Pages

Date: 2026-09-03
Status: Approved

## Problem

The consumer-facing app has two theme systems that conflict:

1. **`--ex-*` tokens** (in `ExplorePage.css`) are properly theme-aware — they switch between light and dark values when `<html class="dark">` toggles.
2. **`--ex-shell-*` tokens** (in `ExplorePage.css` and `shell-tokens.css`) are intentionally locked to dark values in both themes. They are reserved for the admin and dealer portals, which are dark-by-design.

The bug: consumer pages (Header, Footer, Login, Signup, CheckEmail, ForgotPassword, ResetPassword, About, Privacy, Terms, Contact) and the global body/root all **bleed through to dark regardless of theme**:

- `body` background is forced black in `App.css` and `index.css`.
- `Header.js` uses `surfaceDark` (a hard-coded `#040806`) and hardcoded `text-white` / `bg-white/X` utilities.
- Footer uses `--ex-shell-*` tokens, which are dark in both themes.
- `Auth.css` defines an entirely separate hardcoded dark palette (`--auth-bg: #0a0a0a`, `--auth-text: #f0f0f0`, etc.).
- `About.css` defines yet another hardcoded dark palette (`--ab-bg`, dark gradients, `--ex-shell-text` references).
- Privacy Policy and Terms of Use share About.css, so they are dark too — and the legal text is dense with no TOC.

The "Classifieds" wordmark in the navbar uses `--ex-accent-green` (dark in light, mint in dark) while the footer uses `--ex-shell-accent` (always mint). They visually disagree.

## Goal

Full light-mode parity for every consumer page: the entire site reads correctly in both light and dark themes. Admin/dealer portals remain unchanged (still dark-by-design via `--ex-shell-*`). The legal pages get a calmer editorial layout with a TOC. The navbar and footer share a single brand accent.

## Design

### 1. Single shared brand accent

Promote one brand accent token used everywhere a "Classifieds" wordmark or primary CTA appears. This eliminates the navbar ↔ footer color disagreement.

- Add to `ExplorePage.css` `:root` and `.dark` blocks:
  - `--ex-brand-accent: #0b6b4c` (light) / `#8bd6b4` (dark)
  - `--ex-brand-accent-soft: rgba(11, 107, 76, 0.08)` (light) / `rgba(139, 214, 180, 0.14)` (dark)
- Keep `--ex-accent-green` and `--ex-primary` as alias definitions of `--ex-brand-accent` for backwards compatibility with existing callers.
- Add `brandAccent` and `brandAccentBg` exports to `frontend/src/lib/themeClasses.js`. Existing `accentText`, `accentBg`, `primaryText`, `primaryBg` stay (now aliases for the same token via CSS).

### 2. Body/root colors respect theme

`App.css` and `index.css` currently hardcode black-on-white body styles that every consumer page inherits.

- Remove `background-color: #000` and `color: #ffffff` from `body` rules in both files.
- Replace with `body { background-color: var(--ex-page-bg); color: var(--ex-text); }`.
- Update scrollbar and selection rules in both files to read from theme tokens (`--ex-line`, `--ex-brand-accent`).

### 3. Header is theme-aware

`Header.js` is the fixed top bar that appears on every consumer route. Today it uses `surfaceDark` and hardcoded `text-white` / `bg-white/X` utilities.

- Replace the `surfaceDark` background with `bg-[color:var(--ex-surface)]/85` and keep the existing backdrop-blur.
- Replace `text-white` on the logo and primary nav with `text-[color:var(--ex-text)]`.
- Replace `text-white/75` muted nav with `text-[color:var(--ex-text-muted)]/85`.
- Replace `bg-white/8`, `bg-white/10`, `bg-white/5`, `border-white/10`, `border-white/20` etc. with `bg-[color:var(--ex-brand-accent)]/10` for hover, `bg-[color:var(--ex-brand-accent)]/15` for active, and `border-[color:var(--ex-line)]` for borders.
- Replace `text-white/55`, `text-white/60`, `text-white/40` with `text-[color:var(--ex-text-muted)]/70`.
- The "Sign Up" CTA gradient already uses `#8bd6b4 → #004e37`. Key the mint endpoint off `var(--ex-brand-accent)` so the same gradient reads in light and dark.
- Mobile sheet background → `bg-[color:var(--ex-page-bg)]/98` with `text-[color:var(--ex-text)]` text.

### 4. Footer is theme-aware

`hover-footer.jsx` and `hover-footer.css` use `--ex-shell-*` tokens (locked to dark).

- Replace `--ex-shell-bg`, `--ex-shell-text`, `--ex-shell-accent`, `--ex-shell-text-muted`, `--ex-shell-on-accent` with the equivalent theme-aware tokens:
  - bg → `var(--ex-surface)` (panel) and `var(--ex-page-bg)` (outer wrapper)
  - text → `var(--ex-text)`
  - accent → `var(--ex-brand-accent)`
  - muted text → `var(--ex-text-muted)`
- The "DPHClassifieds" wordmark then uses the same accent token as the navbar.

### 5. Login / Signup / Check-email / Verify / Forgot / Reset are theme-aware

`Auth.css` defines a parallel hardcoded palette (`--auth-bg: #0a0a0a`, etc.). Every consumer auth route uses this stylesheet.

- Convert the `--auth-*` palette to read from `--ex-*` tokens:
  - `--auth-bg` → `var(--ex-page-bg)`
  - `--auth-surface` → `var(--ex-surface)`
  - `--auth-surface-strong` → `var(--ex-surface)`
  - `--auth-surface-soft` → `var(--ex-surface-high)`
  - `--auth-line` → `var(--ex-line)`
  - `--auth-line-strong` → `var(--ex-line-strong)`
  - `--auth-text` → `var(--ex-text)`
  - `--auth-text-muted` → `var(--ex-text-muted)`
  - `--auth-accent` → `var(--ex-brand-accent)`
  - `--auth-accent-strong` → `var(--ex-primary-strong)`
  - `--auth-danger-bg` stays as-is (red, not theme-tied)
  - `--auth-success` and `--auth-success-bg` use `--ex-brand-accent`
- Remove the dark gradient on `.auth-container` and let `var(--ex-page-bg)` paint the surface.
- Replace hardcoded `option { background: #0d1f15 }`, `option { background: #1a1a1a }`, `select { background: ... svg }` color references so they read from theme tokens (the SVG fill can stay since select chrome is fine in both themes).
- Field autofill `-webkit-box-shadow: 0 0 0px 1000px rgba(13, 31, 21, 0.96) inset` becomes theme-driven (use a small color-mix over `--ex-surface`).
- Required-asterisk color (`#ff9e9e`) stays — not theme-tied.

### 6. About is theme-aware

`About.css` defines `--ab-*` colors that mostly reference `--ex-shell-*` (dark-only) plus hardcoded dark backgrounds and gradients.

- Replace `--ab-bg`, `--ab-surface`, `--ab-surface-soft`, `--ab-line`, `--ab-text`, `--ab-text-muted` values with theme-aware ones:
  - bg → `var(--ex-page-bg)`
  - surface → `var(--ex-surface)`
  - surface-soft → `var(--ex-surface-high)`
  - line → `var(--ex-line)`
  - text → `var(--ex-text)`
  - text-muted → `var(--ex-text-muted)`
- Remove the dark gradient on `.about-v2` body. Let `var(--ex-page-bg)` paint.
- Button gradients on `.about-v2-button-primary` already use `--ex-primary` / `--ex-primary-strong` — keep, since both are now stable across themes via the brand accent token.

### 7. Privacy Policy + Terms of Use — editorial layout

Both pages reuse About.css today. Same theme fix applies, plus a calmer reading experience.

New shared component: **`LegalLayout.jsx`** (in `frontend/src/components/legal/`).

- Props:
  - `eyebrow` (string, e.g. "Legal")
  - `title` (string, H1)
  - `summary` (string, optional one-line subtitle)
  - `effectiveDate` (string)
  - `sections` (array of `{ id, title, level }`) — optional. If provided, TOC is built from this. If not, TOC is derived by scanning the rendered children for elements with `[data-legal-section]` attributes.
  - `children` (the body)
- Layout (≥1024px): two-column grid — left rail sticky TOC, right column reading column max 70ch.
- Layout (<1024px): TOC collapses to a `<details>` element above the article.
- Top of reading column: thin progress bar that fills as the user scrolls through the document.

New hook: **`useScrollSpy.js`** (in `frontend/src/hooks/`).

- Uses `IntersectionObserver` to track which `[data-legal-section]` element is currently most visible.
- Returns the active section's id. Component highlights the matching TOC link.

Adoption:

- `PrivacyPolicy.js` and `TermsOfUse.js` wrap their existing content in `<LegalLayout>`.
- Every existing `<h2>` becomes `<h2 data-legal-section="section-N-slug" id="section-N-slug">`.
- The TOC rail lists each section with anchor links.
- Reading-column styling: line-height 1.75, max-width 70ch, soft text-muted body, H2 with brand-accent left border or numbered prefix.
- Tables (Privacy has them) get a soft card chrome (rounded panel, alternating row tint, sticky header on wide screens).

### 8. Out of scope

- Admin and Dealer portals — dark-by-design via `--ex-shell-*`, untouched.
- Theme toggle UX — already exists, no change.
- Changing legal copy.
- Other consumer pages (ExplorePage, CarList, CarParts, etc.) — they already use `--ex-*` and will automatically read correctly once the body fix lands. Verification confirms.
- Print stylesheet — not requested.

## Files to modify

- `frontend/src/components/ExplorePage.css` — add brand-accent tokens, alias existing tokens
- `frontend/src/lib/themeClasses.js` — add brand-accent exports
- `frontend/src/App.css` — body/scrollbar theme-aware
- `frontend/src/index.css` — body/scrollbar theme-aware
- `frontend/src/components/Header.js` — theme-aware surfaces
- `frontend/src/components/ui/hover-footer.jsx` — theme-aware tokens
- `frontend/src/components/ui/hover-footer.css` — theme-aware tokens
- `frontend/src/styles/Auth.css` — convert `--auth-*` to `--ex-*`
- `frontend/src/styles/About.css` — theme-aware `--ab-*`
- `frontend/src/components/legal/LegalLayout.jsx` (new)
- `frontend/src/components/legal/LegalLayout.css` (new)
- `frontend/src/hooks/useScrollSpy.js` (new)
- `frontend/src/components/PrivacyPolicy.js` — adopt LegalLayout, add anchor ids
- `frontend/src/components/TermsOfUse.js` — adopt LegalLayout, add anchor ids

## Verification

Before claiming done:

1. **Lint:** `cd flask-react-supabase-app/frontend && npx eslint src/`
2. **Typecheck:** `cd flask-react-supabase-app/frontend && npx tsc --noEmit` if configured, otherwise confirm `package.json` `scripts` show what to run.
3. **Tests:** `cd flask-react-supabase-app/frontend && npm test -- --watchAll=false` (or `npx react-scripts test --watchAll=false`). Repo has `Header.test.jsx`, `ExplorePage.test.jsx`, `MyListings.test.jsx`, `CarList.test.jsx`, `ChunkLoadGuard.test.jsx`, etc.
4. **Visual:** Manual run-through of Home, CarList, CarDetail, CarParts, Plates, Bikes, Login, Signup, CheckEmail, ForgotPassword, ResetPassword, About, Privacy, Terms, Contact, Profile — toggle theme; confirm every page reads correctly in both.
5. **TOC sanity:** Privacy Policy and Terms of Use TOC links jump to anchors; scrollspy updates active item as user scrolls; mobile TOC `<details>` opens/closes.
6. **No carry-over:** `git status --porcelain` and `git diff --stat` show only files in this scope, not unrelated modifications.