-- ===========================================================================
-- 0013_activity_watches.sql — "watch" a friend's shared rhythm for progress
-- nudges (accountability buddy).
--
-- A watch is one row: "I (watcher) want to be reminded about activity A".
-- Cadences are independent booleans:
--   - notify_each   : a nudge for each completion/miss of the activity
--   - notify_daily  : an end-of-day summary
--   - notify_weekly : an end-of-week "X of Y" summary
--
-- The reminders themselves are computed live in the app's Notifications tab
-- from the friend's shared occurrences (no cron / no delivery pipeline) —
-- this table just records WHAT each user chose to watch.
--
-- You can only watch an activity that's shared WITH you AND includes the
-- owner's progress (share_progress = true). RLS enforces that on insert;
-- everything else is scoped to watcher_id = auth.uid().
--
-- Safe to re-run.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.activity_watches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  watcher_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_id   uuid NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
  notify_each   boolean NOT NULL DEFAULT false,
  notify_daily  boolean NOT NULL DEFAULT false,
  notify_weekly boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT activity_watches_unique UNIQUE (watcher_id, activity_id)
);

CREATE INDEX IF NOT EXISTS activity_watches_watcher_idx
  ON public.activity_watches (watcher_id);

ALTER TABLE public.activity_watches ENABLE ROW LEVEL SECURITY;

-- See your own watches.
DROP POLICY IF EXISTS activity_watches_self_select ON public.activity_watches;
CREATE POLICY activity_watches_self_select ON public.activity_watches
  FOR SELECT USING (watcher_id = auth.uid());

-- Create a watch: only for an activity actually shared WITH you, with the
-- owner's progress included.
DROP POLICY IF EXISTS activity_watches_self_insert ON public.activity_watches;
CREATE POLICY activity_watches_self_insert ON public.activity_watches
  FOR INSERT WITH CHECK (
    watcher_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.activity_shares s
      WHERE s.activity_id = activity_id
        AND s.shared_with_id = auth.uid()
        AND s.share_progress = true
    )
  );

DROP POLICY IF EXISTS activity_watches_self_update ON public.activity_watches;
CREATE POLICY activity_watches_self_update ON public.activity_watches
  FOR UPDATE USING (watcher_id = auth.uid());

DROP POLICY IF EXISTS activity_watches_self_delete ON public.activity_watches;
CREATE POLICY activity_watches_self_delete ON public.activity_watches
  FOR DELETE USING (watcher_id = auth.uid());
