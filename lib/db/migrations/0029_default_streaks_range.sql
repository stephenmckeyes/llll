-- ===========================================================================
-- 0029_default_streaks_range.sql — per-profile default for the range tab
-- selected when opening the Streaks (formerly "Grid") view without an
-- explicit ?range URL param.
--
-- Values: 'week' | 'month' | 'total' | 'custom'. Anything else is treated
-- as 'total' at read time. Default 'total' per user request — the Streaks
-- view is more useful as a whole-record heatmap than a 7-day slice on
-- first open.
--
-- No CHECK constraint so future range names can be added without a
-- migration; the read side validates via a TypeScript guard.
--
-- Safe to re-run.
-- ===========================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS default_streaks_range text NOT NULL DEFAULT 'total';
