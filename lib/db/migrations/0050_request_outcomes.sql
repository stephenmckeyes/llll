-- ---------------------------------------------------------------------------
-- 0050 — Tell the requester what happened to their join request.
--
-- Today a requester only implicitly learns of an APPROVAL (they show up as a
-- member) and gets no signal at all on a DECLINE. This adds a dismissible
-- outcome feed for the requester's own decided requests, surfaced on
-- /notifications + the nav badge.
--
--   * community_join_requests.dismissed — the requester has cleared the
--     outcome from their notifications.
--   * get_my_request_outcomes() — the caller's approved/declined, not-yet-
--     dismissed requests (SECURITY DEFINER so a private community's name is
--     visible to a declined requester who isn't a member).
--   * dismiss_request_outcome(request) — the requester clears one.
--
-- Requires 0031 (community_join_requests).
-- ---------------------------------------------------------------------------

ALTER TABLE public.community_join_requests
  ADD COLUMN IF NOT EXISTS dismissed boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.get_my_request_outcomes()
RETURNS TABLE (
  id             uuid,
  community_id   uuid,
  community_name text,
  community_kind text,
  status         text,
  handled_at     timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.id, r.community_id, c.name, c.kind, r.status, r.handled_at
  FROM public.community_join_requests r
  JOIN public.communities c ON c.id = r.community_id
  WHERE r.user_id = auth.uid()
    AND r.status IN ('approved', 'declined')
    AND r.dismissed = false
  ORDER BY r.handled_at DESC NULLS LAST, r.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_my_request_outcomes() FROM public;
GRANT EXECUTE ON FUNCTION public.get_my_request_outcomes() TO authenticated;

CREATE OR REPLACE FUNCTION public.dismiss_request_outcome(
  p_request_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.community_join_requests
  SET dismissed = true
  WHERE id = p_request_id AND user_id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.dismiss_request_outcome(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.dismiss_request_outcome(uuid) TO authenticated;
