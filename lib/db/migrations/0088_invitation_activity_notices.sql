-- ---------------------------------------------------------------------------
-- 0088_invitation_activity_notices.sql — two invitation notifications:
--   kind 'new'    — a NEW invitation was posted to your audience. Fanned out on
--                   INSERT to the host's accepted friends (audience 'friends')
--                   or the target community's members (audience 'community').
--                   'public' / 'nearby' don't fan out: "everyone" is too broad
--                   and we never store viewers' locations.
--   kind 'joined' — someone added your invitation to their calendar (to the
--                   host, i.e. host_user_id).
--   kind 'left'   — someone removed it again.
-- A join followed by a leave before the host looks cancels out (and vice
-- versa), so the host isn't told about flip-flops. Joining an invitation also
-- clears your own pending 'new' notice for it. Rows are dismissed from
-- /notifications (dismissed_at); reads go through get_invitation_activity_notices,
-- which resolves names the recipient may not be allowed to read directly.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.invitation_activity_notices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id uuid NOT NULL REFERENCES public.invitations(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,  -- recipient
  actor_id      uuid REFERENCES auth.users(id) ON DELETE CASCADE,           -- host / attendee
  kind          text NOT NULL CHECK (kind IN ('new', 'joined', 'left')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  dismissed_at  timestamptz
);

CREATE INDEX IF NOT EXISTS invitation_activity_notices_user_idx
  ON public.invitation_activity_notices (user_id) WHERE dismissed_at IS NULL;
CREATE INDEX IF NOT EXISTS invitation_activity_notices_inv_idx
  ON public.invitation_activity_notices (invitation_id);

ALTER TABLE public.invitation_activity_notices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invitation_activity_notices_select_own ON public.invitation_activity_notices;
CREATE POLICY invitation_activity_notices_select_own ON public.invitation_activity_notices
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS invitation_activity_notices_update_own ON public.invitation_activity_notices;
CREATE POLICY invitation_activity_notices_update_own ON public.invitation_activity_notices
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ---- new invitation → audience -------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_new_invitation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.audience = 'friends' THEN
    INSERT INTO public.invitation_activity_notices (invitation_id, user_id, actor_id, kind)
    SELECT NEW.id,
           CASE WHEN f.requester_id = NEW.host_user_id THEN f.addressee_id ELSE f.requester_id END,
           NEW.host_user_id, 'new'
    FROM public.friendships f
    WHERE f.status = 'accepted'
      AND (f.requester_id = NEW.host_user_id OR f.addressee_id = NEW.host_user_id);
  ELSIF NEW.audience = 'community' AND NEW.audience_community_id IS NOT NULL THEN
    INSERT INTO public.invitation_activity_notices (invitation_id, user_id, actor_id, kind)
    SELECT NEW.id, m.user_id, NEW.host_user_id, 'new'
    FROM public.community_members m
    WHERE m.community_id = NEW.audience_community_id
      AND m.user_id <> NEW.host_user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invitations_notify_new ON public.invitations;
CREATE TRIGGER invitations_notify_new
  AFTER INSERT ON public.invitations
  FOR EACH ROW EXECUTE FUNCTION public.notify_new_invitation();

-- ---- join / leave → host --------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_invitation_attendance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.invitation_attendees;
  v_host uuid;
  v_kind text;
  v_opposite text;
  v_cancelled int;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_row := NEW; v_kind := 'joined'; v_opposite := 'left';
    -- Joining clears the joiner's own "new invitation" notice.
    UPDATE public.invitation_activity_notices
    SET dismissed_at = now()
    WHERE invitation_id = NEW.invitation_id AND user_id = NEW.user_id
      AND kind = 'new' AND dismissed_at IS NULL;
  ELSE
    v_row := OLD; v_kind := 'left'; v_opposite := 'joined';
  END IF;

  -- The invitation may already be gone (cascade delete) → nothing to notify.
  SELECT host_user_id INTO v_host FROM public.invitations WHERE id = v_row.invitation_id;
  IF v_host IS NULL OR v_host = v_row.user_id THEN
    RETURN NULL;
  END IF;

  -- A pending opposite notice from the same person cancels out.
  DELETE FROM public.invitation_activity_notices
  WHERE invitation_id = v_row.invitation_id AND user_id = v_host
    AND actor_id = v_row.user_id AND kind = v_opposite AND dismissed_at IS NULL;
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;
  IF v_cancelled > 0 THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.invitation_activity_notices (invitation_id, user_id, actor_id, kind)
  VALUES (v_row.invitation_id, v_host, v_row.user_id, v_kind);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS invitation_attendees_notify_host ON public.invitation_attendees;
CREATE TRIGGER invitation_attendees_notify_host
  AFTER INSERT OR DELETE ON public.invitation_attendees
  FOR EACH ROW EXECUTE FUNCTION public.notify_invitation_attendance();

-- ---- read -------------------------------------------------------------------------
-- The caller's undismissed notices with display labels. 'new' notices for
-- invitations that have since been cancelled, or that the caller can no longer
-- see (e.g. left the community / unfriended), are dropped.

CREATE OR REPLACE FUNCTION public.get_invitation_activity_notices()
RETURNS TABLE (
  id uuid,
  invitation_id uuid,
  kind text,
  created_at timestamptz,
  invitation_name text,
  start_date date,
  location_name text,
  actor_label text,
  attendee_count int,
  capacity int,
  cancelled boolean
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT n.id, n.invitation_id, n.kind, n.created_at,
         i.name, i.start_date, i.location_name,
         CASE
           WHEN n.kind = 'new' AND c.name IS NOT NULL THEN c.name
           ELSE COALESCE(p.display_name, '@' || p.username, 'Someone')
         END,
         (SELECT count(*)::int FROM public.invitation_attendees x WHERE x.invitation_id = i.id),
         i.capacity,
         i.archived_at IS NOT NULL
  FROM public.invitation_activity_notices n
  JOIN public.invitations i ON i.id = n.invitation_id
  LEFT JOIN public.profiles p ON p.id = n.actor_id
  LEFT JOIN public.communities c ON c.id = i.host_community_id
  WHERE n.user_id = auth.uid()
    AND n.dismissed_at IS NULL
    AND (n.kind <> 'new'
         OR (i.archived_at IS NULL AND public.can_view_invitation(i.id, auth.uid())))
  ORDER BY n.created_at DESC
  LIMIT 100;
$$;
REVOKE ALL ON FUNCTION public.get_invitation_activity_notices() FROM public;
GRANT EXECUTE ON FUNCTION public.get_invitation_activity_notices() TO authenticated;

NOTIFY pgrst, 'reload schema';
