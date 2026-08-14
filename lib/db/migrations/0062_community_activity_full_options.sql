-- ---------------------------------------------------------------------------
-- 0062 — Community-owned activities: full option parity with personal.
--
-- The community add/edit form now reuses the SAME shared ActivityFormFields
-- as the personal calendar and shows all its options. This adds the backing
-- columns so those options actually persist (rather than being dead toggles):
--   reminders, track_on_grid, pinned, rollover_missed_days,
--   rollover_change_rhythm — mirroring the personal `activities` row.
--
-- Behavior wiring for some of these is personal-only today (rollover runs in
-- the personal miss path; reminders have no delivery pipeline anywhere;
-- pinned surfaces in the personal Total view). They are stored on the
-- community row for round-trip parity now; community-side behavior can be
-- layered on later (e.g. track_on_grid gating the community Grid).
--
-- Re-creates create/update_community_activity (last touched in 0061) with the
-- five new params appended. Requires 0056 + 0060 + 0061.
-- ---------------------------------------------------------------------------

ALTER TABLE public.community_owned_activities
  ADD COLUMN IF NOT EXISTS reminders jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS track_on_grid boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rollover_missed_days boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rollover_change_rhythm boolean NOT NULL DEFAULT false;

-- ---- create_community_activity (re-create with the option columns) ---------
DROP FUNCTION IF EXISTS public.create_community_activity(
  uuid, text, text, jsonb, text[], text[], int, text[], date, date, boolean, text);

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
  p_completion_type text,
  p_reminders jsonb,
  p_track_on_grid boolean,
  p_pinned boolean,
  p_rollover_missed_days boolean,
  p_rollover_change_rhythm boolean
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
    completion_type, reminders, track_on_grid, pinned,
    rollover_missed_days, rollover_change_rhythm, created_by
  ) VALUES (
    p_community_id, v_name, NULLIF(trim(coalesce(p_notes, '')), ''), p_rhythm,
    COALESCE(p_scheduled_times, '{}'), COALESCE(p_scheduled_end_times, '{}'),
    COALESCE(p_priority, 2), COALESCE(p_tags, '{}'),
    p_start_date, p_end_date, COALESCE(p_auto_resolve, false),
    v_ctype, COALESCE(p_reminders, '[]'::jsonb),
    COALESCE(p_track_on_grid, false), COALESCE(p_pinned, false),
    COALESCE(p_rollover_missed_days, false),
    COALESCE(p_rollover_change_rhythm, false), v_uid
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_community_activity(uuid, text, text, jsonb, text[], text[], int, text[], date, date, boolean, text, jsonb, boolean, boolean, boolean, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.create_community_activity(uuid, text, text, jsonb, text[], text[], int, text[], date, date, boolean, text, jsonb, boolean, boolean, boolean, boolean) TO authenticated;

-- ---- update_community_activity (re-create with the option columns) ---------
DROP FUNCTION IF EXISTS public.update_community_activity(
  uuid, text, text, jsonb, text[], text[], int, text[], date, date, boolean, text);

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
  p_completion_type text,
  p_reminders jsonb,
  p_track_on_grid boolean,
  p_pinned boolean,
  p_rollover_missed_days boolean,
  p_rollover_change_rhythm boolean
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
      completion_type = v_ctype,
      reminders = COALESCE(p_reminders, '[]'::jsonb),
      track_on_grid = COALESCE(p_track_on_grid, false),
      pinned = COALESCE(p_pinned, false),
      rollover_missed_days = COALESCE(p_rollover_missed_days, false),
      rollover_change_rhythm = COALESCE(p_rollover_change_rhythm, false)
  WHERE id = p_activity_id;

  DELETE FROM public.community_owned_instances
  WHERE activity_id = p_activity_id
    AND scheduled_for >= CURRENT_DATE
    AND status = 'pending';
END;
$$;

REVOKE ALL ON FUNCTION public.update_community_activity(uuid, text, text, jsonb, text[], text[], int, text[], date, date, boolean, text, jsonb, boolean, boolean, boolean, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.update_community_activity(uuid, text, text, jsonb, text[], text[], int, text[], date, date, boolean, text, jsonb, boolean, boolean, boolean, boolean) TO authenticated;
