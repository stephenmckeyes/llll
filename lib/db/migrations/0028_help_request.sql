-- ===========================================================================
-- 0028_help_request.sql — distinguish "please help me stay on track"
-- messages from regular chat.
--
-- Before this migration, Ask-for-help just sent a normal chat message
-- with the activity quoted at the top ("Re: Morning Run"). Chat rendered
-- it identically to a plain reply — visually a whisper when the sender
-- meant to raise a flag. This adds a boolean marker so the chat can pull
-- those messages out into a large red panel with the activity's history
-- and quick-access links to the sender's calendar / grid / total views.
--
-- The marker defaults to FALSE so every existing message stays a
-- regular chat message.
--
-- Safe to re-run.
-- ===========================================================================

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS is_help_request boolean NOT NULL DEFAULT false;
