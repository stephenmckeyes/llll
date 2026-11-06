-- ---------------------------------------------------------------------------
-- 0083_activity_goals — per-activity GOAL + calendar progress bar.
--
-- A user can set a goal on an activity: complete it N times per week / per
-- month / in total. The Day-view row then shows a thin progress bar (filled by
-- completed-count-in-period ÷ target) so you can see how far along the goal is
-- right on the calendar. Distinct from the streak modes (which are number-only
-- in the Grid's Success column) — this is a visual bar ON the calendar.
--
--   goal_target  — target count (NULL = no goal, bar hidden).
--   goal_period  — 'week' | 'month' | 'total' (the window the target counts in).
--
-- v1 counts completed OCCURRENCES. A value-based metric (e.g. "100 miles")
-- waits for the structured-input activities phase.
-- ---------------------------------------------------------------------------

ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS goal_target integer,
  ADD COLUMN IF NOT EXISTS goal_period text
    CHECK (goal_period IN ('week', 'month', 'total'));

NOTIFY pgrst, 'reload schema';
