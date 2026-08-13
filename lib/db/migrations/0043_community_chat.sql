-- ---------------------------------------------------------------------------
-- 0043 — Community chat (Phase 7).
--
-- Per-community group chat. Human messages post through a SECURITY DEFINER
-- RPC that enforces the chat settings from 0041 (chat_enabled +
-- chat_who_can_speak). System notices (community changes) are inserted by a
-- helper that other mutation RPCs call — this migration wires the first one
-- (activity added); more events get hooked as we go.
--
-- Requires 0041 (chat_enabled / chat_who_can_speak columns).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.community_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  -- NULL sender = a system notice (kind='system').
  sender_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'message' CHECK (kind IN ('message', 'system')),
  body text NOT NULL,
  -- Structured payload for system notices (type + ids), for future rendering.
  system_event jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS community_messages_idx
  ON public.community_messages (community_id, created_at);

ALTER TABLE public.community_messages ENABLE ROW LEVEL SECURITY;

-- Members read the chat. No direct INSERT — posting goes through the RPC.
DROP POLICY IF EXISTS community_messages_select ON public.community_messages;
CREATE POLICY community_messages_select ON public.community_messages
  FOR SELECT
  USING (public.is_community_member(community_id, auth.uid()));

-- Internal helper: insert a system notice. Not granted to clients — only
-- other SECURITY DEFINER functions (owned by the same role) call it.
CREATE OR REPLACE FUNCTION public._post_community_system(
  p_community_id uuid,
  p_body text,
  p_event jsonb
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.community_messages (community_id, sender_id, kind, body, system_event)
  VALUES (p_community_id, NULL, 'system', p_body, p_event);
$$;

REVOKE ALL ON FUNCTION public._post_community_system(uuid, text, jsonb) FROM public;

-- post_community_message — a member posts a human message, subject to the
-- community's chat settings.
CREATE OR REPLACE FUNCTION public.post_community_message(
  p_community_id uuid,
  p_body text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_enabled boolean;
  v_who text;
  v_body text := trim(p_body);
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF v_body = '' THEN
    RAISE EXCEPTION 'empty message';
  END IF;

  SELECT chat_enabled, chat_who_can_speak INTO v_enabled, v_who
  FROM public.communities WHERE id = p_community_id;
  IF v_enabled IS NULL THEN
    RAISE EXCEPTION 'community not found';
  END IF;
  IF NOT v_enabled THEN
    RAISE EXCEPTION 'chat is disabled for this community';
  END IF;

  SELECT role INTO v_role
  FROM public.community_members
  WHERE community_id = p_community_id AND user_id = v_uid;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'not a member';
  END IF;
  IF v_who = 'leadership' AND v_role NOT IN ('leader', 'co_leader') THEN
    RAISE EXCEPTION 'only leadership can post in this chat';
  END IF;

  INSERT INTO public.community_messages (community_id, sender_id, kind, body)
  VALUES (p_community_id, v_uid, 'message', LEFT(v_body, 4000))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.post_community_message(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.post_community_message(uuid, text) TO authenticated;

-- Re-create add_community_activity (from 0040) with a system notice on a
-- successful add. Body unchanged otherwise.
CREATE OR REPLACE FUNCTION public.add_community_activity(
  p_community_id uuid,
  p_activity_id  uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_owner uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.is_community_leadership(p_community_id, v_uid) THEN
    RAISE EXCEPTION 'not permitted';
  END IF;

  SELECT user_id INTO v_owner FROM public.activities WHERE id = p_activity_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'activity not found';
  END IF;
  IF v_owner <> v_uid THEN
    RAISE EXCEPTION 'you can only add your own activities';
  END IF;

  INSERT INTO public.community_activities (community_id, activity_id, added_by)
  VALUES (p_community_id, p_activity_id, v_uid)
  ON CONFLICT DO NOTHING;

  -- Only notify when a row was actually added (not a re-add / conflict).
  IF FOUND THEN
    PERFORM public._post_community_system(
      p_community_id,
      'Added activity: ' ||
        COALESCE((SELECT name FROM public.activities WHERE id = p_activity_id), 'an activity'),
      jsonb_build_object('type', 'activity_added', 'activity_id', p_activity_id)
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.add_community_activity(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.add_community_activity(uuid, uuid) TO authenticated;
