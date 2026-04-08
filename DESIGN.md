# Design System Document: DPH Classifieds

## 1. Overview & Creative North Star
DPH Classifieds is an automotive marketplace built for the UAE region, serving petrolheads with a curated selection of cars, bikes, and license plates. The design philosophy centers on **Dark Premium Luxury** — a dark, sophisticated aesthetic that puts vehicles front and center while providing a seamless browsing and listing experience.

The interface uses intentional dark tones inspired by premium automotive showrooms, with accent colors that evoke trust and action. The goal is a platform that feels like a high-end dealership floor — clean, professional, and focused on the product.

---

## 2. Color Palette

### Primary Colors
*   **Surface / Background:** `#111414` (Deep charcoal black)
*   **Surface Container Low:** `#1a1d1d` (Slightly elevated surface)
*   **Surface Container:** `#222525` (Card backgrounds)
*   **Surface Container Highest:** `#323535` (Interactive elements, inputs)

### Accent Colors
*   **Primary:** `#8bd6b4` (Soft mint green - CTAs, links, highlights)
*   **Primary Container:** `#004e37` (Darker green for gradients)
*   **Secondary:** `#a8b4ac` (Muted silver - secondary text, borders)
*   **On Surface:** `#ffffff` (Primary text)
*   **On Surface Variant:** `#bfc9c4` (Secondary text, metadata)

### Status Colors
*   **Success:** `#4caf50` (Verified badges, positive states)
*   **Warning:** `#ff9800` (Imported, special badges)
*   **Info:** `#2196f3` (Insurance, additional info)
*   **Error:** `#f44336` (Error states)

### The "No-Line" Rule
Borders are minimized. Use tonal shifts between surface layers to define space. A `surface-container-low` section sits against a `surface` background. Content separation uses 24px-32px vertical gaps or subtle luminance shifts between container levels.

---

## 3. Typography: Plus Jakarta Sans

The system uses **Plus Jakarta Sans** exclusively for a modern, geometric feel that mirrors automotive dashboards.

*   **Display (lg/md/sm):** Hero headlines and vehicle names. Tight letter-spacing (-0.02em).
*   **Headline & Title:** Section headers, technical specs. Bold and authoritative.
*   **Body (lg/md/sm):** Descriptions, metadata. Uses `on-surface-variant` for reduced eye strain.
*   **Labels:** All-caps with increased letter-spacing (+0.05em) for category tags.

---

## 4. Elevation & Depth

*   **Tonal Layering:** Place `surface-container-highest` cards on `surface-dim` backgrounds. The luminance delta creates a "soft lift" without drop shadows.
*   **Ambient Effects:** Hero sections use gradient overlays (vignette + glow) to create depth and focus.
*   **Ghost Borders:** If a stroke is needed for accessibility, use `outline-variant` at 15% opacity. Never use 100% opaque lines.

---

## 5. Component Naming Conventions

The codebase uses prefix-based naming for component isolation:

### HomePage Components (cn- prefix)
*   `cn-home` - Main container
*   `cn-hero` - Hero section
*   `cn-shell` - Max-width wrapper (1200px)
*   `cn-kicker` - Eyebrow text above headings
*   `cn-display-title` - Hero headline
*   `cn-button cn-button-primary` - Primary CTA
*   `cn-button cn-button-secondary` - Secondary CTA
*   `cn-insight-band` - Stats section
*   `cn-insight-card` - Individual stat cards
*   `cn-explore-section` - Explore page promo
*   `cn-collection-grid` - 3-column card grid
*   `cn-collection-card` - Promo cards
*   `cn-listings-section` - Latest listings
*   `cn-listings-grid` - Car listing grid
*   `cn-listing-card` - Individual car cards
*   `cn-brand-strip` - Brand marquee
*   `cn-brand-marquee` - Scrolling brand names
*   `cn-cta-section` - Call-to-action section

### CarDetail Components (cd- prefix)
*   `cd-container` - Main container
*   `cd-max-width` - Content wrapper
*   `cd-breadcrumb` - Navigation breadcrumb
*   `cd-title-block` - Title and meta area
*   `cd-hero-grid` - Main content grid (2-column)
*   `cd-hero-left` - Image gallery area
*   `cd-hero-right` - Sidebar (price, seller)
*   `cd-main-image` - Primary vehicle image
*   `cd-gallery-strip` - Thumbnail strip
*   `cd-price-card` - Price display with badges
*   `cd-seller-card` - Seller information
*   `cd-content-grid` - Secondary content grid
*   `cd-specs-list` - Specifications table
*   `cd-location-card` - Map/location area
*   `cd-loan-card` - Loan calculator

### Profile Components (profile- prefix)
*   `profile-container` - Main wrapper
*   `profile-header-banner` - Page header with gradient background
*   `profile-page-title` - Page title
*   `profile-page-subtitle` - Subtitle text
*   `profile-content-wrapper` - Inner content container
*   `profile-completion-card` - Profile completion progress
*   `completion-header` - Completion card header
*   `completion-percentage` - Percentage display
*   `completion-bar` - Progress bar container
*   `completion-fill` - Progress bar fill
*   `completion-message` - Helper text
*   `completion-stats` - Field count display
*   `profile-card` - Main profile card (modern-card)
*   `profile-header-section` - Avatar and basic info area
*   `profile-avatar-section` - Avatar container
*   `profile-avatar-large` - Large avatar image
*   `profile-photo-overlay` - Hover overlay for photo change
*   `change-photo-btn` - Photo change button
*   `profile-basic-info` - Name and badges area
*   `profile-name` - User name display
*   `profile-username` - Username with @ prefix
*   `profile-badges` - Badge container
*   `badge badge-verified` - Email/phone verified
*   `badge badge-dealer` - Dealer badge
*   `badge badge-dealer-verified` - Verified dealer
*   `badge badge-admin` - Admin badge
*   `member-since` - Account age text
*   `profile-bio-section` - User bio area
*   `profile-statistics` - Activity stats section
*   `stats-grid` - Statistics grid layout
*   `stat-item` - Individual stat card
*   `stat-number` - Stat numeric value
*   `stat-label` - Stat label text
*   `profile-details` - Contact and account details
*   `profile-section` - Individual detail section
*   `profile-info-row` - Label/value row
*   `profile-info-label` - Field label
*   `profile-info-value` - Field value
*   `dealer-info-section` - Business info section
*   `verified-badge` - Dealer verification badge
*   `verification-pending` - Pending verification state
*   `social-links` - Social media link container
*   `social-link` - Individual social link
*   `status-badge` - Account status indicator
*   `profile-actions` - Action buttons container

### MyListings Components (my-listings- prefix)
*   `my-listings-container` - Main wrapper
*   `my-listings-header` - Page header with title and buttons
*   `section-title` - Section heading
*   `action-buttons` - Button container
*   `listing-section` - Individual listing type section
*   `my-listings-grid` - Card grid layout
*   `my-listing-card` - Individual listing card
*   `my-listing-image` - Image container
*   `my-listing-details` - Text content area
*   `listing-code-number` - License plate number
*   `my-listing-price` - Price display
*   `my-listing-date` - Posted date
*   `my-listing-views` - View count
*   `my-listing-actions` - Action buttons row
*   `empty-state` - No listings placeholder
*   `empty-state-actions` - Empty state buttons

---

## 6. Component Specifications

### Buttons
*   **Primary:** Gradient fill from `primary` to `primary-container` at 135°. 0.5rem corner radius. Hover increases surface-tint glow.
*   **Secondary:** `secondary-container` fill with ghost border.
*   **Tertiary:** Text-only with `primary` color, subtle underline on hover.
*   **Pill Shape:** Use `border-radius: 999px` for modern rounded buttons.

### Cards
*   **Background:** `linear-gradient(180deg, rgba(12, 28, 19, 0.96) 0%, rgba(7, 15, 10, 0.98) 100%)`
*   **Border:** `1px solid rgba(148, 218, 153, 0.12)`
*   **Border Radius:** 24px-28px for major cards
*   **Shadow:** Use subtle inset glow rather than drop shadows

### Input Fields
*   **Default:** `surface-container-highest` fill with bottom-only ghost border.
*   **Active:** Bottom border transforms to `primary` glow, label shifts up and changes color.

### Badges
*   **Featured:** `primary` background
*   **GCC Specs:** Success green
*   **Insured:** Info blue
*   **Imported:** Warning orange

---

## 7. Layout Structure

### Shell (Max-Width)
*   Standard content wrapper: 1200px-1280px max-width
*   Horizontal padding: 24px (mobile), 48px (desktop)

### Grid Systems
*   **Listings Grid:** 3 columns on desktop, 2 on tablet, 1 on mobile
*   **Stats Grid:** `grid-template-columns: repeat(auto-fit, minmax(160px, 1fr))`
*   **Profile Grid:** Flexible with `minmax(320px, 1fr)`

### Responsive Breakpoints
*   Mobile: < 640px
*   Tablet: 640px - 1024px
*   Desktop: > 1024px

---

## 8. Dark Theme Gradient Backgrounds

The 2026 dark theme uses layered gradients:

### Page Background
```css
background:
  radial-gradient(circle at top, rgba(112, 201, 119, 0.1), transparent 28%),
  linear-gradient(180deg, #07110b 0%, #040806 100%);
```

### Card Background
```css
background: linear-gradient(180deg, rgba(12, 28, 19, 0.96) 0%, rgba(7, 15, 10, 0.98) 100%);
```

### Header Banner
```css
background:
  radial-gradient(circle at top, rgba(112, 201, 119, 0.24), transparent 42%),
  linear-gradient(135deg, #0b1d13 0%, #112519 52%, #08110d 100%);
```

---

## 9. Do's and Don'ts

### Do:
*   Use `xl` (1.5rem) corner radii for major containers
*   Use `on-primary-container` for text on primary buttons (AAA accessibility)
*   Apply gradient overlays on hero images for text readability
*   Use consistent prefix-based naming (cn-, cd-, profile-, my-listings-)
*   Use pill-shaped buttons (`border-radius: 999px`)
*   Apply subtle radial gradients for depth

### Don't:
*   Don't use pure black (#000000). Use `surface` (#111414)
*   Don't use solid 1px white borders — use ghost borders or tonal shifts
*   Don't mix naming conventions
*   Don't use default browser easing — use custom transitions for premium feel
*   Don't use bright white backgrounds on dark theme pages