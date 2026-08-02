-- ===========================================================================
-- 0024_time_format.sql — per-profile 12h / 24h time-format preference.
--
--   'auto' → browser locale (`Date#toLocaleTimeString` default) — this is
--            the current behavior, so existing users see zero change.
--   '12h'  → "8:00 AM" everywhere.
--   '24h'  → "08:00" everywhere.
--
-- No CHECK constraint so future values can be added without a migration;
-- read-side callers validate via `isTimeFormat` and fall back to 'auto'.
--
-- Safe to re-run.
-- ===========================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS time_format text NOT NULL DEFAULT 'auto';
