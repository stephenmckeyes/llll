-- ===========================================================================
-- 0023_add_activity_density.sql — per-profile preference for the Add
-- Activity form's visual density. Three values:
--   'default'  — current layout (unchanged for existing users)
--   'compact'  — tighter gaps + smaller padding so more fields fit on
--                one screen; the primary "less scrolling" mode
--   'expanded' — larger gaps + more padding for a roomier layout
--
-- Only affects the standalone /activities/new form (the modal is
-- already size-constrained). Values other than the three above are
-- treated as 'default' at read time — no CHECK constraint so a future
-- iteration can add more modes without a migration.
--
-- Safe to re-run.
-- ===========================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS add_activity_density text NOT NULL DEFAULT 'default';
