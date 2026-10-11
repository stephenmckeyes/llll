-- ---------------------------------------------------------------------------
-- 0076 — Coaches phase 3: share your activities with a coach.
--
-- Like friends, a client can share specific activities (read-only) with their
-- coach so the coach can review their routines. This extends the activity_shares
-- INSERT policy (migration 0011) to permit a share between a pair joined by an
-- accepted friendship OR an active coaching relationship — mirroring what 0073
-- did for messages. The share-notification message the share action posts is
-- already allowed for coaching pairs (0073).
--
-- Reads are unchanged: get_shared_with_me() already returns every rhythm shared
-- WITH the caller regardless of the relationship type, so the coach sees the
-- client's shared activities.
--
-- Requires 0011 (activity_shares) + 0073 (coaching_relationships).
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS activity_shares_owner_insert ON public.activity_shares;
CREATE POLICY activity_shares_owner_insert ON public.activity_shares
  FOR INSERT WITH CHECK (
    owner_id = auth.uid()
    AND (
      EXISTS (
        SELECT 1 FROM public.friendships f
        WHERE f.status = 'accepted'
          AND (
            (f.requester_id = auth.uid() AND f.addressee_id = shared_with_id)
            OR (f.addressee_id = auth.uid() AND f.requester_id = shared_with_id)
          )
      )
      OR EXISTS (
        SELECT 1 FROM public.coaching_relationships c
        WHERE c.status = 'active'
          AND (
            (c.coach_user_id = auth.uid() AND c.client_user_id = shared_with_id)
            OR (c.client_user_id = auth.uid() AND c.coach_user_id = shared_with_id)
          )
      )
    )
  );

NOTIFY pgrst, 'reload schema';
