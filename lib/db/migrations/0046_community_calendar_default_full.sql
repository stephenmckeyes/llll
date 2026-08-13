-- ---------------------------------------------------------------------------
-- 0046 — Default the community calendar to 'full' (the whole personal-style
-- calendar), matching what each user has. Leadership can still switch a
-- community to 'light' in Settings.
--
-- Changes the column default for NEW communities and backfills existing ones
-- to 'full' (the setting is only a day old, so this adopts the new default
-- everywhere; a leader who prefers the trimmed view can re-pick 'light').
--
-- Function-less / column already exists → the schema-check banner won't flag
-- this; apply it manually.
-- ---------------------------------------------------------------------------

ALTER TABLE public.communities
  ALTER COLUMN calendar_display SET DEFAULT 'full';

UPDATE public.communities
SET calendar_display = 'full'
WHERE calendar_display IS DISTINCT FROM 'full';
