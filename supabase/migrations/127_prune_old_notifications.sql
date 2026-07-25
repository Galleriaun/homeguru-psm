-- =============================================================================
-- HomeGuru PMS — migration 127
-- Keep the Bildirimler list to the last 15 days.
-- =============================================================================
-- The notifications table (050) is an ever-growing per-recipient audit log that
-- the Edge Function appends to on every push. The new Bildirimler screen only
-- shows the last 15 days, so anything older is dead weight — a daily cron prunes
-- it. SECURITY DEFINER because there is no client DELETE policy on notifications
-- (by design: only the pipeline writes, only the owner reads / flips read_at);
-- pg_cron runs this as the owner, bypassing RLS for the housekeeping delete.
--
-- Read + mark-read need no migration — notifications_select (own rows) and
-- notifications_update_read (own read_at) from 050 already cover the screen.
-- =============================================================================

CREATE OR REPLACE FUNCTION prune_old_notifications()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM notifications WHERE created_at < now() - interval '15 days';
$$;

REVOKE EXECUTE ON FUNCTION prune_old_notifications() FROM PUBLIC, anon, authenticated;

-- Daily at 21:15 UTC = 00:15 Europe/Istanbul (Turkey is fixed UTC+3). Same-name
-- reschedule replaces cleanly, leaving no orphan job.
DO $$
BEGIN
  PERFORM cron.unschedule('homeguru-prune-notifications');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'homeguru-prune-notifications',
  '15 21 * * *',
  $$ SELECT prune_old_notifications(); $$
);
