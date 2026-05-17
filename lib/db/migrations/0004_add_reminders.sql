-- ===========================================================================
-- reminders: optional list of {amount, unit} time-before-event reminders.
--
-- Shape (jsonb array):
--   [
--     { "amount": 30, "unit": "minutes" },
--     { "amount": 1,  "unit": "days"    }
--   ]
-- units: 'minutes' | 'hours' | 'days' | 'weeks'
--
-- Notification delivery (cron + email/push) ships in a later turn; this
-- migration just persists the user's choices so the UI can round-trip.
-- ===========================================================================

ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS reminders jsonb NOT NULL DEFAULT '[]'::jsonb;
