-- 0037 — default state for the Timeline untimed-activities dropdown.
--
-- Per-user preference. When false (default) each day's untimed
-- activities render inside a collapsed <details> block below the
-- hour grid — same "one tap to expand" pattern as Completed/Missed.
-- When true, the block opens on load. Ships as a boolean on
-- profiles; the Timeline reads it and passes to <details open={}>.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS default_untimed_open boolean
  NOT NULL DEFAULT false;
