-- ---------------------------------------------------------------------------
-- 0047 — Auto-add fan-out (finishes Phase 3).
--
-- When leadership adds an activity to a community, copy it into the schedule
-- of every member who opted into auto-add (community_auto_add_prefs.auto_add
-- = true), except the person adding it (they already own the original).
--
-- The copy is a fresh, fully-owned activity for each member (template fields
-- + behavior flags only; new id, no reminders, not pinned/archived, private,
-- starting today). Its instances aren't generated here — they backfill on
-- the member's next dashboard load (ensureInstancesBackfilled picks up every
-- non-archived activity); the copy shows in their Total view immediately.
--
-- Re-creates add_community_activity (from 0043) — only the fan-out INSERT in
-- the IF FOUND block is new. Function-only migration; apply manually.
-- ---------------------------------------------------------------------------

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

  -- Only on a genuinely new add (not a re-add / conflict).
  IF FOUND THEN
    PERFORM public._post_community_system(
      p_community_id,
      'Added activity: ' ||
        COALESCE((SELECT name FROM public.activities WHERE id = p_activity_id), 'an activity'),
      jsonb_build_object('type', 'activity_added', 'activity_id', p_activity_id)
    );

    -- Fan-out: copy the activity into each auto-add member's schedule.
    -- Omitted columns take their defaults (id, reminders, visibility=private,
    -- pinned=false, streak_*, created_at, archived_at=null). Copy starts today.
    INSERT INTO public.activities (
      user_id, name, notes, rhythm, start_date, end_date,
      scheduled_times, scheduled_end_times, priority, default_skill_tags,
      track_on_grid, rollover_missed_days, rollover_change_rhythm, auto_archive
    )
    SELECT
      p.user_id, a.name, a.notes, a.rhythm, CURRENT_DATE, a.end_date,
      a.scheduled_times, a.scheduled_end_times, a.priority, a.default_skill_tags,
      a.track_on_grid, a.rollover_missed_days, a.rollover_change_rhythm, a.auto_archive
    FROM public.community_auto_add_prefs p
    JOIN public.activities a ON a.id = p_activity_id
    WHERE p.community_id = p_community_id
      AND p.auto_add = true
      AND p.user_id <> v_uid;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.add_community_activity(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.add_community_activity(uuid, uuid) TO authenticated;
