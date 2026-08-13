-- ---------------------------------------------------------------------------
-- 0040 — Community activities: calendar + auto-add foundation (Phase 3).
--
-- Builds on 0031 (communities + RLS + is_community_member). Adds:
--   * communities.calendar_display — leadership setting for how much of the
--     community calendar members see ('full' = the whole personal-style
--     calendar; 'light' = a trimmed view). Default 'light'.
--   * is_community_leadership() — SECURITY DEFINER helper (leader/co_leader),
--     reused by every leadership-gated RPC here (and future Settings RPCs).
--   * get_community_activities() / get_community_instances() — SECURITY
--     DEFINER reads that return the SAME shapes as the friend-share RPCs
--     (get_shared_with_me / get_shared_instances_with_me), so the community
--     calendar can reuse the friend-calendar components verbatim. Gated to
--     members, plus non-members of PUBLIC communities (mirrors the
--     community_activities SELECT policy).
--   * add_community_activity() / remove_community_activity() — leadership
--     link/unlink one of their OWN activities into the community.
--   * set_community_calendar_display() — leadership set the display mode.
--
-- Auto-add FAN-OUT (copying a newly-added activity to members who opted in)
-- is intentionally NOT here yet — the pref row (community_auto_add_prefs)
-- already exists from 0031 and is user-writable via RLS; the fan-out lands
-- in a later increment.
-- ---------------------------------------------------------------------------

-- Leadership display setting -------------------------------------------------
ALTER TABLE public.communities
  ADD COLUMN IF NOT EXISTS calendar_display text NOT NULL DEFAULT 'light';

-- Leadership helper ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_community_leadership(
  p_community_id uuid,
  p_user_id uuid
) RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.community_members
    WHERE community_id = p_community_id
      AND user_id = p_user_id
      AND role IN ('leader', 'co_leader')
  );
$$;

REVOKE ALL ON FUNCTION public.is_community_leadership(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.is_community_leadership(uuid, uuid) TO authenticated;

-- Reads ----------------------------------------------------------------------

-- get_community_activities — every activity shared into the community, in the
-- same column shape as get_shared_with_me (minus the friend-only share_id /
-- share_progress). Visible to members + anyone for a public community.
CREATE OR REPLACE FUNCTION public.get_community_activities(
  p_community_id uuid
) RETURNS TABLE (
  activity_id         uuid,
  owner_id            uuid,
  owner_username      text,
  owner_display_name  text,
  name                text,
  notes               text,
  rhythm              jsonb,
  priority            smallint,
  scheduled_times     text[],
  scheduled_end_times text[],
  default_skill_tags  text[],
  start_date          date,
  end_date            date,
  archived_at         timestamptz,
  added_at            timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    a.id, a.user_id, p.username, p.display_name,
    a.name, a.notes, a.rhythm, a.priority,
    a.scheduled_times, a.scheduled_end_times,
    a.default_skill_tags, a.start_date, a.end_date, a.archived_at,
    ca.added_at
  FROM public.community_activities ca
  JOIN public.activities a ON a.id = ca.activity_id
  JOIN public.profiles p   ON p.id = a.user_id
  WHERE ca.community_id = p_community_id
    AND a.archived_at IS NULL
    AND (
      public.is_community_member(p_community_id, auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.communities c
        WHERE c.id = p_community_id AND c.visibility = 'public'
      )
    )
  ORDER BY ca.added_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_community_activities(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_community_activities(uuid) TO authenticated;

-- get_community_instances — occurrences (+ completion state) of the
-- community's shared activities within [from, to]. Mirrors
-- get_shared_instances_with_me. completion_dates use each OWNER's timezone.
CREATE OR REPLACE FUNCTION public.get_community_instances(
  p_community_id uuid,
  p_from date,
  p_to   date
) RETURNS TABLE (
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
    a.user_id,
    a.id            AS activity_id,
    ai.id           AS instance_id,
    ai.scheduled_for,
    ai.status::text AS status,
    COALESCE(cc.cnt, 0)::integer        AS completion_count,
    COALESCE(cc.dates, ARRAY[]::date[]) AS completion_dates,
    ai.comment                          AS comment
  FROM public.community_activities ca
  JOIN public.activities a          ON a.id = ca.activity_id
  JOIN public.activity_instances ai ON ai.activity_id = a.id
  JOIN public.profiles op           ON op.id = a.user_id
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
  WHERE ca.community_id = p_community_id
    AND a.archived_at IS NULL
    AND ai.scheduled_for >= p_from
    AND ai.scheduled_for <= p_to
    AND (
      public.is_community_member(p_community_id, auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.communities c
        WHERE c.id = p_community_id AND c.visibility = 'public'
      )
    )
  ORDER BY ai.scheduled_for;
$$;

REVOKE ALL ON FUNCTION public.get_community_instances(uuid, date, date) FROM public;
GRANT EXECUTE ON FUNCTION public.get_community_instances(uuid, date, date) TO authenticated;

-- Writes (leadership-gated) --------------------------------------------------

-- add_community_activity — link one of the caller's OWN activities into the
-- community. Leadership only. Idempotent.
CREATE OR REPLACE FUNCTION public.add_community_activity(
  p_community_id uuid,
  p_activity_id  uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_owner uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.is_community_leadership(p_community_id, v_uid) THEN
    RAISE EXCEPTION 'not permitted';
  END IF;

  SELECT user_id INTO v_owner FROM public.activities WHERE id = p_activity_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'activity not found';
  END IF;
  IF v_owner <> v_uid THEN
    RAISE EXCEPTION 'you can only add your own activities';
  END IF;

  INSERT INTO public.community_activities (community_id, activity_id, added_by)
  VALUES (p_community_id, p_activity_id, v_uid)
  ON CONFLICT DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.add_community_activity(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.add_community_activity(uuid, uuid) TO authenticated;

-- remove_community_activity — unlink an activity from the community.
-- Leadership only. Does not touch the underlying activity.
CREATE OR REPLACE FUNCTION public.remove_community_activity(
  p_community_id uuid,
  p_activity_id  uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.is_community_leadership(p_community_id, v_uid) THEN
    RAISE EXCEPTION 'not permitted';
  END IF;

  DELETE FROM public.community_activities
  WHERE community_id = p_community_id AND activity_id = p_activity_id;
END;
$$;

REVOKE ALL ON FUNCTION public.remove_community_activity(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.remove_community_activity(uuid, uuid) TO authenticated;

-- set_community_calendar_display — leadership pick how much of the calendar
-- members see. 'full' | 'light'.
CREATE OR REPLACE FUNCTION public.set_community_calendar_display(
  p_community_id uuid,
  p_mode text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.is_community_leadership(p_community_id, v_uid) THEN
    RAISE EXCEPTION 'not permitted';
  END IF;
  IF p_mode NOT IN ('full', 'light') THEN
    RAISE EXCEPTION 'invalid display mode: %', p_mode;
  END IF;

  UPDATE public.communities
  SET calendar_display = p_mode, updated_at = now()
  WHERE id = p_community_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_community_calendar_display(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.set_community_calendar_display(uuid, text) TO authenticated;
