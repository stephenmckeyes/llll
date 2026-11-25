-- ---------------------------------------------------------------------------
-- 0085_invitations_select_policy.sql — fix 0084's invitations SELECT policy.
--
-- 0084's policy called can_view_invitation(id, …), which looks the row up BY
-- ID. Within the inserting statement that lookup can't see the brand-new row,
-- so INSERT … RETURNING (and any read-back in the same statement) failed RLS.
-- Evaluate the audience rules against the row's own columns instead.
-- (can_view_invitation stays — join_invitation / get_available_invitations
-- use it on committed rows, where it's correct.)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS invitations_select ON public.invitations;
CREATE POLICY invitations_select ON public.invitations
  FOR SELECT USING (
    host_user_id = auth.uid()
    OR audience IN ('public', 'nearby')
    OR (audience = 'community'
        AND public.is_community_member(audience_community_id, auth.uid()))
    OR (audience = 'friends' AND public._are_friends(host_user_id, auth.uid()))
    OR (host_community_id IS NOT NULL
        AND public.has_community_permission(host_community_id, auth.uid(), 'can_add_activities'))
    OR EXISTS (SELECT 1 FROM public.invitation_attendees a
               WHERE a.invitation_id = invitations.id AND a.user_id = auth.uid())
  );

NOTIFY pgrst, 'reload schema';
