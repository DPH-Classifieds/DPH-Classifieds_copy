# Sign in with Google — Setup Runbook

The code is already in place. After you finish the steps below, the
**Continue with Google** button on `/login` and `/signup` will start working
end-to-end:

1. User clicks **Continue with Google**.
2. Browser redirects to Google's consent screen (with the account chooser
   forced on, so users with multiple Google accounts can pick).
3. Google redirects back to **Supabase**, which then redirects to our
   `/auth/callback`.
4. `AuthCallback.jsx` sets the Supabase session, calls `/api/auth/me` (which
   auto-creates the `public.users` row on first login), and fires
   `trackEvent('login', { method: 'google' })` to GA4 — plus
   `trackEvent('sign_up', { method: 'google' })` if the auth row is brand new.
5. **If `phone_verified === false`, the user is redirected to `/verify-phone`
   before getting to their destination.** Same SMS OTP flow as email signup —
   no Google user reaches `/profile` or any protected route without first
   verifying a phone number.
6. Otherwise the user lands on `/profile` (or wherever the `?redirect=`
   query param pointed).

There are exactly three places you need to touch — none of them code.

---

## 1. Google Cloud Console — fix the redirect URI

The OAuth client you created has `https://www.dphclassifieds.com` as its
redirect URI. **That's invalid** — Google only accepts the *exact* URL it
should POST back to.

Replace it with the Supabase callback URL:

```
https://ltjatsyhpmvewancqdjw.supabase.co/auth/v1/callback
```

Steps:

1. Go to <https://console.cloud.google.com> → **APIs & Services** →
   **Credentials**.
2. Click the OAuth 2.0 Client ID
   `870408604657-…apps.googleusercontent.com` (the one you already created).
3. **Authorized redirect URIs** section — remove `https://www.dphclassifieds.com`,
   add `https://ltjatsyhpmvewancqdjw.supabase.co/auth/v1/callback`.
4. **Authorized JavaScript origins** — add both production URLs and your
   local dev URL so the consent screen runs without a CORS warning:
   ```
   https://dphclassifieds.com
   https://www.dphclassifieds.com
   http://localhost:3000
   ```
5. Click **Save**.

You don't need to share the client ID or secret with the codebase — Supabase
holds them. See step 2.

---

## 2. Supabase Dashboard — enable Google + paste credentials

1. Go to your Supabase project → **Authentication** → **Providers**.
2. Find **Google** in the list → toggle it **on**.
3. Paste in:
   - **Client ID**: `870408604657-agunlejm83kiajp6pr4qn847osuqdn0c.apps.googleusercontent.com`
   - **Client Secret**: copy the `client_secret` value from the JSON file at
     `client_secret_870408…json` (the file is now gitignored and stays on
     your machine).
4. Leave **Skip nonce check** OFF. Leave **Authorized client IDs** empty
   unless you also build the native Google Sign-In SDK on mobile.
5. Click **Save**.

While you're in Supabase, also confirm:

- **Authentication → URL Configuration → Site URL** is set to
  `https://www.dphclassifieds.com`.
- **Additional Redirect URLs** include — one per line — the production and
  local dev callback routes for our own app:
  ```
  https://www.dphclassifieds.com/auth/callback
  https://dphclassifieds.com/auth/callback
  http://localhost:3000/auth/callback
  ```

Without these, Supabase will refuse to redirect back to our `AuthCallback.jsx`
with the session attached.

---

## 3. Smoke test

After steps 1 + 2 are done (no deploy needed if your frontend is still
running):

1. Open <https://www.dphclassifieds.com/login> in an incognito window.
2. Click **Continue with Google** → pick a Google account that's not already
   registered in DPH.
3. You should be redirected to `/auth/callback` → "Processing
   authentication…" → "Almost done — let's verify your phone number." →
   `/verify-phone`.
4. Complete the SMS OTP. You should land on `/profile`.
5. In GA4 → **Reports** → **Realtime** → confirm the `login` and `sign_up`
   events appeared with `method: google`.

For a returning Google user, the flow short-circuits past `/verify-phone`
straight to `/profile` (because `phone_verified` stays `true` once set).

---

## Security notes

- **The OAuth client secret was shared in this chat** when you pasted the
  filename. Treat it as exposed and rotate it after this session: Google
  Cloud Console → Credentials → click the client → top toolbar → **Reset
  Secret**. Then paste the new value into Supabase's Google provider config
  (step 2.3 above).
- The local JSON file is now ignored by the repo's root `.gitignore` (rule
  `client_secret_*.json`). Verify with
  `git check-ignore -v client_secret_*.json`.
- Anyone with both the Client ID and Client Secret can impersonate your
  OAuth client. Don't paste them in tickets, Slack, etc. The Supabase
  dashboard stores them server-side and never re-exposes them.

---

## What if I also wanted GA4 service account credentials?

Different credential type. The OAuth client you have is for **end-user**
sign-in. The GA4 Data API needs a **service account** (server-to-server). See
[`ANALYTICS_SETUP.md`](./ANALYTICS_SETUP.md) §5. The two credentials don't
share anything — create the service account separately.

---

## 4. Mobile (Expo) setup

The mobile **Continue with Google** button is now wired on `LoginScreen` and
`SignupScreen`. It uses `expo-web-browser` against Supabase's hosted OAuth
URL and routes through `dphclassifieds://auth-callback` deep link. After
success, the same `phone_verified` gate fires — Google users land on
`VerifyPhoneScreen` before reaching the main app.

For it to work end-to-end:

1. **Supabase → Authentication → URL Configuration → Additional Redirect URLs.**
   Add the mobile deep link alongside the web ones:
   ```
   https://www.dphclassifieds.com/auth/callback
   https://dphclassifieds.com/auth/callback
   http://localhost:3000/auth/callback
   dphclassifieds://auth-callback
   ```
2. **Run on an Expo dev build, not Expo Go.** The
   `WebBrowser.openAuthSessionAsync` call needs the app's URL scheme
   (`dphclassifieds://`) registered, and Expo Go uses its own scheme. From
   the `mobile/` directory:
   ```
   eas build --profile development --platform ios
   eas build --profile development --platform android
   ```
   Install the resulting build on a device and run `npx expo start --dev-client`.
3. **You do NOT need a separate iOS/Android Google OAuth client.** Supabase
   wraps the Google OAuth flow on its side, so the existing Web Client ID
   is sufficient. (If you ever want native Google Sign-In — the
   GoogleSignInButton with Apple-Pay-style UX — you'll need an iOS Client ID
   and an Android Client ID, but that's optional.)

## What's not covered yet

- **Sign in with Apple.** Required by Apple if/when you ship on the App
  Store and offer Google. Drop me a note when that's on the roadmap.
- **Account linking.** If a user signs up with email and later signs in with
  Google using the same email, Supabase will reject the OAuth attempt
  (default policy). To allow linking, enable **Authentication → Settings →
  Auto-link** in Supabase. We don't enable that automatically because the
  default policy is the safer one.
