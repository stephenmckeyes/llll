-- ---------------------------------------------------------------------------
-- 0057 — Edit a community-owned activity (Phase 2).
--
-- update_community_activity updates the activity's fields and, because a
-- rhythm/date change invalidates already-materialized future occurrences,
-- clears FUTURE PENDING occurrences (scheduled_for >= today, status =
-- 'pending'). Completed/missed history is preserved. The caller then
-- re-materializes from today via insert_community_instances (0056), reusing
-- the TS generateInstances so we don't reimplement rhythm expansion in SQL.
--
-- Gated by can_add_activities. Requires 0056.
-- ---------------------------------------------------------------------------

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
  p_end_date date
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
      end_date = p_end_date
  WHERE id = p_activity_id;

  -- Drop future PENDING occurrences (they may no longer match the new
  -- schedule); keep completed/missed history. Caller re-materializes.
  DELETE FROM public.community_owned_instances
  WHERE activity_id = p_activity_id
    AND scheduled_for >= CURRENT_DATE
    AND status = 'pending';
END;
$$;

REVOKE ALL ON FUNCTION public.update_community_activity(uuid, text, text, jsonb, text[], text[], int, text[], date, date) FROM public;
GRANT EXECUTE ON FUNCTION public.update_community_activity(uuid, text, text, jsonb, text[], text[], int, text[], date, date) TO authenticated;
