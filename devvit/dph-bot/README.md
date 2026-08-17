# DPH Bot

Independent Devvit posting app for DPH Classifieds. It reads a prepared, versioned
roundup from the GitHub Contents API and posts it to the installation subreddit.
The backend prepares the payload; this app is the only Reddit submitter.

## One-time launch

1. Run `npm install` and `npm test` in this folder.
2. Run `npm run upload` while logged in as `u/DPH-Classifieds-WEB`.
3. Install the uploaded app into a small private moderator test subreddit.
4. Set global `roundupUrl` to the GitHub Contents API URL of `dph-roundup.json`.
   Set `roundupToken` only if the bridge repository is private.
5. Set the subreddit `targetSubreddit` only when it differs from the install subreddit.
6. Use **DPH Bot: post roundup now** from the subreddit moderator menu to test.

The scheduled job is every two days at 19:00 Dubai time (15:00 UTC). It has
an exactly-once guard; the force menu is deliberately rate-limited for testing.
