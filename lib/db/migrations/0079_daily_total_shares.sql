-- ---------------------------------------------------------------------------
-- 0079 — Share your DAILY COMPLETION TOTAL (#/#) with a friend.
--
-- A lighter kind of sharing than per-activity: a friend sees how many of your
-- activities you completed each day (e.g. "3/5"), WITHOUT seeing which
-- activities. Individual activities stay private unless separately shared via
-- activity_shares.
--
--   * daily_total_shares (owner_id, shared_with_id) — owner opts to show their
--     daily total to a friend. Owner-managed; the recipient can read their own.
--   * get_friend_daily_totals(p_owner_id, p_from, p_to) — anon-of-detail,
--     aggregate-only SECURITY DEFINER read: per-day {completed, total} for the
--     owner, returned ONLY when the owner shared their total with the caller.
--     It exposes counts, never activity rows.
--
-- Requires 0010 (friendships) + 0002-era activities/activity_instances.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.daily_total_shares (
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  shared_with_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, shared_with_id),
  CHECK (owner_id <> shared_with_id)
);

CREATE INDEX IF NOT EXISTS daily_total_shares_recipient_idx
  ON public.daily_total_shares (shared_with_id);

ALTER TABLE public.daily_total_shares ENABLE ROW LEVEL SECURITY;

-- Either party can read the row (owner manages it; recipient can tell it's on).
DROP POLICY IF EXISTS daily_total_shares_select ON public.daily_total_shares;
CREATE POLICY daily_total_shares_select ON public.daily_total_shares
  FOR SELECT USING (
    owner_id = auth.uid() OR shared_with_id = auth.uid()
  );

-- Owner shares with an accepted friend only.
DROP POLICY IF EXISTS daily_total_shares_insert ON public.daily_total_shares;
CREATE POLICY daily_total_shares_insert ON public.daily_total_shares
  FOR INSERT WITH CHECK (
    owner_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.friendships f
      WHERE f.status = 'accepted'
        AND (
          (f.requester_id = auth.uid() AND f.addressee_id = shared_with_id)
          OR (f.addressee_id = auth.uid() AND f.requester_id = shared_with_id)
        )
    )
  );

DROP POLICY IF EXISTS daily_total_shares_delete ON public.daily_total_shares;
CREATE POLICY daily_total_shares_delete ON public.daily_total_shares
  FOR DELETE USING (owner_id = auth.uid());

-- Aggregate-only read: per-day completed/total for an owner who shared their
-- daily total with the caller. Returns counts only — never the activities.
CREATE OR REPLACE FUNCTION public.get_friend_daily_totals(
  p_owner_id uuid,
  p_from date,
  p_to date
)
RETURNS TABLE (day date, completed int, total int)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    i.scheduled_for AS day,
    COUNT(*) FILTER (WHERE i.status = 'completed')::int AS completed,
    COUNT(*)::int AS total
  FROM public.activity_instances i
  JOIN public.activities a ON a.id = i.activity_id AND a.archived_at IS NULL
  WHERE a.user_id = p_owner_id
    AND i.scheduled_for BETWEEN p_from AND p_to
    AND EXISTS (
      SELECT 1 FROM public.daily_total_shares d
      WHERE d.owner_id = p_owner_id AND d.shared_with_id = auth.uid()
    )
  GROUP BY i.scheduled_for
  HAVING COUNT(*) > 0
  ORDER BY i.scheduled_for;
$$;

REVOKE ALL ON FUNCTION public.get_friend_daily_totals(uuid, date, date) FROM public;
GRANT EXECUTE ON FUNCTION public.get_friend_daily_totals(uuid, date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';
