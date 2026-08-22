-- ---------------------------------------------------------------------------
-- 0065 — Completion mode (replaces the auto_resolve two-way toggle) + multi-
-- day events.
--
-- The old boolean auto_resolve was "stays until marked" (false) vs "auto-drop
-- when past" (true). It's replaced by a three-way completion_mode:
--
--   'mark'  — you must mark it Complete/Missed (today's default).
--   'auto'  — comment-only; it auto-marks COMPLETE once its date/time passes.
--   'both'  — markable AND auto-completes if left unmarked once past.
--
-- Multi-day events (a "Once" activity whose end_date is later than its
-- start_date) default to 'auto'. auto_resolve is kept (dormant) for now so a
-- rollback is trivial; nothing reads it after this migration ships.
--
-- Backfill: auto_resolve = true → 'auto' (closest intent: no manual nag);
-- everything else → 'mark'. Requires 0059.
-- ---------------------------------------------------------------------------

ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS completion_mode text NOT NULL DEFAULT 'mark';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'activities_completion_mode_chk'
  ) THEN
    ALTER TABLE public.activities
      ADD CONSTRAINT activities_completion_mode_chk
      CHECK (completion_mode IN ('mark', 'auto', 'both'));
  END IF;
END $$;

-- Backfill existing rows from the old boolean (only meaningful where a caller
-- had set auto-drop). New rows default to 'mark'.
UPDATE public.activities
SET completion_mode = 'auto'
WHERE auto_resolve = true AND completion_mode = 'mark';
