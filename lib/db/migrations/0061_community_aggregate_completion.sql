-- ---------------------------------------------------------------------------
-- 0061 — Community aggregate completion (per-member "3/4 done").
--
-- Adds a second completion model alongside today's COLLECTIVE completion
-- (any permitted member marks the single shared occurrence for the whole
-- community). An AGGREGATE activity instead tracks EACH member's own status
-- per occurrence and shows the group's progress as a fraction — e.g. 3 of 4
-- members did it → "3/4". Denominator = the community's current member count
-- (per the product decision); numerator = members who marked 'completed'.
--
-- Phase 1 (this migration): the schema + RPCs.
--   * community_owned_activities.completion_type ('collective' | 'aggregate')
--   * community_owned_instance_members — per-(occurrence, member) status
--   * set_community_member_status — a member marks THEIR OWN status
--   * get_community_aggregate_status — per-instance {marked, total, mine}
--   * create/update_community_activity re-created with p_completion_type
--     (keeps p_auto_resolve from 0060).
--
-- The collective-marking permission (can_mark_completions) + the aggregate
-- calendar UI land in a follow-up phase. Collective marking is UNCHANGED
-- here (still open to members via set_community_instance_status).
--
-- Requires 0056 (owned calendar) + 0060 (auto_resolve).
-- ---------------------------------------------------------------------------

ALTER TABLE public.community_owned_activities
  ADD COLUMN IF NOT EXISTS completion_type text NOT NULL DEFAULT 'collective';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'community_owned_activities_completion_type_chk'
  ) THEN
    ALTER TABLE public.community_owned_activities
      ADD CONSTRAINT community_owned_activities_completion_type_chk
      CHECK (completion_type IN ('collective', 'aggregate'));
  END IF;
END $$;

-- Per-(occurrence, member) status for AGGREGATE activities. A row exists only
-- once a member has marked themselves; "unmark" deletes the row. Numerator of
-- the fraction = rows with status='completed'.
CREATE TABLE IF NOT EXISTS public.community_owned_instance_members (
  instance_id uuid NOT NULL
    REFERENCES public.community_owned_instances(id) ON DELETE CASCADE,
  community_id uuid NOT NULL
    REFERENCES public.communities(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'completed'
    CHECK (status IN ('completed', 'missed')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (instance_id, user_id)
);

CREATE INDEX IF NOT EXISTS community_owned_instance_members_lookup_idx
  ON public.community_owned_instance_members (community_id, instance_id);

ALTER TABLE public.community_owned_instance_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS community_owned_instance_members_select
  ON public.community_owned_instance_members;
CREATE POLICY community_owned_instance_members_select
  ON public.community_owned_instance_members
  FOR SELECT USING (public.is_community_member(community_id, auth.uid()));

-- set_community_member_status — a member records THEIR OWN status for an
-- aggregate occurrence. Open to any member (each marks only themselves).
-- p_status: 'completed' | 'missed' | 'none' ('none' clears the member's row).
CREATE OR REPLACE FUNCTION public.set_community_member_status(
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
  IF p_status NOT IN ('completed', 'missed', 'none') THEN
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

  IF p_status = 'none' THEN
    DELETE FROM public.community_owned_instance_members
    WHERE instance_id = p_instance_id AND user_id = v_uid;
  ELSE
    INSERT INTO public.community_owned_instance_members
      (instance_id, community_id, user_id, status, updated_at)
    VALUES (p_instance_id, v_community, v_uid, p_status, now())
    ON CONFLICT (instance_id, user_id)
    DO UPDATE SET status = EXCLUDED.status, updated_at = now();
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_community_member_status(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.set_community_member_status(uuid, text) TO authenticated;

-- get_community_aggregate_status — per-occurrence progress for the community's
-- AGGREGATE activities in [from, to]: how many members marked done, the total
-- member count (denominator), and the caller's own status ('completed' /
-- 'missed' / null). Members only.
CREATE OR REPLACE FUNCTION public.get_community_aggregate_status(
  p_community_id uuid,
  p_from date,
  p_to date
)
RETURNS TABLE (
  instance_id uuid,
  marked int,
  total int,
  my_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_total int;
BEGIN
  IF NOT public.is_community_member(p_community_id, v_uid) THEN
    RAISE EXCEPTION 'not permitted';
  END IF;

  SELECT COUNT(*)::int INTO v_total
  FROM public.community_members
  WHERE community_id = p_community_id;

  RETURN QUERY
  SELECT
    i.id,
    COALESCE((
      SELECT COUNT(*)::int FROM public.community_owned_instance_members m
      WHERE m.instance_id = i.id AND m.status = 'completed'
    ), 0),
    v_total,
    (
      SELECT m.status FROM public.community_owned_instance_members m
      WHERE m.instance_id = i.id AND m.user_id = v_uid
    )
  FROM public.community_owned_instances i
  JOIN public.community_owned_activities a ON a.id = i.activity_id
  WHERE i.community_id = p_community_id
    AND a.completion_type = 'aggregate'
    AND i.scheduled_for BETWEEN p_from AND p_to;
END;
$$;

REVOKE ALL ON FUNCTION public.get_community_aggregate_status(uuid, date, date) FROM public;
GRANT EXECUTE ON FUNCTION public.get_community_aggregate_status(uuid, date, date) TO authenticated;

-- ---- create_community_activity (re-create with p_completion_type) ----------
DROP FUNCTION IF EXISTS public.create_community_activity(
  uuid, text, text, jsonb, text[], text[], int, text[], date, date, boolean);

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
  p_end_date date,
  p_auto_resolve boolean,
  p_completion_type text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_name text := trim(p_name);
  v_ctype text := COALESCE(NULLIF(p_completion_type, ''), 'collective');
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
  IF v_ctype NOT IN ('collective', 'aggregate') THEN
    RAISE EXCEPTION 'invalid completion_type';
  END IF;

  INSERT INTO public.community_owned_activities (
    community_id, name, notes, rhythm, scheduled_times, scheduled_end_times,
    priority, default_skill_tags, start_date, end_date, auto_resolve,
    completion_type, created_by
  ) VALUES (
    p_community_id, v_name, NULLIF(trim(coalesce(p_notes, '')), ''), p_rhythm,
    COALESCE(p_scheduled_times, '{}'), COALESCE(p_scheduled_end_times, '{}'),
    COALESCE(p_priority, 2), COALESCE(p_tags, '{}'),
    p_start_date, p_end_date, COALESCE(p_auto_resolve, false),
    v_ctype, v_uid
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_community_activity(uuid, text, text, jsonb, text[], text[], int, text[], date, date, boolean, text) FROM public;
GRANT EXECUTE ON FUNCTION public.create_community_activity(uuid, text, text, jsonb, text[], text[], int, text[], date, date, boolean, text) TO authenticated;

-- ---- update_community_activity (re-create with p_completion_type) ----------
DROP FUNCTION IF EXISTS public.update_community_activity(
  uuid, text, text, jsonb, text[], text[], int, text[], date, date, boolean);

CREATE OR REPLACE FUNCTION public.update_community_activity(
  p_activity_id uuid,
  p_name text,
  p_notes text,
  p_rhythm jsonb,
  p_scheduled_times text[],
  p_scheduled_end_times text[],
  p_priority int,
  p_tags text[],
  p_start_date date,
  p_end_date date,
  p_auto_resolve boolean,
  p_completion_type text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_community uuid;
  v_name text := trim(p_name);
  v_ctype text := COALESCE(NULLIF(p_completion_type, ''), 'collective');
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
  IF v_name = '' OR length(v_name) > 120 THEN
    RAISE EXCEPTION 'name must be 1–120 characters';
  END IF;
  IF v_ctype NOT IN ('collective', 'aggregate') THEN
    RAISE EXCEPTION 'invalid completion_type';
  END IF;

  UPDATE public.community_owned_activities
  SET name = v_name,
      notes = NULLIF(trim(coalesce(p_notes, '')), ''),
      rhythm = p_rhythm,
      scheduled_times = COALESCE(p_scheduled_times, '{}'),
      scheduled_end_times = COALESCE(p_scheduled_end_times, '{}'),
      priority = COALESCE(p_priority, 2),
      default_skill_tags = COALESCE(p_tags, '{}'),
      start_date = p_start_date,
      end_date = p_end_date,
      auto_resolve = COALESCE(p_auto_resolve, false),
      completion_type = v_ctype
  WHERE id = p_activity_id;

  DELETE FROM public.community_owned_instances
  WHERE activity_id = p_activity_id
    AND scheduled_for >= CURRENT_DATE
    AND status = 'pending';
END;
$$;

REVOKE ALL ON FUNCTION public.update_community_activity(uuid, text, text, jsonb, text[], text[], int, text[], date, date, boolean, text) FROM public;
GRANT EXECUTE ON FUNCTION public.update_community_activity(uuid, text, text, jsonb, text[], text[], int, text[], date, date, boolean, text) TO authenticated;
