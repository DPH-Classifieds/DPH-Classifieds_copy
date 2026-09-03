# DPH Bot

Independent Devvit posting app. It reads a prepared, versioned rolling 48-hour
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

The scheduled job is daily at 12:00 PM Dubai time (08:00 UTC). It has an
exactly-once daily guard; consecutive daily posts deliberately overlap by 48
hours because each contains the preceding rolling 72-hour window. Titles use
the format `[31 Aug - 2 Sept] Cars listed in the last 3 days`. Imported rows
link to their original Reddit post.

Set the subreddit `roundupFlairText` to the exact existing post flair text,
normally `Selling`. The bot resolves that flair to its Reddit template ID and
fails safely without posting if the flair does not exist.

## Fetch domain and data handling

The app fetches only `api.github.com`, where the DPH backend publishes the
prepared public roundup JSON. It does not collect Reddit user data or use a
Reddit account password/API secret. The app account submits the resulting
listing post only in the subreddit where the app is installed.
