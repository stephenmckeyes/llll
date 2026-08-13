-- ---------------------------------------------------------------------------
-- 0053 — Invite to a community by username OR email.
--
-- Mirrors the friend-add flow (find_user_by_handle, migration 0010), which
-- resolves either a username or an email against profiles. Re-creates
-- invite_to_community from 0051 — only the target lookup changes (now also
-- matches profiles.email); the can_invite gate + member/dup guards are
-- unchanged. The param stays p_username (CREATE OR REPLACE can't rename it)
-- but now accepts either a handle or an email.
--
-- Requires 0010 (profiles.email), 0048 (community_invites), 0051
-- (has_community_permission).
-- ---------------------------------------------------------------------------

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

  -- Resolve by username or email (same rule as find_user_by_handle).
  SELECT id INTO v_target
  FROM public.profiles
  WHERE lower(username) = lower(trim(p_username))
     OR lower(email) = lower(trim(p_username))
  LIMIT 1;
  IF v_target IS NULL THEN
    RAISE EXCEPTION 'no user with that username or email';
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
