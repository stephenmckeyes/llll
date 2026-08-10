-- 0032 — optional end-times for scheduled activities.
--
-- Parallel array to activities.scheduled_times. When
-- scheduled_end_times[i] is a valid "HH:MM" string, that occurrence has
-- an end time; when it's the empty string (or the parallel array is
-- shorter than scheduled_times), the occurrence has a start only.
--
-- This shape is intentionally additive — every existing caller of
-- scheduled_times keeps working; new display + Timeline consumers read
-- both and pair them by index. Enforcing that the two arrays are the
-- same length would be nice, but pg CHECK constraints across
-- array columns are awkward; the app-side write path always writes both
-- arrays with matching length and pads missing slots with "".

ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS scheduled_end_times text[]
  NOT NULL DEFAULT '{}'::text[];

-- Extend get_shared_with_me (from migration 0011) to surface the new
-- column, so the friend Calendar / activity modal can render the same
-- "08:00 – 09:00" range users see on their own dashboard. The AGENTS.md
-- standing rule is that friend views mirror personal views; keeping
-- them in sync means the RPC has to grow the column too. Postgres won't
-- let us change a function's return type in place — DROP + CREATE.

DROP FUNCTION IF EXISTS public.get_shared_with_me();
CREATE OR REPLACE FUNCTION public.get_shared_with_me()
RETURNS TABLE (
  share_id            uuid,
  activity_id         uuid,
  owner_id            uuid,
  owner_username      text,
  owner_display_name  text,
  share_progress      boolean,
  name                text,
  notes               text,
  rhythm              jsonb,
  priority            smallint,
  scheduled_times     text[],
  scheduled_end_times text[],
  default_skill_tags  text[],
  start_date          date,
  end_date            date,
  archived_at         timestamptz,
  created_at          timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id, a.id, s.owner_id, p.username, p.display_name, s.share_progress,
    a.name, a.notes, a.rhythm, a.priority,
    a.scheduled_times, a.scheduled_end_times,
    a.default_skill_tags, a.start_date, a.end_date, a.archived_at,
    s.created_at
  FROM public.activity_shares s
  JOIN public.activities a ON a.id = s.activity_id
  JOIN public.profiles p ON p.id = s.owner_id
  WHERE s.shared_with_id = auth.uid()
  ORDER BY s.created_at DESC;
$$;
