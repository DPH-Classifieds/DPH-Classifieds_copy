# Analytics Setup — GA4 + Microsoft Clarity

This is a slow-follow checklist. Knock out one section at a time; nothing here has to be done in one sitting. **Skip anything you don't need yet** — the code is wired so that missing env vars are silently no-op'd. Tracking only turns on once the relevant key is filled in.

There are three places keys live:

| File | Used by | What goes in |
|---|---|---|
| `flask-react-supabase-app/frontend/.env` | The website (React) | Web tracking IDs |
| `flask-react-supabase-app/backend/.env` | The Flask API | Server-side admin endpoints (Clarity deep-link only) |
| `flask-react-supabase-app/mobile/.env` | The Expo app | Mobile event tracking |

All three are gitignored. Reference templates with comments live next to each one as `.env.example`.

---

## 0. Pick what you actually need

| Goal | Sections to do | Time |
|---|---|---|
| "Just give me page views, sessions, conversions on the website" | §1 → §3 | ~15 min |
| "Also give me heatmaps and session recordings" | §2 | +5 min |
| "Track mobile sessions too" | §4 | +10 min |
| ~~"I want GA4 numbers inside the admin dashboard"~~ | *Removed — see §5 for why* | n/a |
| "Hook the 'Open GA4' / 'Open Clarity' buttons in the admin panel" | §6 (auto-on as soon as IDs from §1/§2 are in place) | 0 min |

A reasonable order: §1 → §2 → §6 → (later) §4.

---

## 1. Google Analytics 4 — web tracking

GA4 is the primary dashboard. Free, industry standard, and the first thing an investor will ask for.

### 1.1 Create the property

1. Go to <https://analytics.google.com>.
2. Bottom left → **Admin** (gear icon) → **Create** → **Property**.
3. Property name: `DPH Classifieds`. Reporting time zone: `(GMT+04:00) United Arab Emirates Time`. Currency: `AED`.
4. Business details → skip / accept defaults.
5. Business objectives → tick **Generate leads** and **Examine user behavior**.

### 1.2 Add the Web data stream

1. Inside the new property: **Data Streams** → **Add stream** → **Web**.
2. Website URL: `https://dphclassifieds.com`.
3. Stream name: `dphclassifieds.com`.
4. Click **Create stream**.

### 1.3 Copy the Measurement ID

On the stream page, top right, you'll see **Measurement ID** — looks like `G-AB12C34DEF`. Copy it.

Paste it in two places (same value in both):

```bash
# flask-react-supabase-app/frontend/.env
REACT_APP_GA4_MEASUREMENT_ID=G-AB12C34DEF

# flask-react-supabase-app/mobile/.env
EXPO_PUBLIC_GA4_MEASUREMENT_ID=G-AB12C34DEF
```

> Why both files? The web reads it via React, the mobile app pushes events to the same GA4 stream so web + mobile traffic roll up in a single property.

### 1.4 Mark conversions

In GA4 → **Admin** → **Events**, find each of these once they start firing and toggle "Mark as conversion":

- `contact_click_call`
- `contact_click_whatsapp`
- `sign_up`
- `post_listing_success`

These are the KPIs that matter to a marketplace investor.

### 1.5 Verify it's working

After deploying with the env var set:
- Visit the live site in an incognito window.
- In GA4 → **Reports** → **Realtime** → you should see 1 user within ~30 seconds.

If you don't: confirm `REACT_APP_GA4_MEASUREMENT_ID` is set in production env (Vercel/Netlify/wherever the frontend deploys), and check the browser console for `gtag` errors.

---

## 2. Microsoft Clarity — heatmaps + session recordings

Clarity is the "watch real user sessions" tool. Free, no quota worth worrying about, ~5 minutes to set up.

### 2.1 Create the project

1. Go to <https://clarity.microsoft.com> → sign in with a Microsoft account (any will do).
2. **+ New project**.
3. Name: `DPH Classifieds`. Website: `https://dphclassifieds.com`. Category: `Marketplaces`.
4. **Create**.

### 2.2 Copy the Project ID

On the project page → **Settings** → **Setup**. The 10-character Project ID is shown both in the install snippet (`clarity('init', 'abc1234567')`) and in plain text. Looks like `abc1234567`.

Paste it in:

```bash
# flask-react-supabase-app/frontend/.env
REACT_APP_CLARITY_PROJECT_ID=abc1234567

# flask-react-supabase-app/backend/.env  (only needed for the "Open Clarity" button)
CLARITY_PROJECT_ID=abc1234567
```

### 2.3 Verify

After deploying, visit the live site, then in Clarity → **Dashboard** → wait ~2 minutes for the first session to show up.

> Mobile note: Clarity has no React Native SDK worth using. Mobile sessions won't be recorded — that's intentional.

---

## 3. After §1 + §2 — what works automatically

Once the four IDs above are in production env:

- `gtag.js` loads on every page; GA4 starts collecting page views, sessions, devices, geography.
- Clarity starts recording heatmaps and (anonymous) session recordings.
- `trackEvent(name, params)` from `frontend/src/utils/analytics.js` is available to instrument extra events (next sprint — see "Custom events to add" at the bottom).
- The "Open GA4 Dashboard" and "Open Clarity Dashboard" buttons in the admin panel (mobile + web) become enabled and deep-link to your specific project.

No deploy of the backend needed yet — §1 and §2 are pure frontend.

---

## 4. Mobile event tracking (optional, do later)

Mobile uses GA4's **Measurement Protocol** (a REST endpoint) instead of `gtag.js`. This avoids adding Firebase as a dependency. Trade-off: no automatic screen-view or session tracking — only the events you explicitly fire are recorded.

### 4.1 Create the API secret

1. GA4 → **Admin** → **Data Streams** → click the existing web stream from §1.2.
2. Scroll to **Measurement Protocol API secrets** → **Create**.
3. Nickname: `mobile-app`. Click **Create**.
4. Copy the 22-character secret.

### 4.2 Add it to mobile env

```bash
# flask-react-supabase-app/mobile/.env
EXPO_PUBLIC_GA4_API_SECRET=<your-22-char-secret>
```

(`EXPO_PUBLIC_GA4_MEASUREMENT_ID` should already be set from §1.3.)

### 4.3 Verify

The mobile `analytics.js` will start sending events the next time you launch the app with these env vars. To verify, fire any tracked event in the app, then go to GA4 → **Reports** → **Realtime** → check the "Event count by Event name" widget. Events show up within ~60 seconds.

> The API secret is sensitive — it's write-only (can't read your data) but anyone with it can pollute your analytics. Don't commit it; rotate it if leaked.

---

## 5. ~~Pulling GA4 numbers into the admin panel~~ (removed)

This feature used to pull GA4 numbers (Active Users / Sessions / Conversions) via the Data API and render them inline on the admin dashboard. **Removed in 2026-06**: Google has made granting service accounts access to GA4 properties prohibitively unreliable (the UI rejects service-account emails with "doesn't match a Google Account" even when the notify-by-email toggle is off, and the workarounds via OAuth Playground / `analytics.manage.users` scope are blocked by Google's "this app is blocked" enforcement on sensitive scopes).

The "Open GA4 Dashboard ↗" button on the admin panel deep-links to analytics.google.com where the same numbers live — that's the supported path now.

If Google later reverses these restrictions, the implementation lived at commits before `<see git log around 2026-06>` and can be restored.

---

## 6. Admin panel buttons — no setup needed

After §1 + §2:

- Mobile → **Profile** → **Admin Panel** → scroll to **External Analytics** → tap **Open GA4 Dashboard** or **Open Clarity Dashboard**.
- Web → `/admin` → bottom of the dashboard → same two buttons.

If the matching env var is missing, the button shows as **Add `<env var name>` to env** and won't open. As soon as you deploy with the env var set, it activates on the next page load.

---

## Full key reference

Sorted by which file they live in. Required keys are bold.

### `flask-react-supabase-app/frontend/.env`

- **`REACT_APP_GA4_MEASUREMENT_ID`** — `G-XXXXXXXXXX` from §1.3
- **`REACT_APP_CLARITY_PROJECT_ID`** — 10-char ID from §2.2

### `flask-react-supabase-app/mobile/.env`

- `EXPO_PUBLIC_GA4_MEASUREMENT_ID` — same value as `REACT_APP_GA4_MEASUREMENT_ID`
- `EXPO_PUBLIC_GA4_API_SECRET` — 22-char secret from §4.1

### `flask-react-supabase-app/backend/.env`

- `CLARITY_PROJECT_ID` — same value as `REACT_APP_CLARITY_PROJECT_ID` (used by admin button only)

---

## Custom events to add later (track these for the investor pitch)

These are fired by calling `trackEvent('event_name', { ... })` from `analytics.js` in both the web and mobile codebases. Wiring them is a separate task — listed here for completeness.

| Event | When to fire | Useful params |
|---|---|---|
| `sign_up` | After successful account creation | `method` (email / google / etc.) |
| `login` | After successful sign-in | `method` |
| `view_listing` | Listing detail page mount | `listing_type`, `listing_id`, `price`, `category` |
| `contact_click_call` | Tap on the "Call" button | `listing_type`, `listing_id` |
| `contact_click_whatsapp` | Tap on the WhatsApp button | `listing_type`, `listing_id` |
| `vin_reveal` | After successful VIN reveal | `listing_type`, `listing_id` |
| `post_listing_start` | Open the post-listing flow | `listing_type` |
| `post_listing_submit` | Press Submit | `listing_type` |
| `post_listing_success` | Backend returns 201 | `listing_type`, `listing_id` |
| `buying_request_submit` | Create a buying request | `item_type` |
| `reveal_buying_request_whatsapp` | Phone-verified WhatsApp reveal | `request_id` |

The four in §1.4 (`sign_up`, `contact_click_call`, `contact_click_whatsapp`, `post_listing_success`) are the ones to mark as conversions in GA4.

---

## Security checklist before you ship

- [ ] All four `.env` files (`frontend/.env`, `backend/.env`, `mobile/.env`, and any `.env.production`) are gitignored. (`git check-ignore -v <file>` to confirm.)
- [ ] The GA4 Measurement Protocol secret is **not** in the frontend env (it's mobile-only — leaking it lets anyone spoof events).
- [ ] The GA4 service-account JSON is **not** in any frontend env (server-side only).
- [ ] The Clarity Project ID is fine to expose — it's public by design (lives in the page source).
- [ ] When deploying, paste the same values into your hosting provider's env-var UI (Railway, Vercel, Netlify, etc.) — `.env` files don't ship with the build.
