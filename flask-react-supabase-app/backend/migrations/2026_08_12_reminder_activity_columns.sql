-- Reminder timing Phase 2 (optional): activity-based "2 hours after app close"
-- delivery and a per-user daily frequency cap. Safe to run anytime; the code
-- ships with the evening-window gate (Phase 1) working WITHOUT these columns.
--
-- After running this in the Supabase dashboard, the app already emits app_open /
-- app_close events (mobile app/_layout.tsx), so last_app_close_at can be stamped
-- and the reminder jobs can be switched to the 2h-after-close + 1-2/day behaviour.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS last_app_close_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_reminder_at  timestamptz;
