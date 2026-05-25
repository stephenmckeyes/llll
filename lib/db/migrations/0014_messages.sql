-- ===========================================================================
-- 0014_messages.sql — direct messages between friends.
--
-- A 1:1 DM model: every row is one message from sender → recipient. A
-- "conversation" with a friend is just all messages where {sender,recipient}
-- = {me, friend}. A message can optionally QUOTE an activity (e.g. replying
-- to a friend's shared rhythm, or an "ask for help" about one of your own) —
-- we store the activity id (FK, nulled if it's deleted) plus a denormalized
-- name snapshot so the quote label survives even if the activity goes away.
--
-- read_at powers unread badges + "you have a new message" notifications.
--
-- RLS: you can read messages you sent or received; you can only SEND to an
-- accepted friend (as yourself); the recipient can mark messages read.
--
-- Safe to re-run.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.messages (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body                 text NOT NULL DEFAULT '',
  quoted_activity_id   uuid REFERENCES public.activities(id) ON DELETE SET NULL,
  quoted_activity_name text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  read_at              timestamptz,
  CONSTRAINT messages_distinct CHECK (sender_id <> recipient_id)
);

-- Conversation fetch: messages between a pair, in time order.
CREATE INDEX IF NOT EXISTS messages_pair_idx
  ON public.messages (sender_id, recipient_id, created_at);
CREATE INDEX IF NOT EXISTS messages_recipient_idx
  ON public.messages (recipient_id, created_at);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Read messages you're part of (either end).
DROP POLICY IF EXISTS messages_self_select ON public.messages;
CREATE POLICY messages_self_select ON public.messages
  FOR SELECT USING (
    sender_id = auth.uid() OR recipient_id = auth.uid()
  );

-- Send as yourself, only to an accepted friend.
DROP POLICY IF EXISTS messages_self_insert ON public.messages;
CREATE POLICY messages_self_insert ON public.messages
  FOR INSERT WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.friendships f
      WHERE f.status = 'accepted'
        AND (
          (f.requester_id = auth.uid() AND f.addressee_id = recipient_id)
          OR (f.addressee_id = auth.uid() AND f.requester_id = recipient_id)
        )
    )
  );

-- Recipient can mark messages read (set read_at).
DROP POLICY IF EXISTS messages_recipient_update ON public.messages;
CREATE POLICY messages_recipient_update ON public.messages
  FOR UPDATE USING (recipient_id = auth.uid());
