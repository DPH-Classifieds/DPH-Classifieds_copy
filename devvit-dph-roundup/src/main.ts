import { Devvit } from '@devvit/public-api';

// redditAPI: submitPost; http: fetch the backend roundup endpoint.
Devvit.configure({ redditAPI: true, http: true });

const JOB = 'dph-daily-roundup';

// Configured per-install (Reddit → app settings). Keep the token secret.
Devvit.addSettings([
  { type: 'string', name: 'roundupUrl',
    label: 'Backend roundup URL (…/api/reddit/daily-roundup)' },
  { type: 'string', name: 'roundupToken', isSecret: true,
    label: 'X-Roundup-Token secret (matches REDDIT_ROUNDUP_TOKEN)' },
  { type: 'string', name: 'targetSubreddit',
    label: 'Subreddit to post to (no r/); blank = the install subreddit' },
]);

// Fetch the pre-built post from the backend and submit it. All formatting/data
// logic lives in the Flask backend — this stays a thin poster.
async function postRoundup(context: Devvit.Context): Promise<string> {
  const url = (await context.settings.get('roundupUrl')) as string;
  const token = (await context.settings.get('roundupToken')) as string;
  const configuredSub = (await context.settings.get('targetSubreddit')) as string;
  if (!url || !token) throw new Error('roundupUrl / roundupToken not set in app settings');

  const sub = configuredSub || (await context.reddit.getCurrentSubreddit()).name;
  const res = await fetch(`${url}?days=2`, { headers: { 'X-Roundup-Token': token } });
  if (!res.ok) throw new Error(`roundup fetch failed: ${res.status}`);

  const data = (await res.json()) as { title: string; body: string; count: number };
  if (!data.count) return 'no new listings — skipped';

  await context.reddit.submitPost({ subredditName: sub, title: data.title, text: data.body });
  return `posted ${data.count} cars to r/${sub}`;
}

Devvit.addSchedulerJob({
  name: JOB,
  onRun: async (_event, context) => {
    try {
      console.log(await postRoundup(context));
    } catch (err) {
      console.error('roundup job failed:', err);
    }
  },
});

// Register the cron on install/upgrade. Every 2 days at 09:00 UTC.
// ponytail: cron day-of-month */2 resets each month → up to a 1-day jitter at the
// month boundary; fine for a ~2-day roundup. Move cadence server-side if it matters.
async function ensureScheduled(context: Devvit.Context) {
  const jobs = await context.scheduler.listJobs();
  await Promise.all(jobs.filter((j) => j.name === JOB).map((j) => context.scheduler.cancelJob(j.id)));
  await context.scheduler.runJob({ name: JOB, cron: '0 9 */2 * *' });
}
Devvit.addTrigger({ event: 'AppInstall', onEvent: (_e, context) => ensureScheduled(context) });
Devvit.addTrigger({ event: 'AppUpgrade', onEvent: (_e, context) => ensureScheduled(context) });

// Moderator menu action to post immediately (for testing).
Devvit.addMenuItem({
  label: 'DPH: post roundup now',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (_e, context) => {
    try {
      const msg = await postRoundup(context);
      context.ui.showToast(msg);
    } catch (err) {
      context.ui.showToast(`Failed: ${(err as Error).message}`);
    }
  },
});

export default Devvit;
