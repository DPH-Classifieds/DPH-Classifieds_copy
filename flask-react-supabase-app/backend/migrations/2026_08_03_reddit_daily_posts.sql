-- Daily Reddit roundup poster: one-post-per-day guard + audit log.
--
-- reddit_daily_post_worker inserts exactly one row per Dubai calendar day:
-- 'posted' (with the reddit post id/url), or 'skipped_empty' when no cars were
-- listed. The UNIQUE(post_date) constraint is the idempotency guard — it makes a
-- double-post impossible even if the worker ticks twice in the posting window.
--
-- Apply manually in the Supabase dashboard SQL editor BEFORE enabling the worker
-- (REDDIT_DAILY_POST_ENABLED). Idempotent (safe to re-run).

CREATE TABLE IF NOT EXISTS public.reddit_daily_posts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_date       date NOT NULL UNIQUE,
  subreddit       text NOT NULL,
  status          text NOT NULL CHECK (status IN ('posted','skipped_empty','failed')),
  listing_count   integer NOT NULL DEFAULT 0,
  reddit_post_id  text,
  reddit_post_url text,
  error_summary   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reddit_daily_posts_date_idx
  ON public.reddit_daily_posts (post_date DESC);

-- Service role bypasses RLS; enabling it with no policies denies anon/authenticated.
ALTER TABLE public.reddit_daily_posts ENABLE ROW LEVEL SECURITY;
