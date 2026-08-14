-- ---------------------------------------------------------------------------
-- 0056 — Community-owned calendars (Phase 1).
--
-- A community becomes a first-class calendar owner: it has its OWN activities
-- and occurrences, distinct from any member's personal calendar. Completion
-- is COLLECTIVE — any member marks an occurrence done for the whole community
-- (one shared status/history per occurrence). Managing activities is gated by
-- the ranks system's can_add_activities; completing is open to any member.
--
-- Deliberately a SEPARATE schema from the personal activities/activity_
-- instances tables so none of the core personal-calendar RLS or queries are
-- touched. Occurrences are materialized in TS (reusing generateInstances) and
-- bulk-inserted via insert_community_instances.
--
-- Requires 0031/0040 (is_community_member), 0051 (has_community_permission).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.community_owned_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  name text NOT NULL,
  notes text,
  rhythm jsonb NOT NULL,
  scheduled_times text[] NOT NULL DEFAULT '{}',
  scheduled_end_times text[] NOT NULL DEFAULT '{}',
  priority int NOT NULL DEFAULT 2,
  default_skill_tags text[] NOT NULL DEFAULT '{}',
  start_date date NOT NULL,
  end_date date,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE INDEX IF NOT EXISTS community_owned_activities_community_idx
  ON public.community_owned_activities (community_id, archived_at);

CREATE TABLE IF NOT EXISTS public.community_owned_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  activity_id uuid NOT NULL REFERENCES public.community_owned_activities(id) ON DELETE CASCADE,
  scheduled_for date NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'missed')),
  tags text[] NOT NULL DEFAULT '{}',
  comment text,
  completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  UNIQUE (activity_id, scheduled_for)
);

CREATE INDEX IF NOT EXISTS community_owned_instances_lookup_idx
  ON public.community_owned_instances (community_id, scheduled_for);

ALTER TABLE public.community_owned_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_owned_instances ENABLE ROW LEVEL SECURITY;

-- Members read; writes go through the SECURITY DEFINER RPCs below.
DROP POLICY IF EXISTS community_owned_activities_select ON public.community_owned_activities;
CREATE POLICY community_owned_activities_select ON public.community_owned_activities
  FOR SELECT USING (public.is_community_member(community_id, auth.uid()));

DROP POLICY IF EXISTS community_owned_instances_select ON public.community_owned_instances;
CREATE POLICY community_owned_instances_select ON public.community_owned_instances
  FOR SELECT USING (public.is_community_member(community_id, auth.uid()));

-- create_community_activity — define a new community-owned activity.
CREATE OR REPLACE FUNCTION public.create_community_activity(
  p_community_id uuid,
  p_name text,
  p_notes text,
  p_rhythm jsonb,
  p_scheduled_times text[],
  p_scheduled_end_times text[],
  p_priority int,
  p_tags text[],
  p_start_date date,
  p_end_date date
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_name text := trim(p_name);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.has_community_permission(p_community_id, v_uid, 'can_add_activities') THEN
    RAISE EXCEPTION 'not permitted';
  END IF;
  IF v_name = '' OR length(v_name) > 120 THEN
    RAISE EXCEPTION 'name must be 1–120 characters';
  END IF;

  INSERT INTO public.community_owned_activities (
    community_id, name, notes, rhythm, scheduled_times, scheduled_end_times,
    priority, default_skill_tags, start_date, end_date, created_by
  ) VALUES (
    p_community_id, v_name, NULLIF(trim(coalesce(p_notes, '')), ''), p_rhythm,
    COALESCE(p_scheduled_times, '{}'), COALESCE(p_scheduled_end_times, '{}'),
    COALESCE(p_priority, 2), COALESCE(p_tags, '{}'),
    p_start_date, p_end_date, v_uid
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_community_activity(uuid, text, text, jsonb, text[], text[], int, text[], date, date) FROM public;
GRANT EXECUTE ON FUNCTION public.create_community_activity(uuid, text, text, jsonb, text[], text[], int, text[], date, date) TO authenticated;

-- insert_community_instances — bulk-materialize occurrences (computed in TS
-- via generateInstances). Idempotent; snapshots the activity's current tags.
CREATE OR REPLACE FUNCTION public.insert_community_instances(
  p_activity_id uuid,
  p_dates date[]
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_community uuid;
  v_tags text[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT community_id, default_skill_tags INTO v_community, v_tags
  FROM public.community_owned_activities WHERE id = p_activity_id;
  IF v_community IS NULL THEN
    RAISE EXCEPTION 'activity not found';
  END IF;
  IF NOT public.has_community_permission(v_community, v_uid, 'can_add_activities') THEN
    RAISE EXCEPTION 'not permitted';
  END IF;

  INSERT INTO public.community_owned_instances (community_id, activity_id, scheduled_for, tags)
  SELECT v_community, p_activity_id, d, COALESCE(v_tags, '{}')
  FROM unnest(p_dates) AS d
  ON CONFLICT (activity_id, scheduled_for) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.insert_community_instances(uuid, date[]) FROM public;
GRANT EXECUTE ON FUNCTION public.insert_community_instances(uuid, date[]) TO authenticated;

-- set_community_instance_status — collective completion. Any member may mark
-- an occurrence pending / completed / missed for the whole community.
CREATE OR REPLACE FUNCTION public.set_community_instance_status(
  p_instance_id uuid,
  p_status text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_community uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_status NOT IN ('pending', 'completed', 'missed') THEN
    RAISE EXCEPTION 'invalid status: %', p_status;
  END IF;

  SELECT community_id INTO v_community
  FROM public.community_owned_instances WHERE id = p_instance_id;
  IF v_community IS NULL THEN
    RAISE EXCEPTION 'occurrence not found';
  END IF;
  IF NOT public.is_community_member(v_community, v_uid) THEN
    RAISE EXCEPTION 'not permitted';
  END IF;

  UPDATE public.community_owned_instances
  SET status = p_status,
      completed_by = CASE WHEN p_status = 'completed' THEN v_uid ELSE NULL END,
      completed_at = CASE WHEN p_status = 'completed' THEN now() ELSE NULL END
  WHERE id = p_instance_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_community_instance_status(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.set_community_instance_status(uuid, text) TO authenticated;

-- archive_community_activity — soft-delete a community-owned activity.
CREATE OR REPLACE FUNCTION public.archive_community_activity(
  p_activity_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_community uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  SELECT community_id INTO v_community
  FROM public.community_owned_activities WHERE id = p_activity_id;
  IF v_community IS NULL THEN
    RAISE EXCEPTION 'activity not found';
  END IF;
  IF NOT public.has_community_permission(v_community, v_uid, 'can_add_activities') THEN
    RAISE EXCEPTION 'not permitted';
  END IF;

  UPDATE public.community_owned_activities
  SET archived_at = now()
  WHERE id = p_activity_id;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_community_activity(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.archive_community_activity(uuid) TO authenticated;
