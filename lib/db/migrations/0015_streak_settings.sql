-- ===========================================================================
-- 0015_streak_settings.sql — configurable streak display.
--
-- Streaks become an opt-in tool, configured in Settings → Streaks. Per the
-- product philosophy they're "evidence toward a new identity, nothing more."
--
-- profiles:
--   streak_scope  'same' | 'independent'  — one mode for all activities, or
--                                           a per-activity mode.
--   streak_mode   the GLOBAL mode (used when scope='same', and for friend
--                 views): 'none' | 'perfect_weeks' | 'perfect_months' |
--                 'countdown' | 'total'.
--   streak_stats  show the x/y + % statistics line.
--   streak_goal   global countdown goal (used when scope='same' & mode=
--                 'countdown').
--
-- activities (used when scope='independent'):
--   streak_mode   per-activity mode (NULL → fall back to the global mode).
--   streak_goal   per-activity countdown goal.
--
-- No RLS changes — these are columns on tables that already have policies.
-- Safe to re-run.
-- ===========================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS streak_scope text NOT NULL DEFAULT 'same',
  ADD COLUMN IF NOT EXISTS streak_mode  text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS streak_stats boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS streak_goal  integer;

ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS streak_mode text,
  ADD COLUMN IF NOT EXISTS streak_goal integer;
