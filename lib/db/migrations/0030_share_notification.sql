-- 0030 — is_share_notification column on messages.
--
-- Sibling to is_help_request (0028). When true, the chat renders the
-- message as a neutral "shared with you" panel (same layout as the
-- help-request panel, without the red urgency) instead of a plain
-- bubble. Only ever set by shareActivity when it creates a NEW share
-- row — never on toggle-off / share-progress flips, so a friend isn't
-- spammed every time you tweak the share.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS is_share_notification boolean NOT NULL DEFAULT false;
