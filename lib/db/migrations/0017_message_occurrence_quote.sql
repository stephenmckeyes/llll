-- ===========================================================================
-- 0017_message_occurrence_quote.sql — let a chat reply quote a SPECIFIC
-- occurrence (one dated instance), not just the whole rhythm.
--
-- 0014 added quoted_activity_id + quoted_activity_name. This adds:
--   quoted_scheduled_for — the date of the occurrence being replied to.
--   quoted_status        — a human label snapshot of that occurrence's state
--                          at reply time ("Completed" / "Missed" /
--                          "Unlabeled" / "Scheduled").
--
-- Both NULL for an activity/rhythm-level quote (e.g. "Ask for help").
-- Safe to re-run.
-- ===========================================================================

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS quoted_scheduled_for date,
  ADD COLUMN IF NOT EXISTS quoted_status text;
