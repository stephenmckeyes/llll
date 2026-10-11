-- ---------------------------------------------------------------------------
-- 0069 — Fix the ICS calendar feed (re-create get_instances_by_ics_token).
--
-- The calendar-sync UI + profiles.ics_token (migration 0025) are live, but the
-- feed route (/api/calendar/<token>.ics) returns 404 because the RPC it calls,
-- get_instances_by_ics_token, is missing from / not visible in the database
-- (the function from 0025 didn't land, or PostgREST's schema cache is stale).
--
-- This re-creates the function (identical shape to 0025, CREATE OR REPLACE so
-- it's safe to re-run) and asks PostgREST to reload its schema cache so the
-- RPC is immediately callable.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_instances_by_ics_token(
  p_token text,
  p_from  date,
  p_to    date
)
RETURNS TABLE (
  instance_id      uuid,
  scheduled_for    date,
  status           text,
  override_name    text,
  override_notes   text,
  activity_id      uuid,
  activity_name    text,
  activity_notes   text,
  scheduled_times  text[],
  created_at       timestamptz,
  owner_timezone   text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ai.id                     AS instance_id,
    ai.scheduled_for          AS scheduled_for,
    ai.status::text           AS status,
    ai.name                   AS override_name,
    ai.notes                  AS override_notes,
    a.id                      AS activity_id,
    a.name                    AS activity_name,
    a.notes                   AS activity_notes,
    a.scheduled_times         AS scheduled_times,
    ai.created_at             AS created_at,
    p.timezone                AS owner_timezone
  FROM public.profiles p
  JOIN public.activities a ON a.user_id = p.id
  JOIN public.activity_instances ai ON ai.activity_id = a.id
  WHERE p.ics_token = p_token
    AND p_token IS NOT NULL
    AND length(p_token) >= 20
    AND a.archived_at IS NULL
    AND ai.scheduled_for >= p_from
    AND ai.scheduled_for <= p_to
  ORDER BY ai.scheduled_for;
$$;

GRANT EXECUTE ON FUNCTION public.get_instances_by_ics_token(text, date, date)
  TO anon, authenticated;

-- Make the RPC callable immediately (PostgREST caches the schema).
NOTIFY pgrst, 'reload schema';
