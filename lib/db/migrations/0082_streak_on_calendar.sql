-- ---------------------------------------------------------------------------
-- 0082_streak_on_calendar — show each activity's streak on the calendar view.
--
-- A per-user display toggle (Settings → Streaks): when ON, the Day-view list
-- shows each activity's current streak value (🔥5w / 🔥2mo / Σ12 / "3 to go")
-- next to the row, using the same streak mode/goal the Grid already uses. OFF
-- by default so the calendar stays uncluttered for everyone who doesn't opt in.
--
-- Pure display; the streak values themselves are computed from existing
-- activity_instances history (no new data). Honors the existing streak scope
-- (same / independent) + per-activity streak_mode/streak_goal.
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS streak_on_calendar boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
