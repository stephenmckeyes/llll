-- ---------------------------------------------------------------------------
-- 0048 — Community invites (Phase 6).
--
-- Leadership invites a specific user (by username) to a community; the
-- invitee accepts or declines from their Notifications page. Complements
-- the existing request-to-join flow (community_join_requests).
--
-- Requires 0031 (is_community_member) and 0040 (is_community_leadership).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.community_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  invited_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One PENDING invite per (community, user); re-inviting after a decline is
-- fine (the declined row stays, a new pending one is allowed).
CREATE UNIQUE INDEX IF NOT EXISTS community_invites_pending_uniq
  ON public.community_invites (community_id, invited_user_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS community_invites_invitee_idx
  ON public.community_invites (invited_user_id, status);

ALTER TABLE public.community_invites ENABLE ROW LEVEL SECURITY;

-- The invitee sees their own invites; leadership sees the community's.
DROP POLICY IF EXISTS community_invites_select ON public.community_invites;
CREATE POLICY community_invites_select ON public.community_invites
  FOR SELECT
  USING (
    invited_user_id = auth.uid()
    OR public.is_community_leadership(community_id, auth.uid())
  );

-- Writes go through the RPCs below.

-- invite_to_community — leadership invite a user by username.
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
  IF NOT public.is_community_leadership(p_community_id, v_uid) THEN
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
  ON CONFLICT DO NOTHING; -- already has a pending invite → no-op

  RETURN 'invited';
END;
$$;

REVOKE ALL ON FUNCTION public.invite_to_community(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.invite_to_community(uuid, text) TO authenticated;

-- respond_to_invite — the invitee accepts (joins) or declines.
CREATE OR REPLACE FUNCTION public.respond_to_invite(
  p_invite_id uuid,
  p_accept boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_community uuid;
  v_invitee uuid;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT community_id, invited_user_id, status
    INTO v_community, v_invitee, v_status
  FROM public.community_invites WHERE id = p_invite_id;
  IF v_community IS NULL THEN
    RAISE EXCEPTION 'invite not found';
  END IF;
  IF v_invitee <> v_uid THEN
    RAISE EXCEPTION 'not your invite';
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'invite already handled';
  END IF;

  UPDATE public.community_invites
    SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END
    WHERE id = p_invite_id;

  IF p_accept THEN
    INSERT INTO public.community_members (community_id, user_id, role)
    VALUES (v_community, v_uid, 'member')
    ON CONFLICT DO NOTHING;
    PERFORM public._post_community_system(
      v_community,
      COALESCE(public._community_display_name(v_uid), 'Someone') || ' joined',
      jsonb_build_object('type', 'member_joined', 'user_id', v_uid)
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.respond_to_invite(uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.respond_to_invite(uuid, boolean) TO authenticated;

-- get_my_pending_invites — the caller's pending invites, with the community
-- name/kind + inviter name. SECURITY DEFINER so a PRIVATE community's name
-- is visible to the invitee (who isn't a member yet, so RLS would hide it).
CREATE OR REPLACE FUNCTION public.get_my_pending_invites()
RETURNS TABLE (
  id              uuid,
  community_id    uuid,
  community_name  text,
  community_kind  text,
  invited_by_name text,
  created_at      timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    i.id, i.community_id, c.name, c.kind,
    public._community_display_name(i.invited_by), i.created_at
  FROM public.community_invites i
  JOIN public.communities c ON c.id = i.community_id
  WHERE i.invited_user_id = auth.uid()
    AND i.status = 'pending'
  ORDER BY i.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_my_pending_invites() FROM public;
GRANT EXECUTE ON FUNCTION public.get_my_pending_invites() TO authenticated;
