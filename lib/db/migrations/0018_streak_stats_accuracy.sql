-- ===========================================================================
-- 0018_streak_stats_accuracy.sql — split the streak stats line so the user
-- can choose how detailed it is.
--
-- streak_stats stays the on/off toggle (now labelled "Total count"). When on,
-- streak_stats_accuracy controls whether the line shows:
--   true  → X/Y · Z%   (accuracy — out of how many you missed)
--   false → X          (just the total number completed in the period)
--
-- "Total count" is no longer one of the streak MODES — it's an independent
-- box. Existing streak_mode='total' values are left alone (the grid still
-- renders them as Σ for back-compat); new pickers don't offer that option.
--
-- Safe to re-run.
-- ===========================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS streak_stats_accuracy boolean NOT NULL DEFAULT true;
