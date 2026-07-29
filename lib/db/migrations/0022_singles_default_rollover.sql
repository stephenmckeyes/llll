-- ===========================================================================
-- 0022_singles_default_rollover.sql — retroactively flip existing single-
-- rhythm activities to rollover_missed_days = true, matching the new
-- semantics where "Rollover missed days" is exposed as an opt-out toggle
-- on the Once form (default ON = reschedule to today/tomorrow, the
-- existing behavior; OFF = mark as missed).
--
-- Before this migration, singles ALWAYS rescheduled on miss regardless of
-- the toggle (special-cased inside missInstance). After the code change,
-- singles honor rollover_missed_days like every other rhythm. Without
-- this retro-flip, every existing single would suddenly stop rescheduling
-- because the column's DEFAULT is false — surprising and unwanted.
--
-- Idempotent — safe to re-run.
-- ===========================================================================

UPDATE public.activities
SET rollover_missed_days = true
WHERE rhythm->>'type' = 'single'
  AND rollover_missed_days = false;
