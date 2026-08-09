-- ===========================================================================
-- 0027_friend_reorder.sql — user-controlled friend ordering.
--
-- Adds friendships.sort_order (integer, nullable) and updates
-- social_overview() to return it. NULL means "no explicit order" — the
-- UI sorts NULLs last, tie-breaking by created_at DESC (newest first)
-- so existing friendships keep their historical order.
--
-- Reordering is done by the app via the moveFriendUp / moveFriendDown
-- server actions: they read the two rows involved, swap their
-- sort_order values, and update in a single transaction (or two writes
-- if the transaction wrapper isn't available). NULL rows are treated
-- as if their sort_order == a very large number, so the first move-up
-- assigns them a concrete integer.
--
-- Safe to re-run — CREATE OR REPLACE FUNCTION is compatible with the
-- previous shape (adds one column; existing callers still get the
-- other fields).
-- ===========================================================================

ALTER TABLE public.friendships
  ADD COLUMN IF NOT EXISTS sort_order integer;

-- Drop the old function shape first (Postgres refuses to change the
-- return column list otherwise). Both callers (Friends page +
-- Notifications page) request every field explicitly by name, so a
-- widened return list is backward-compatible.
DROP FUNCTION IF EXISTS public.social_overview();

CREATE OR REPLACE FUNCTION public.social_overview()
RETURNS TABLE (
  friendship_id      uuid,
  other_id           uuid,
  other_username     text,
  other_display_name text,
  status             text,
  direction          text,
  created_at         timestamptz,
  sort_order         integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    f.id,
    CASE WHEN f.requester_id = auth.uid()
         THEN f.addressee_id ELSE f.requester_id END,
    p.username,
    p.display_name,
    f.status,
    CASE WHEN f.requester_id = auth.uid()
         THEN 'outgoing' ELSE 'incoming' END,
    f.created_at,
    f.sort_order
  FROM public.friendships f
  JOIN public.profiles p
    ON p.id = CASE WHEN f.requester_id = auth.uid()
                   THEN f.addressee_id ELSE f.requester_id END
  WHERE f.requester_id = auth.uid() OR f.addressee_id = auth.uid()
  ORDER BY f.sort_order ASC NULLS LAST, f.created_at DESC;
$$;
