-- ===========================================================================
-- 0009_instance_overrides.sql — per-occurrence edits.
--
-- Until now, name / notes / priority lived ONLY on the activity (the
-- recurring template), so "Edit activity" changed every occurrence —
-- including future ones. Per user spec, "Edit activity" must edit ONLY
-- the single occurrence you opened, while "Edit rhythm" edits the whole
-- series.
--
-- These nullable override columns make that possible: NULL = inherit
-- from the parent activity (the default for every existing + newly
-- generated instance), non-NULL = this occurrence was individually
-- edited. `tags` already worked this way (snapshotted per instance).
-- The app reads `coalesce(instance.override, activity.value)` for
-- display, so existing rows (all NULL) keep showing the series values
-- exactly as before.
-- ===========================================================================

ALTER TABLE public.activity_instances
  ADD COLUMN IF NOT EXISTS name     text,
  ADD COLUMN IF NOT EXISTS notes    text,
  ADD COLUMN IF NOT EXISTS priority smallint;
