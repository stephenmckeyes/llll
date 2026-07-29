-- ===========================================================================
-- 0020_instance_comment.sql — a free-text reflection per activity_instance.
--
-- Distinct from `activities.notes` (the rhythm's default notes) and from
-- the `activity_instances.notes` per-occurrence override used by "Edit
-- occurrence" — this is a POST-HOC comment the user writes after doing
-- (or missing) the occurrence: "went for a run this morning, felt great,
-- 5km", "skipped, kid sick", etc. Shared with any friend who has
-- share_progress=true on the parent activity.
--
-- The RPC is extended so the friend view can display the comment
-- read-only. Adding a column to a set-returning function requires a full
-- CREATE OR REPLACE with the extended signature; kept idempotent so the
-- migration is safe to re-run.
-- ===========================================================================

ALTER TABLE public.activity_instances
  ADD COLUMN IF NOT EXISTS comment text;

-- Postgres refuses to CREATE OR REPLACE a function when the return-column
-- list changes (error 42P13: "cannot change return type of existing
-- function"). Since we're widening RETURNS TABLE with a new `comment`
-- column, drop every overload of the name first, regardless of parameter
-- signature. Iterating via pg_proc keeps the migration bulletproof if a
-- previous run left the function with an unexpected signature.
DO $migration_0020$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT format(
      'DROP FUNCTION IF EXISTS public.%I(%s) CASCADE',
      p.proname,
      pg_get_function_identity_arguments(p.oid)
    ) AS cmd
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_shared_instances_with_me'
  LOOP
    EXECUTE r.cmd;
  END LOOP;
END $migration_0020$;

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
  completion_dates date[],
  comment          text
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
    COALESCE(cc.dates, ARRAY[]::date[]) AS completion_dates,
    ai.comment                          AS comment
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
