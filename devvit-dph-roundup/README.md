# DPH Daily Roundup (Devvit app)

Thin Reddit app that, on a schedule, fetches the pre-built car roundup from the
DPH backend and submits it as a post. **All data/formatting lives in the Flask
backend** (`GET /api/reddit/daily-roundup`) — this app only fetches + posts, so
there is nothing to keep in sync.

## Why Devvit (not a bot account)
A user account posting automated content via the Data API trips Reddit's
anti-spam (that's what got `u/DPHClassifieds` banned). A Devvit app installed by
a subreddit moderator is the sanctioned path and won't get the account banned.

## Backend prerequisite
Set `REDDIT_ROUNDUP_TOKEN=<a long random secret>` on the Flask backend and
redeploy. The endpoint returns `{title, body, count}` and requires the header
`X-Roundup-Token: <that secret>`. Sanity check:

    curl -H "X-Roundup-Token: <secret>" "https://www.dphclassifieds.com/api/reddit/daily-roundup?days=2"

## Setup (run locally, needs Node 18+)
1. `npm i -g devvit` then `devvit login` **as u/DPHClassifieds-Web**.
2. `cd devvit-dph-roundup && npm install`.
3. `devvit upload` (first upload registers the app name; rename in devvit.yaml if taken).
4. Allow the app to fetch your backend domain when prompted (http permission →
   add `www.dphclassifieds.com`, or your Railway domain).
5. Install the app on a subreddit you moderate (a private test sub first), via
   `devvit install <subreddit>` or the app page on developers.reddit.com.
6. In the subreddit's app settings, fill: **roundupUrl**
   (`https://www.dphclassifieds.com/api/reddit/daily-roundup`), **roundupToken**
   (the secret above), and optionally **targetSubreddit**.

## Test it
- `devvit playtest <subreddit>` for live logs, then use the subreddit `...` menu →
  **"DPH: post roundup now"** to post immediately.
- The scheduled job runs `0 9 */2 * *` (every 2 days, 09:00 UTC), registered on
  install/upgrade.

## Notes / things to verify in playtest
- `submitPost({ text })` submits markdown; confirm the table renders. If Reddit
  strips the markdown table, switch to `richtext` or post the URL list.
- To go live on r/DubaiPetrolHeads the account must be a moderator there to
  install the app.
