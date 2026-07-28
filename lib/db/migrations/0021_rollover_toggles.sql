-- ===========================================================================
-- 0021_rollover_toggles.sql — two opt-in per-activity behaviors that change
-- what happens when the user marks a RECURRING occurrence as missed.
--
--   rollover_missed_days  (default false)
--     On miss, ALSO insert an extra pending "make-up" occurrence on the day
--     immediately after the missed one. The main schedule stays untouched
--     (e.g. MWF misses Monday → Tuesday make-up appears; Wednesday still
--     scheduled). No visible effect on Daily rhythms (tomorrow already
--     exists).
--
--   rollover_change_rhythm  (default false)
--     On miss, SHIFT the underlying rhythm forward by 1 day starting from
--     the missed date, so the next occurrence lands on the day AFTER the
--     miss and every subsequent occurrence shifts with it. Primarily
--     useful for interval rhythms ("every 2 days" missed Monday → new
--     cycle Tue, Thu, Sat, ...). Delete + regenerate all pending future
--     instances from the new anchor.
--
-- Both toggles are independent booleans. Both may be enabled at the same
-- time; behavior composes (change-rhythm shifts the schedule first, then
-- the make-up insert either coincides with the new next occurrence — the
-- unique index makes it idempotent — or fills a gap harmlessly).
--
-- Rhythm=single is unaffected: singles use missInstance's existing
-- reschedule-to-today rule; these toggles are hidden on the Once form.
--
-- Safe to re-run.
-- ===========================================================================

ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS rollover_missed_days   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rollover_change_rhythm boolean NOT NULL DEFAULT false;
