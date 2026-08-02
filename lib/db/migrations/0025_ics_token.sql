-- ===========================================================================
-- 0025_ics_token.sql — read-only calendar-export feed.
--
-- Two pieces:
--   1. profiles.ics_token         — opaque per-user secret. NULL until
--                                   the user enables sync in Settings.
--      Rotating it invalidates every subscribed calendar app instantly.
--   2. RPC get_instances_by_ics_token(token, from, to)
--                                 — SECURITY DEFINER function that
--                                   authenticates the caller purely by
--                                   token, bypassing RLS. Returns each
--                                   instance in the requested window
--                                   flattened with the parent activity
--                                   name/notes/time so the API route
--                                   doesn't need a service-role key.
--
-- Why an RPC (not a service-role client): calendar apps hit this route
-- without a session, so RLS would normally block them. Rather than
-- introducing SUPABASE_SERVICE_ROLE_KEY as a required env var (and the
-- footgun that comes with it), the RPC narrowly exposes JUST the
-- calendar shape and only when the caller presents the correct token.
--
-- Safe to re-run.
-- ===========================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ics_token text;

-- Uniqueness so the RPC's `WHERE ics_token = $1` returns 0 or 1 row
-- without any extra logic. Nullable is fine — the unique constraint
-- ignores NULLs by default in Postgres.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_ics_token_unique
  ON public.profiles (ics_token);

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
    AND length(p_token) >= 20    -- guardrail against truncated tokens
    AND a.archived_at IS NULL
    AND ai.scheduled_for >= p_from
    AND ai.scheduled_for <= p_to
  ORDER BY ai.scheduled_for;
$$;

-- Anyone (anon / authenticated) can call it — the token is the auth.
GRANT EXECUTE ON FUNCTION public.get_instances_by_ics_token(text, date, date)
  TO anon, authenticated;
