-- ===========================================================================
-- 0016_track_on_grid.sql — per-activity "show on the Grid" flag.
--
-- Everything is still TRACKED for every activity (instances generated,
-- completions recorded, calendar shows it) — this flag only controls whether
-- the activity is DISPLAYED in the Grid (heatmap) view. Default false: new
-- activities don't clutter the grid until you opt them in.
--
-- The Total View's Status grouping uses this to split into active/archived ×
-- on-grid/off-grid.
--
-- Safe to re-run.
-- ===========================================================================

ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS track_on_grid boolean NOT NULL DEFAULT false;
