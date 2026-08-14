-- ---------------------------------------------------------------------------
-- 0060 — Auto-drop-when-past for community-owned activities.
--
-- Mirrors the personal calendar's `activities.auto_resolve` (migration 0059)
-- on the community side. When true, a past-due unmarked occurrence drops
-- silently (no verdict/nag) instead of lingering as overdue/unlabeled —
-- for meetings/appointments a community schedules but doesn't need to mark.
--
-- Adds the column, then re-creates create_community_activity (0056) and
-- update_community_activity (0057) with an appended p_auto_resolve param.
-- The old 10-arg signatures are dropped first so there's no overload
-- ambiguity (the client always calls with the param now).
--
-- Requires 0056 + 0057.
-- ---------------------------------------------------------------------------

ALTER TABLE public.community_owned_activities
  ADD COLUMN IF NOT EXISTS auto_resolve boolean NOT NULL DEFAULT false;

-- ---- create_community_activity (re-create with p_auto_resolve) -------------
DROP FUNCTION IF EXISTS public.create_community_activity(
  uuid, text, text, jsonb, text[], text[], int, text[], date, date);

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
  p_auto_resolve boolean
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
    priority, default_skill_tags, start_date, end_date, auto_resolve, created_by
  ) VALUES (
    p_community_id, v_name, NULLIF(trim(coalesce(p_notes, '')), ''), p_rhythm,
    COALESCE(p_scheduled_times, '{}'), COALESCE(p_scheduled_end_times, '{}'),
    COALESCE(p_priority, 2), COALESCE(p_tags, '{}'),
    p_start_date, p_end_date, COALESCE(p_auto_resolve, false), v_uid
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_community_activity(uuid, text, text, jsonb, text[], text[], int, text[], date, date, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.create_community_activity(uuid, text, text, jsonb, text[], text[], int, text[], date, date, boolean) TO authenticated;

-- ---- update_community_activity (re-create with p_auto_resolve) -------------
DROP FUNCTION IF EXISTS public.update_community_activity(
  uuid, text, text, jsonb, text[], text[], int, text[], date, date);

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
  p_auto_resolve boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_community uuid;
  v_name text := trim(p_name);
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
      auto_resolve = COALESCE(p_auto_resolve, false)
  WHERE id = p_activity_id;

  -- Drop future PENDING occurrences (they may no longer match the new
  -- schedule); keep completed/missed history. Caller re-materializes.
  DELETE FROM public.community_owned_instances
  WHERE activity_id = p_activity_id
    AND scheduled_for >= CURRENT_DATE
    AND status = 'pending';
END;
$$;

REVOKE ALL ON FUNCTION public.update_community_activity(uuid, text, text, jsonb, text[], text[], int, text[], date, date, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.update_community_activity(uuid, text, text, jsonb, text[], text[], int, text[], date, date, boolean) TO authenticated;
