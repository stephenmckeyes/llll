-- ===========================================================================
-- scheduled_times: optional list of "HH:MM" strings on each activity.
--
-- Semantics:
--   - Empty []        : no time-of-day specified (current default).
--   - 1 entry         : single scheduled time (any rhythm).
--   - N entries       : Multi-Daily rhythms — one entry per occurrence per
--                       day. The frequency rhythm's `count` should equal
--                       scheduled_times.length when set this way.
--
-- Format validation lives at the app layer (Zod). Adding a DB CHECK
-- would couple the DB to a regex; keep it loose for now.
-- ===========================================================================

ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS scheduled_times text[] NOT NULL DEFAULT '{}'::text[];
