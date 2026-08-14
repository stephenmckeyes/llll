-- ---------------------------------------------------------------------------
-- 0059 — "Auto-drop when past" activity setting.
--
-- Per-activity toggle: whether an unmarked occurrence STAYS as an
-- overdue/unlabeled item waiting for a verdict (default, today's behavior),
-- or is silently DROPPED once its scheduled day passes — so you can put
-- meetings / appointments on the calendar for scheduling without the nag to
-- mark each one Complete/Missed.
--
-- auto_resolve = false (default) → requires a verdict (unchanged).
-- auto_resolve = true            → past-due pending occurrences just drop:
--   hidden from the day list, and excluded from the "unlabeled/overdue"
--   counts + reminders. They can still be marked while current/future.
--
-- App-layer behavior (no data mutation): the flag is honored in
-- visibleOnDay(), fetchIncompleteInfo(), and the /notifications reminders
-- query. Applied to the personal calendar; the community-owned calendar
-- gets its own column in a later migration.
-- ---------------------------------------------------------------------------

ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS auto_resolve boolean NOT NULL DEFAULT false;
