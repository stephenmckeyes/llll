-- ---------------------------------------------------------------------------
-- 0054 — Outsider visibility for public clubs/guilds (Phase 5 leftover).
--
-- Leadership chooses how much a NON-member sees when previewing a public
-- community before joining: the basics (name / description / member count)
-- are always shown; the member roster and/or the shared activity list are
-- opt-in. Backed by the existing communities.outsider_visibility jsonb
-- (migration 0031), keyed { showMembers, showActivities }.
--
--   * set_community_outsider_visibility(...) — can_edit_settings gated.
--   * get_community_preview(community) — one SECURITY DEFINER read that
--     returns the basics always, and members/activities only when allowed
--     (or when the caller is already a member). Private + non-member → NULL.
--
-- Function-only. Requires 0031 (outsider_visibility column), 0040/0051
-- (is_community_member, has_community_permission).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_community_outsider_visibility(
  p_community_id uuid,
  p_show_members boolean,
  p_show_activities boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_community_permission(p_community_id, auth.uid(), 'can_edit_settings') THEN
    RAISE EXCEPTION 'not permitted';
  END IF;
  UPDATE public.communities
  SET outsider_visibility = jsonb_build_object(
        'showMembers', COALESCE(p_show_members, false),
        'showActivities', COALESCE(p_show_activities, false)
      )
  WHERE id = p_community_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_community_outsider_visibility(uuid, boolean, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.set_community_outsider_visibility(uuid, boolean, boolean) TO authenticated;

-- get_community_preview — a single read for the discovery preview. Members
-- always see everything; non-members see the basics plus whatever the
-- outsider_visibility flags permit. Private + non-member → NULL.
CREATE OR REPLACE FUNCTION public.get_community_preview(
  p_community_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  c RECORD;
  v_is_member boolean;
  v_show_members boolean;
  v_show_activities boolean;
  v_count int;
  v_members jsonb;
  v_activities jsonb;
BEGIN
  SELECT id, name, description, handle, kind, join_policy, visibility,
         COALESCE((outsider_visibility ->> 'showMembers')::boolean, false)    AS osm,
         COALESCE((outsider_visibility ->> 'showActivities')::boolean, false) AS osa
    INTO c
  FROM public.communities
  WHERE id = p_community_id;
  IF c.id IS NULL THEN
    RETURN NULL;
  END IF;

  v_is_member := public.is_community_member(p_community_id, auth.uid());
  IF c.visibility <> 'public' AND NOT v_is_member THEN
    RETURN NULL; -- private communities never preview to outsiders
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.community_members
  WHERE community_id = p_community_id;

  v_show_members := v_is_member OR (c.visibility = 'public' AND c.osm);
  v_show_activities := v_is_member OR (c.visibility = 'public' AND c.osa);

  IF v_show_members THEN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'display_name', p.display_name,
          'username', p.username,
          'role', m.role
        ) ORDER BY m.joined_at
      ),
      '[]'::jsonb
    ) INTO v_members
    FROM public.community_members m
    JOIN public.profiles p ON p.id = m.user_id
    WHERE m.community_id = p_community_id;
  ELSE
    v_members := '[]'::jsonb;
  END IF;

  IF v_show_activities THEN
    SELECT COALESCE(
      jsonb_agg(jsonb_build_object('name', a.name) ORDER BY a.name),
      '[]'::jsonb
    ) INTO v_activities
    FROM public.community_activities ca
    JOIN public.activities a ON a.id = ca.activity_id
    WHERE ca.community_id = p_community_id;
  ELSE
    v_activities := '[]'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'description', c.description,
    'handle', c.handle,
    'kind', c.kind,
    'join_policy', c.join_policy,
    'visibility', c.visibility,
    'member_count', v_count,
    'is_member', v_is_member,
    'show_members', v_show_members,
    'show_activities', v_show_activities,
    'members', v_members,
    'activities', v_activities
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_community_preview(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_community_preview(uuid) TO authenticated;
