# DPH Classifieds — Mobile Release Guide

Everything in code is done. This is the operator checklist to get from here to
TestFlight + Play internal testing, then to the stores. Steps that need *your*
accounts (Expo / Apple / Google / Supabase) are marked 🔑.

---

## 0. One-time backend prerequisite (do first)

🔑 **Apply the push-tokens migration** to Supabase (SQL editor or CLI):

```
backend/migrations/add_push_tokens_20260702.sql
```

Until this runs, push-token registration calls no-op gracefully (the app still
works; sellers just won't receive pushes).

---

## 1. Link the Expo project 🔑

```bash
cd flask-react-supabase-app/mobile
npx eas-cli login            # your Expo account
npx eas-cli init             # writes expo.owner + expo.extra.eas.projectId into app.json
```

`eas init` is what fills the `projectId` that push notifications and OTA need.
The push-token client reads it automatically (`Constants.expoConfig.extra.eas.projectId`).

## 2. Build-time env vars (EAS servers) 🔑

`.env` is gitignored and does NOT reach EAS build servers. Create the public
runtime vars as EAS environment variables (once per environment — `preview` and
`production`):

```bash
npx eas-cli env:create --environment production --name EXPO_PUBLIC_SUPABASE_URL --value "https://<your>.supabase.co"
npx eas-cli env:create --environment production --name EXPO_PUBLIC_SUPABASE_KEY --value "<anon key>"
npx eas-cli env:create --environment production --name EXPO_PUBLIC_API_URL --value "https://api.dphclassifieds.com"
npx eas-cli env:create --environment production --name EXPO_PUBLIC_GA4_MEASUREMENT_ID --value "G-XXXXXXX"
# GA4 API secret is sensitive — mark it as such (still bundled since EXPO_PUBLIC_, so treat as low-value):
npx eas-cli env:create --environment production --name EXPO_PUBLIC_GA4_API_SECRET --value "<secret>" --type sensitive
npx eas-cli env:create --environment production --name EXPO_PUBLIC_CLARITY_PROJECT_ID --value "<id>"
```

Repeat with `--environment preview` (usually the same values). `eas.json`
already binds each build profile to its environment.

## 3. Push notification credentials 🔑

Push infra is fully built (token storage, sender, triggers on new-lead and
saved-car reminders). You only add credentials:

- **iOS:** handled automatically the first time you run a production build —
  `eas build` provisions an APNs key. Or manage manually: `npx eas-cli credentials`.
- **Android:** upload FCM **V1** credentials to EAS
  (Firebase console → Project settings → Service accounts → generate key →
  `npx eas-cli credentials` → Android → Push Notifications). Required for Android push.

> Test push on a **development or preview build**, not Expo Go (SDK 54 Expo Go
> can't receive remote push).

## 4. Builds

```bash
# Internal testers (ad-hoc IPA / APK):
npx eas-cli build --profile preview --platform all

# Store builds (auto-increments buildNumber / versionCode via appVersionSource: remote):
npx eas-cli build --profile production --platform all
```

## 5. Submit 🔑

```bash
npx eas-cli submit --profile production --platform ios      # → TestFlight
npx eas-cli submit --profile production --platform android  # → Play internal testing
```

## 6. Store console tasks (required before review passes) 🔑

- **Apple App Privacy** + **Google Data Safety** forms — the app collects
  location, photos, and account/email. Fill both.
- Screenshots, description, category.
- **App icon:** `assets/icon.png` is 512×512. Apple wants a 1024×1024 source —
  replace it with a 1024px PNG (no alpha) for a crisp marketing icon before
  submitting. Expo will still build with 512, just softer.

---

## Tracking downloads / web-vs-mobile (already wired)

- Mobile fires an `app_open` event per cold start; web tags every event
  `platform: 'web'`. The admin **Metrics → Platform · web vs mobile** panel
  (both web AdminMetrics and the mobile AdminMetricsScreen) shows unique
  visitors + mobile app-opens per platform.
- True App Store / Play **download totals** live only in App Store Connect /
  Play Console — the in-app "app opens" number is the closest first-party proxy.
  The admin dashboards already deep-link to GA4, whose app vs web stream split
  is the external cross-check.

## Deliberately deferred (not blockers)

- **OTA updates** (`expo-updates`): not installed. To enable JS-only hotfixes
  without a store rebuild: `npx expo install expo-updates`, add
  `"runtimeVersion": { "policy": "appVersion" }` + `"updates": { "url": "..." }`
  to app.json (url comes from your projectId), then `eas update:configure`.
- **Custom Android notification icon:** expo-notifications currently uses the
  default (app icon). For a crisp monochrome status-bar icon, add a
  white-on-transparent `notification-icon.png` and set it in the
  `expo-notifications` plugin `icon` field in app.json.
- **Universal/app links** (open `https://dphclassifieds.com/...` in the app):
  custom scheme (`dphclassifieds://`) works for OAuth today; universal links
  need `ios.associatedDomains` + an AASA file on the web host + `android.intentFilters`.
- **Dealer portal:** mobile has a read-only dashboard + leads view. Bulk
  inventory import, webhooks, API integrations and team management remain
  web-only by design.
