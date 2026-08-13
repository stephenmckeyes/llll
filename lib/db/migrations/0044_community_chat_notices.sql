-- ---------------------------------------------------------------------------
-- 0044 — Community chat: system notices for the remaining change events.
--
-- 0043 wired the first notice (activity added). This re-creates the rest of
-- the community mutation RPCs so each posts a system notice too:
--   member joined (approve / open-join), member left, member removed,
--   role changed, activity removed.
--
-- The RPC bodies are otherwise identical to their originals (0031/0040/0041)
-- — the only change is the added _post_community_system() call. Function-only
-- migration (no new columns), so the schema-check banner won't flag it —
-- apply it manually.
--
-- Requires 0043 (_post_community_system + community_messages).
-- ---------------------------------------------------------------------------

-- Friendly display label for a user, for notice text.
CREATE OR REPLACE FUNCTION public._community_display_name(
  p_user_id uuid
) RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    NULLIF(TRIM(display_name), ''),
    NULLIF('@' || username, '@'),
    'Someone'
  )
  FROM public.profiles
  WHERE id = p_user_id;
$$;

REVOKE ALL ON FUNCTION public._community_display_name(uuid) FROM public;

-- ---- request_join_community (adds "joined" notice on open join) ----------
CREATE OR REPLACE FUNCTION public.request_join_community(
  p_community_id uuid,
  p_note text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_policy text;
  v_visibility text;
  v_existing_member boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT join_policy, visibility INTO v_policy, v_visibility
  FROM public.communities WHERE id = p_community_id;
  IF v_policy IS NULL THEN
    RAISE EXCEPTION 'community not found';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.community_members
    WHERE community_id = p_community_id AND user_id = v_uid
  ) INTO v_existing_member;
  IF v_existing_member THEN
    RETURN 'already_member';
  END IF;

  IF v_policy = 'invite' THEN
    RAISE EXCEPTION 'this community is invite-only';
  END IF;

  IF v_policy = 'open' THEN
    INSERT INTO public.community_members (community_id, user_id, role)
    VALUES (p_community_id, v_uid, 'member');
    PERFORM public._post_community_system(
      p_community_id,
      COALESCE(public._community_display_name(v_uid), 'Someone') || ' joined',
      jsonb_build_object('type', 'member_joined', 'user_id', v_uid)
    );
    RETURN 'joined';
  END IF;

  INSERT INTO public.community_join_requests (community_id, user_id, note)
  VALUES (p_community_id, v_uid, NULLIF(TRIM(p_note), ''))
  ON CONFLICT DO NOTHING;
  RETURN 'requested';
END;
$$;

REVOKE ALL ON FUNCTION public.request_join_community(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.request_join_community(uuid, text) TO authenticated;

-- ---- decide_join_request (adds "joined" notice on approve) ---------------
CREATE OR REPLACE FUNCTION public.decide_join_request(
  p_request_id uuid,
  p_approve boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_community uuid;
  v_user uuid;
  v_status text;
  v_my_role text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT community_id, user_id, status
    INTO v_community, v_user, v_status
  FROM public.community_join_requests WHERE id = p_request_id;
  IF v_community IS NULL THEN
    RAISE EXCEPTION 'request not found';
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'request is not pending';
  END IF;

  SELECT role INTO v_my_role
  FROM public.community_members
  WHERE community_id = v_community AND user_id = v_uid;
  IF v_my_role NOT IN ('leader', 'co_leader') THEN
    RAISE EXCEPTION 'not permitted';
  END IF;

  UPDATE public.community_join_requests
    SET status = CASE WHEN p_approve THEN 'approved' ELSE 'declined' END,
        handled_by = v_uid,
        handled_at = now()
    WHERE id = p_request_id;

  IF p_approve THEN
    INSERT INTO public.community_members (community_id, user_id, role)
    VALUES (v_community, v_user, 'member')
    ON CONFLICT DO NOTHING;
    PERFORM public._post_community_system(
      v_community,
      COALESCE(public._community_display_name(v_user), 'Someone') || ' joined',
      jsonb_build_object('type', 'member_joined', 'user_id', v_user)
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.decide_join_request(uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.decide_join_request(uuid, boolean) TO authenticated;

-- ---- leave_community (adds "left" notice) --------------------------------
CREATE OR REPLACE FUNCTION public.leave_community(
  p_community_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_leader_count int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT role INTO v_role
  FROM public.community_members
  WHERE community_id = p_community_id AND user_id = v_uid;
  IF v_role IS NULL THEN
    RETURN;
  END IF;

  IF v_role = 'leader' THEN
    SELECT COUNT(*) INTO v_leader_count
    FROM public.community_members
    WHERE community_id = p_community_id AND role = 'leader';
    IF v_leader_count <= 1 THEN
      RAISE EXCEPTION 'last leader cannot leave — promote a co-leader or delete the community first';
    END IF;
  END IF;

  DELETE FROM public.community_members
  WHERE community_id = p_community_id AND user_id = v_uid;

  PERFORM public._post_community_system(
    p_community_id,
    COALESCE(public._community_display_name(v_uid), 'Someone') || ' left',
    jsonb_build_object('type', 'member_left', 'user_id', v_uid)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.leave_community(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.leave_community(uuid) TO authenticated;

-- ---- set_member_role (adds "is now …" notice) ----------------------------
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

  IF v_target_role <> p_role THEN
    PERFORM public._post_community_system(
      p_community_id,
      COALESCE(public._community_display_name(p_user_id), 'A member') ||
        ' is now ' ||
        CASE p_role
          WHEN 'leader' THEN 'a leader'
          WHEN 'co_leader' THEN 'a co-leader'
          ELSE 'a member'
        END,
      jsonb_build_object('type', 'role_changed', 'user_id', p_user_id, 'role', p_role)
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_member_role(uuid, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.set_member_role(uuid, uuid, text) TO authenticated;

-- ---- kick_member (adds "was removed" notice) -----------------------------
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
    RETURN;
  END IF;
  IF v_target_role = 'leader' THEN
    RAISE EXCEPTION 'demote this leader before removing them';
  END IF;

  DELETE FROM public.community_members
  WHERE community_id = p_community_id AND user_id = p_user_id;

  PERFORM public._post_community_system(
    p_community_id,
    COALESCE(public._community_display_name(p_user_id), 'A member') || ' was removed',
    jsonb_build_object('type', 'member_removed', 'user_id', p_user_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.kick_member(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.kick_member(uuid, uuid) TO authenticated;

-- ---- remove_community_activity (adds "Removed activity" notice) ----------
CREATE OR REPLACE FUNCTION public.remove_community_activity(
  p_community_id uuid,
  p_activity_id  uuid
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

  DELETE FROM public.community_activities
  WHERE community_id = p_community_id AND activity_id = p_activity_id;

  IF FOUND THEN
    PERFORM public._post_community_system(
      p_community_id,
      'Removed activity: ' ||
        COALESCE((SELECT name FROM public.activities WHERE id = p_activity_id), 'an activity'),
      jsonb_build_object('type', 'activity_removed', 'activity_id', p_activity_id)
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.remove_community_activity(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.remove_community_activity(uuid, uuid) TO authenticated;
