-- ---------------------------------------------------------------------------
-- 0041 — Community Settings (Phase 4, first slice).
--
-- The per-community Settings area: member management (promote / demote /
-- kick), admittance (join policy + visibility), and chat settings
-- (enable + who-can-speak). Custom ranks (community_ranks) are a later
-- slice — this uses the existing leader / co_leader / member roles.
--
-- Builds on 0031 (roles + is_community_member) and 0040
-- (is_community_leadership). All writes are leadership-gated SECURITY
-- DEFINER RPCs, matching the existing conventions.
-- ---------------------------------------------------------------------------

-- Chat settings columns (the chat surface itself is Phase 7; the settings
-- live here in Phase 4). who_can_speak: 'everyone' | 'leadership'.
ALTER TABLE public.communities
  ADD COLUMN IF NOT EXISTS chat_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE public.communities
  ADD COLUMN IF NOT EXISTS chat_who_can_speak text NOT NULL DEFAULT 'everyone';

-- ---- set_member_role -------------------------------------------------------
-- Leadership set another member's role. Guards: valid role, target is a
-- member, and the community always keeps >= 1 leader (can't demote the
-- last one).
CREATE OR REPLACE FUNCTION public.set_member_role(
  p_community_id uuid,
  p_user_id uuid,
  p_role text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_target_role text;
  v_leader_count int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.is_community_leadership(p_community_id, v_uid) THEN
    RAISE EXCEPTION 'not permitted';
  END IF;
  IF p_role NOT IN ('leader', 'co_leader', 'member') THEN
    RAISE EXCEPTION 'invalid role: %', p_role;
  END IF;

  SELECT role INTO v_target_role
  FROM public.community_members
  WHERE community_id = p_community_id AND user_id = p_user_id;
  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'not a member';
  END IF;

  -- Demoting the last leader would orphan the community.
  IF v_target_role = 'leader' AND p_role <> 'leader' THEN
    SELECT COUNT(*) INTO v_leader_count
    FROM public.community_members
    WHERE community_id = p_community_id AND role = 'leader';
    IF v_leader_count <= 1 THEN
      RAISE EXCEPTION 'cannot demote the last leader — promote someone else first';
    END IF;
  END IF;

  UPDATE public.community_members
  SET role = p_role
  WHERE community_id = p_community_id AND user_id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_member_role(uuid, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.set_member_role(uuid, uuid, text) TO authenticated;

-- ---- kick_member -----------------------------------------------------------
-- Leadership remove a member. Can't kick yourself (use leave) or a leader
-- (demote them first).
CREATE OR REPLACE FUNCTION public.kick_member(
  p_community_id uuid,
  p_user_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_target_role text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.is_community_leadership(p_community_id, v_uid) THEN
    RAISE EXCEPTION 'not permitted';
  END IF;
  IF p_user_id = v_uid THEN
    RAISE EXCEPTION 'use leave to remove yourself';
  END IF;

  SELECT role INTO v_target_role
  FROM public.community_members
  WHERE community_id = p_community_id AND user_id = p_user_id;
  IF v_target_role IS NULL THEN
    RETURN; -- already gone; no-op
  END IF;
  IF v_target_role = 'leader' THEN
    RAISE EXCEPTION 'demote this leader before removing them';
  END IF;

  DELETE FROM public.community_members
  WHERE community_id = p_community_id AND user_id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.kick_member(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.kick_member(uuid, uuid) TO authenticated;

-- ---- set_community_join_policy ---------------------------------------------
-- Leadership change how people join. Groups can't be 'open'.
CREATE OR REPLACE FUNCTION public.set_community_join_policy(
  p_community_id uuid,
  p_policy text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_kind text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.is_community_leadership(p_community_id, v_uid) THEN
    RAISE EXCEPTION 'not permitted';
  END IF;
  IF p_policy NOT IN ('open', 'application', 'invite') THEN
    RAISE EXCEPTION 'invalid join policy: %', p_policy;
  END IF;

  SELECT kind INTO v_kind FROM public.communities WHERE id = p_community_id;
  IF v_kind = 'group' AND p_policy = 'open' THEN
    RAISE EXCEPTION 'groups cannot be open — use invite or application';
  END IF;

  UPDATE public.communities
  SET join_policy = p_policy, updated_at = now()
  WHERE id = p_community_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_community_join_policy(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.set_community_join_policy(uuid, text) TO authenticated;

-- ---- set_community_visibility ----------------------------------------------
-- Leadership change visibility. Groups are always private.
CREATE OR REPLACE FUNCTION public.set_community_visibility(
  p_community_id uuid,
  p_visibility text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_kind text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.is_community_leadership(p_community_id, v_uid) THEN
    RAISE EXCEPTION 'not permitted';
  END IF;
  IF p_visibility NOT IN ('private', 'public') THEN
    RAISE EXCEPTION 'invalid visibility: %', p_visibility;
  END IF;

  SELECT kind INTO v_kind FROM public.communities WHERE id = p_community_id;
  IF v_kind = 'group' AND p_visibility <> 'private' THEN
    RAISE EXCEPTION 'groups are always private';
  END IF;

  UPDATE public.communities
  SET visibility = p_visibility, updated_at = now()
  WHERE id = p_community_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_community_visibility(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.set_community_visibility(uuid, text) TO authenticated;

-- ---- set_community_chat_settings -------------------------------------------
CREATE OR REPLACE FUNCTION public.set_community_chat_settings(
  p_community_id uuid,
  p_enabled boolean,
  p_who_can_speak text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.is_community_leadership(p_community_id, v_uid) THEN
    RAISE EXCEPTION 'not permitted';
  END IF;
  IF p_who_can_speak NOT IN ('everyone', 'leadership') THEN
    RAISE EXCEPTION 'invalid who_can_speak: %', p_who_can_speak;
  END IF;

  UPDATE public.communities
  SET chat_enabled = p_enabled,
      chat_who_can_speak = p_who_can_speak,
      updated_at = now()
  WHERE id = p_community_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_community_chat_settings(uuid, boolean, text) FROM public;
GRANT EXECUTE ON FUNCTION public.set_community_chat_settings(uuid, boolean, text) TO authenticated;
