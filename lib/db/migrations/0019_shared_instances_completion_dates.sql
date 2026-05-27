-- ===========================================================================
-- 0019_shared_instances_completion_dates.sql
--
-- Add `completion_dates date[]` to get_shared_instances_with_me so the
-- friend view can place each completion on its own day in the dropdown
-- (matching the personal day view's new per-completion bucketing for
-- frequency / "N times per period" rhythms).
--
-- The owner's profile.timezone is used to convert occurred_at → date,
-- so a friend in a different timezone still sees the activity land on
-- the SAME calendar day the owner did. Without this we'd get UTC dates
-- (off-by-one for owners west of UTC late in their day).
--
-- Existing call sites already destructure the returned columns by name,
-- so adding a column is backward-compatible. The function signature
-- shape changes, which is why we CREATE OR REPLACE the whole thing.
--
-- Safe to re-run.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.get_shared_instances_with_me(
  p_from date,
  p_to   date
)
RETURNS TABLE (
  owner_id         uuid,
  activity_id      uuid,
  instance_id      uuid,
  scheduled_for    date,
  status           text,
  completion_count integer,
  completion_dates date[]
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.owner_id,
    a.id            AS activity_id,
    ai.id           AS instance_id,
    ai.scheduled_for,
    ai.status::text AS status,
    COALESCE(cc.cnt, 0)::integer       AS completion_count,
    COALESCE(cc.dates, ARRAY[]::date[]) AS completion_dates
  FROM public.activity_shares s
  JOIN public.activities a          ON a.id = s.activity_id
  JOIN public.activity_instances ai ON ai.activity_id = a.id
  JOIN public.profiles op           ON op.id = s.owner_id
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)::integer AS cnt,
      ARRAY_AGG(
        ((c.occurred_at AT TIME ZONE COALESCE(op.timezone, 'UTC'))::date)
        ORDER BY c.occurred_at
      ) AS dates
    FROM public.completion_instances ci
    JOIN public.completions c
      ON c.id = ci.completion_id AND c.deleted_at IS NULL
    WHERE ci.instance_id = ai.id
  ) cc ON TRUE
  WHERE s.shared_with_id = auth.uid()
    AND s.share_progress = true
    AND a.archived_at IS NULL
    AND ai.scheduled_for >= p_from
    AND ai.scheduled_for <= p_to
  ORDER BY ai.scheduled_for;
$$;
