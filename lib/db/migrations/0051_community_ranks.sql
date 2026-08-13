-- ---------------------------------------------------------------------------
-- 0051 — Custom ranks + a real permission model (Phase 4 leftover).
--
-- Until now leadership was the fixed pair leader/co_leader and every gated
-- mutation checked is_community_leadership(). This introduces custom ranks
-- (community_ranks already exists from 0031) that carry a per-permission
-- bitmap, assignable to members via community_members.role = 'rank:<uuid>'.
--
-- has_community_permission(community, user, perm) is the new single gate:
--   * leader / co_leader        → true for every permission
--   * 'rank:<id>'               → that rank's permissions jsonb
--   * 'member' / not-a-member   → false
-- Because leadership resolves to true for everything, swapping an
-- is_community_leadership() gate for has_community_permission(...,'perm') can
-- only WIDEN access to rank holders — existing leaders keep full access.
--
-- Permission keys: can_invite, can_approve_requests, can_add_activities,
-- can_edit_settings, can_promote, can_kick.
--
-- Requires 0031 (community_ranks), 0040 (is_community_leadership /
-- is_community_member), 0044 (_community_display_name / notice helpers),
-- 0047 (add_community_activity fan-out), 0049 (get_my_incoming_join_requests).
-- ---------------------------------------------------------------------------

-- ---- permission resolver --------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_community_permission(
  p_community_id uuid,
  p_user_id uuid,
  p_perm text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_rank_id uuid;
  v_perms jsonb;
BEGIN
  SELECT role INTO v_role
  FROM public.community_members
  WHERE community_id = p_community_id AND user_id = p_user_id;

  IF v_role IS NULL THEN
    RETURN false;
  END IF;
  IF v_role IN ('leader', 'co_leader') THEN
    RETURN true;
  END IF;
  IF v_role LIKE 'rank:%' AND
     substring(v_role from 6) ~ '^[0-9a-fA-F-]{36}$' THEN
    v_rank_id := substring(v_role from 6)::uuid;
    SELECT permissions INTO v_perms
    FROM public.community_ranks
    WHERE id = v_rank_id AND community_id = p_community_id;
    IF v_perms IS NULL THEN
      RETURN false;
    END IF;
    RETURN COALESCE((v_perms ->> p_perm)::boolean, false);
  END IF;
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.has_community_permission(uuid, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.has_community_permission(uuid, uuid, text) TO authenticated;

-- ---- rank CRUD ------------------------------------------------------------
-- get_community_ranks — any member can read the rank list (needed to render
-- rank names in the member roster + the rank editor).
CREATE OR REPLACE FUNCTION public.get_community_ranks(
  p_community_id uuid
)
RETURNS TABLE (
  id          uuid,
  name        text,
  sort_order  int,
  permissions jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_community_member(p_community_id, auth.uid()) THEN
    RAISE EXCEPTION 'not permitted';
  END IF;
  RETURN QUERY
    SELECT r.id, r.name, r.sort_order, r.permissions
    FROM public.community_ranks r
    WHERE r.community_id = p_community_id
    ORDER BY r.sort_order ASC, r.name ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_community_ranks(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_community_ranks(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_community_rank(
  p_community_id uuid,
  p_name text,
  p_permissions jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_name text := trim(p_name);
BEGIN
  IF NOT public.has_community_permission(p_community_id, auth.uid(), 'can_edit_settings') THEN
    RAISE EXCEPTION 'not permitted';
  END IF;
  IF v_name = '' OR length(v_name) > 40 THEN
    RAISE EXCEPTION 'rank name must be 1–40 characters';
  END IF;

  INSERT INTO public.community_ranks (community_id, name, permissions)
  VALUES (p_community_id, v_name, COALESCE(p_permissions, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'a rank with that name already exists';
END;
$$;

REVOKE ALL ON FUNCTION public.create_community_rank(uuid, text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.create_community_rank(uuid, text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_community_rank(
  p_rank_id uuid,
  p_name text,
  p_permissions jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_community uuid;
  v_name text := trim(p_name);
BEGIN
  SELECT community_id INTO v_community
  FROM public.community_ranks WHERE id = p_rank_id;
  IF v_community IS NULL THEN
    RAISE EXCEPTION 'rank not found';
  END IF;
  IF NOT public.has_community_permission(v_community, auth.uid(), 'can_edit_settings') THEN
    RAISE EXCEPTION 'not permitted';
  END IF;
  IF v_name = '' OR length(v_name) > 40 THEN
    RAISE EXCEPTION 'rank name must be 1–40 characters';
  END IF;

  UPDATE public.community_ranks
  SET name = v_name,
      permissions = COALESCE(p_permissions, '{}'::jsonb)
  WHERE id = p_rank_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'a rank with that name already exists';
END;
$$;

REVOKE ALL ON FUNCTION public.update_community_rank(uuid, text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.update_community_rank(uuid, text, jsonb) TO authenticated;

-- delete_community_rank — drop the rank and demote anyone holding it back to
-- plain member (so no member is left pointing at a missing rank).
CREATE OR REPLACE FUNCTION public.delete_community_rank(
  p_rank_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_community uuid;
BEGIN
  SELECT community_id INTO v_community
  FROM public.community_ranks WHERE id = p_rank_id;
  IF v_community IS NULL THEN
    RAISE EXCEPTION 'rank not found';
  END IF;
  IF NOT public.has_community_permission(v_community, auth.uid(), 'can_edit_settings') THEN
    RAISE EXCEPTION 'not permitted';
  END IF;

  UPDATE public.community_members
  SET role = 'member'
  WHERE community_id = v_community AND role = 'rank:' || p_rank_id::text;

  DELETE FROM public.community_ranks WHERE id = p_rank_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_community_rank(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.delete_community_rank(uuid) TO authenticated;

-- ---- re-gate operational RPCs on has_community_permission -----------------
-- Each body is unchanged except the permission check. Leadership still
-- passes (resolver returns true for them); rank holders now pass too.

-- invite_to_community (was is_community_leadership) → can_invite
CREATE OR REPLACE FUNCTION public.invite_to_community(
  p_community_id uuid,
  p_username text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_target uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.has_community_permission(p_community_id, v_uid, 'can_invite') THEN
    RAISE EXCEPTION 'not permitted';
  END IF;

  SELECT id INTO v_target
  FROM public.profiles
  WHERE lower(username) = lower(trim(p_username));
  IF v_target IS NULL THEN
    RAISE EXCEPTION 'no user with that username';
  END IF;
  IF public.is_community_member(p_community_id, v_target) THEN
    RAISE EXCEPTION 'already a member';
  END IF;

  INSERT INTO public.community_invites (community_id, invited_user_id, invited_by)
  VALUES (p_community_id, v_target, v_uid)
  ON CONFLICT DO NOTHING;
  RETURN 'invited';
END;
$$;

REVOKE ALL ON FUNCTION public.invite_to_community(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.invite_to_community(uuid, text) TO authenticated;

-- decide_join_request (was role IN leader/co_leader) → can_approve_requests
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
  IF NOT public.has_community_permission(v_community, v_uid, 'can_approve_requests') THEN
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

-- get_my_incoming_join_requests (was is_community_leadership) → can_approve_requests
CREATE OR REPLACE FUNCTION public.get_my_incoming_join_requests()
RETURNS TABLE (
  id             uuid,
  community_id   uuid,
  community_name text,
  community_kind text,
  requester_name text,
  note           text,
  created_at     timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.id, r.community_id, c.name, c.kind,
    public._community_display_name(r.user_id), r.note, r.created_at
  FROM public.community_join_requests r
  JOIN public.communities c ON c.id = r.community_id
  WHERE r.status = 'pending'
    AND public.has_community_permission(r.community_id, auth.uid(), 'can_approve_requests')
  ORDER BY r.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_my_incoming_join_requests() FROM public;
GRANT EXECUTE ON FUNCTION public.get_my_incoming_join_requests() TO authenticated;

-- kick_member (was is_community_leadership) → can_kick
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
  IF NOT public.has_community_permission(p_community_id, v_uid, 'can_kick') THEN
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
  -- Only real leadership may remove another leader/co-leader; a plain
  -- can_kick rank holder cannot remove leadership.
  IF v_target_role IN ('leader', 'co_leader')
     AND NOT public.is_community_leadership(p_community_id, v_uid) THEN
    RAISE EXCEPTION 'only leaders can remove leadership';
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

-- add_community_activity (was is_community_leadership) → can_add_activities.
-- Body incl. fan-out unchanged from 0047 apart from the gate.
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
  IF NOT public.has_community_permission(p_community_id, v_uid, 'can_add_activities') THEN
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

  IF FOUND THEN
    PERFORM public._post_community_system(
      p_community_id,
      'Added activity: ' ||
        COALESCE((SELECT name FROM public.activities WHERE id = p_activity_id), 'an activity'),
      jsonb_build_object('type', 'activity_added', 'activity_id', p_activity_id)
    );

    INSERT INTO public.activities (
      user_id, name, notes, rhythm, start_date, end_date,
      scheduled_times, scheduled_end_times, priority, default_skill_tags,
      track_on_grid, rollover_missed_days, rollover_change_rhythm, auto_archive
    )
    SELECT
      p.user_id, a.name, a.notes, a.rhythm, CURRENT_DATE, a.end_date,
      a.scheduled_times, a.scheduled_end_times, a.priority, a.default_skill_tags,
      a.track_on_grid, a.rollover_missed_days, a.rollover_change_rhythm, a.auto_archive
    FROM public.community_auto_add_prefs p
    JOIN public.activities a ON a.id = p_activity_id
    WHERE p.community_id = p_community_id
      AND p.auto_add = true
      AND p.user_id <> v_uid;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.add_community_activity(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.add_community_activity(uuid, uuid) TO authenticated;

-- remove_community_activity (was is_community_leadership) → can_add_activities
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
  IF NOT public.has_community_permission(p_community_id, v_uid, 'can_add_activities') THEN
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

-- set_member_role — now can_promote-gated + accepts 'rank:<uuid>' targets.
-- Escalation guard: only real leadership may grant OR change leadership
-- roles, so a can_promote rank holder can only shuffle members/ranks.
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
  v_is_leadership boolean;
  v_label text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.has_community_permission(p_community_id, v_uid, 'can_promote') THEN
    RAISE EXCEPTION 'not permitted';
  END IF;

  -- Validate the target role: fixed roles or an existing rank of THIS community.
  IF p_role NOT IN ('leader', 'co_leader', 'member') THEN
    IF p_role LIKE 'rank:%' AND substring(p_role from 6) ~ '^[0-9a-fA-F-]{36}$'
       AND EXISTS (
         SELECT 1 FROM public.community_ranks
         WHERE id = substring(p_role from 6)::uuid
           AND community_id = p_community_id
       ) THEN
      NULL; -- valid rank
    ELSE
      RAISE EXCEPTION 'invalid role: %', p_role;
    END IF;
  END IF;

  SELECT role INTO v_target_role
  FROM public.community_members
  WHERE community_id = p_community_id AND user_id = p_user_id;
  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'not a member';
  END IF;

  v_is_leadership := public.is_community_leadership(p_community_id, v_uid);

  -- Escalation guard: touching leadership (granting it, or changing a
  -- current leader/co-leader) requires being real leadership yourself.
  IF (p_role IN ('leader', 'co_leader')
      OR v_target_role IN ('leader', 'co_leader'))
     AND NOT v_is_leadership THEN
    RAISE EXCEPTION 'only leaders can change leadership roles';
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
    v_label := CASE
      WHEN p_role = 'leader' THEN 'a leader'
      WHEN p_role = 'co_leader' THEN 'a co-leader'
      WHEN p_role = 'member' THEN 'a member'
      ELSE COALESCE(
        (SELECT name FROM public.community_ranks
          WHERE id = substring(p_role from 6)::uuid),
        'a member')
    END;
    PERFORM public._post_community_system(
      p_community_id,
      COALESCE(public._community_display_name(p_user_id), 'A member') ||
        ' is now ' || v_label,
      jsonb_build_object('type', 'role_changed', 'user_id', p_user_id, 'role', p_role)
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_member_role(uuid, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.set_member_role(uuid, uuid, text) TO authenticated;
