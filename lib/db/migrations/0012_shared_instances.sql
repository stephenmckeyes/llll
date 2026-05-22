-- ===========================================================================
-- 0012_shared_instances.sql — let a friend SEE the progress on rhythms
-- shared with them (read-only).
--
-- Builds on 0011 (activity_shares + get_shared_with_me). That function
-- returns the shared activity DEFINITIONS so a friend can view + copy them.
-- This adds the dated OCCURRENCES + their completion state, so the friend
-- view can render a real read-only Calendar / Grid with the owner's actual
-- progress — but ONLY when the owner opted to share progress.
--
-- Gating (privacy-first):
--   - shared_with_id = caller            → you only ever see what's shared
--                                          WITH you, never anything else.
--   - share_progress = true              → template-only shares expose NO
--                                          occurrences (they show up in the
--                                          friend's Total view as a template
--                                          and never on the calendar/grid).
--   - activities.archived_at IS NULL     → an archived/"save for later"
--                                          share is a template too: Total
--                                          only, no occurrences.
--
-- SECURITY DEFINER so it can read the owner's instances, but the WHERE
-- clause restricts every row to the caller's shares. Read-only — there is
-- no write path here; friends can never mutate an owner's data.
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
  completion_count integer
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
    COALESCE(cc.cnt, 0)::integer AS completion_count
  FROM public.activity_shares s
  JOIN public.activities a          ON a.id = s.activity_id
  JOIN public.activity_instances ai ON ai.activity_id = a.id
  LEFT JOIN (
    SELECT ci.instance_id, COUNT(*) AS cnt
    FROM public.completion_instances ci
    JOIN public.completions c
      ON c.id = ci.completion_id AND c.deleted_at IS NULL
    GROUP BY ci.instance_id
  ) cc ON cc.instance_id = ai.id
  WHERE s.shared_with_id = auth.uid()
    AND s.share_progress = true
    AND a.archived_at IS NULL
    AND ai.scheduled_for >= p_from
    AND ai.scheduled_for <= p_to
  ORDER BY ai.scheduled_for;
$$;
