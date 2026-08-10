-- 0034 — default calendar filter (tag hide list).
--
-- Per-user preference. On cold-open (sec-fetch-site: none) the Calendar
-- section starts with these tags hidden. When the URL carries
-- ?hideTags= (e.g. after the user picked filters via the Filters
-- modal), that wins. Empty array = no default filter.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS default_calendar_hidden_tags text[]
  NOT NULL DEFAULT '{}'::text[];
