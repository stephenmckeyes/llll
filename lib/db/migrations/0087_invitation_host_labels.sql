-- ---------------------------------------------------------------------------
-- 0087_invitation_host_labels.sql — host display names for invitation change
-- notices. An attendee may not be friends with the host, so profiles RLS hides
-- the host's name; this returns ONLY the label (community name, else the
-- person's display name / @username) for invitations the caller attends or has
-- a notice for.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_invitation_host_labels(p_ids uuid[])
RETURNS TABLE (invitation_id uuid, host_label text)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT i.id,
         COALESCE(c.name, p.display_name, '@' || p.username, 'The host')
  FROM public.invitations i
  LEFT JOIN public.communities c ON c.id = i.host_community_id
  LEFT JOIN public.profiles p ON p.id = i.host_user_id
  WHERE i.id = ANY (p_ids)
    AND (
      EXISTS (SELECT 1 FROM public.invitation_attendees a
              WHERE a.invitation_id = i.id AND a.user_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.invitation_change_notices n
                 WHERE n.invitation_id = i.id AND n.user_id = auth.uid())
    );
$$;
REVOKE ALL ON FUNCTION public.get_invitation_host_labels(uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.get_invitation_host_labels(uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
