-- ============================================================================
-- 0039 · Archived tags
--
-- Replaces the hard-delete plan from 0038. Tags now soft-archive:
-- setting archived_at hides the tag from picker + filter surfaces but
-- preserves the row (and the name in every activity / completion
-- history array that already references it). Users can restore an
-- archived tag from /settings/tags — mirrors how activities archive.
--
-- Migration 0038 (delete_tag_cascade RPC) is left in place but unused;
-- future cleanup can drop it once we're sure no environment still
-- references the function.
-- ============================================================================

alter table tags
  add column if not exists archived_at timestamptz;

-- Handy index for the common "give me active tags" query. Partial so
-- it only stores rows that are currently active — cheap to maintain.
create index if not exists tags_user_active_idx
  on tags (user_id)
  where archived_at is null;
