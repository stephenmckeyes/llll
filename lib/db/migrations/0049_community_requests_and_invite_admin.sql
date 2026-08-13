-- ---------------------------------------------------------------------------
-- 0049 — Surface incoming join requests on /notifications, and let
-- leadership see + cancel the invites they've sent.
--
--   * get_my_incoming_join_requests() — every PENDING join request across
--     all communities where the caller is leadership (for /notifications +
--     the nav badge).
--   * get_community_pending_invites(community) — the community's PENDING
--     invites, leadership-gated (for the Settings "Pending invites" list).
--   * cancel_community_invite(invite) — leadership deletes a pending invite.
--
-- All SECURITY DEFINER so we can join in profile display names + community
-- names without fighting per-table RLS. Requires 0040 (is_community_
-- leadership), 0044 (_community_display_name), 0048 (community_invites).
-- ---------------------------------------------------------------------------

-- get_my_incoming_join_requests — pending requests to communities I lead.
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
    AND public.is_community_leadership(r.community_id, auth.uid())
  ORDER BY r.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_my_incoming_join_requests() FROM public;
GRANT EXECUTE ON FUNCTION public.get_my_incoming_join_requests() TO authenticated;

-- get_community_pending_invites — the community's outstanding invites.
CREATE OR REPLACE FUNCTION public.get_community_pending_invites(
  p_community_id uuid
)
RETURNS TABLE (
  id           uuid,
  invitee_name text,
  created_at   timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_community_leadership(p_community_id, auth.uid()) THEN
    RAISE EXCEPTION 'not permitted';
  END IF;

  RETURN QUERY
    SELECT
      i.id,
      public._community_display_name(i.invited_user_id),
      i.created_at
    FROM public.community_invites i
    WHERE i.community_id = p_community_id
      AND i.status = 'pending'
    ORDER BY i.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_community_pending_invites(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_community_pending_invites(uuid) TO authenticated;

-- cancel_community_invite — leadership withdraws a pending invite.
CREATE OR REPLACE FUNCTION public.cancel_community_invite(
  p_invite_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_community uuid;
  v_status text;
BEGIN
  SELECT community_id, status INTO v_community, v_status
  FROM public.community_invites WHERE id = p_invite_id;
  IF v_community IS NULL THEN
    RAISE EXCEPTION 'invite not found';
  END IF;
  IF NOT public.is_community_leadership(v_community, auth.uid()) THEN
    RAISE EXCEPTION 'not permitted';
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'invite already handled';
  END IF;

  DELETE FROM public.community_invites WHERE id = p_invite_id;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_community_invite(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.cancel_community_invite(uuid) TO authenticated;
