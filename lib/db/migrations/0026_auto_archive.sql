-- ===========================================================================
-- 0026_auto_archive.sql — cleaner Total View via auto-archive.
--
-- Motivation: the Total View was dominated by every completed one-off task
-- ever created ("Buy oat milk", "Book dentist"). Those are done — but the
-- old model kept them visible under Active alongside genuinely ongoing
-- activities, drowning out the ones the user actually needed to think
-- about.
--
-- Two changes:
--
--   1. activities.auto_archive boolean (default false)
--        - When true, the activity moves to `archived_at = now()` as
--          soon as its instance completes (or, for singles, is
--          finalised as missed). The row is still there for history —
--          the "Past" filter in Total View shows it — but it stops
--          cluttering the "Active" filter.
--        - New activities default the toggle to TRUE for singles and
--          FALSE for recurring at form-time (see createActivity).
--        - Users who want a single to stay visible for reuse can
--          uncheck the toggle when creating it.
--
--   2. Retroactive backfill: every existing SINGLE whose only instance
--      is already completed/missed gets `archived_at = now()` +
--      `auto_archive = true` on this migration run. That clears the
--      Total View clutter for existing users in one shot. Rows can be
--      brought back by the Unarchive flow if the user wants to reuse
--      one.
--
-- Recurring activities are untouched by the backfill — they don't have
-- a natural "done" moment (`end_date` may be indefinite), and their
-- default of `auto_archive = false` means completing individual
-- occurrences never archives the parent.
--
-- Safe to re-run — the ADD COLUMN and UPDATE are idempotent.
-- ===========================================================================

ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS auto_archive boolean NOT NULL DEFAULT false;

-- Retroactive cleanup: singles that already have at least one
-- terminal-status instance get archived on the same clock. Setting
-- auto_archive = true classifies them as "Past" (self-cleanup) rather
-- than "Archived" (user's manual soft-delete) so they surface in the
-- right Total View filter.
UPDATE public.activities a
SET archived_at = now(),
    auto_archive = true
WHERE a.archived_at IS NULL
  AND (a.rhythm->>'type') = 'single'
  AND EXISTS (
    SELECT 1 FROM public.activity_instances ai
    WHERE ai.activity_id = a.id
      AND ai.status IN ('completed', 'missed')
  );
