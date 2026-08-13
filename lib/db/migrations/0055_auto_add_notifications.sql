-- ---------------------------------------------------------------------------
-- 0055 — Optional notifications for auto-added activities.
--
-- Auto-add is silent by design (an activity leadership adds just appears in
-- opted-in members' schedules). This adds an OPT-IN so a member can also be
-- told when that happens, surfaced on /notifications + the nav badge and
-- dismissible.
--
--   * community_auto_add_prefs.notify — per (community, member) opt-in.
--   * community_auto_add_events — the dismissible per-user feed.
--   * add_community_activity — now also records an event for each member who
--     has auto_add = true AND notify = true (re-created from 0051; fan-out
--     INSERT unchanged, one new INSERT for events).
--   * get_my_auto_add_events() / dismiss_auto_add_event(id).
--
-- Requires 0031 (prefs table), 0047/0051 (add_community_activity fan-out +
-- has_community_permission gate).
-- ---------------------------------------------------------------------------

ALTER TABLE public.community_auto_add_prefs
  ADD COLUMN IF NOT EXISTS notify boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.community_auto_add_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  dismissed boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS community_auto_add_events_user_idx
  ON public.community_auto_add_events (user_id, dismissed);

ALTER TABLE public.community_auto_add_events ENABLE ROW LEVEL SECURITY;

-- The recipient reads their own events; writes go through the definer RPCs.
DROP POLICY IF EXISTS community_auto_add_events_select
  ON public.community_auto_add_events;
CREATE POLICY community_auto_add_events_select
  ON public.community_auto_add_events
  FOR SELECT
  USING (user_id = auth.uid());

-- add_community_activity — re-created from 0051; adds the events INSERT.
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
  IF NOT public.has_community_permission(p_community_id, v_uid, 'can_add_activities') THEN
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

  IF FOUND THEN
    PERFORM public._post_community_system(
      p_community_id,
      'Added activity: ' ||
        COALESCE((SELECT name FROM public.activities WHERE id = p_activity_id), 'an activity'),
      jsonb_build_object('type', 'activity_added', 'activity_id', p_activity_id)
    );

    -- Fan-out: copy the activity into each auto-add member's schedule.
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

    -- Notify the auto-add members who opted into notifications.
    INSERT INTO public.community_auto_add_events (community_id, user_id, activity_name)
    SELECT
      p.community_id, p.user_id,
      COALESCE((SELECT name FROM public.activities WHERE id = p_activity_id), 'an activity')
    FROM public.community_auto_add_prefs p
    WHERE p.community_id = p_community_id
      AND p.auto_add = true
      AND COALESCE(p.notify, false) = true
      AND p.user_id <> v_uid;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.add_community_activity(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.add_community_activity(uuid, uuid) TO authenticated;

-- get_my_auto_add_events — the caller's undismissed auto-add notices.
CREATE OR REPLACE FUNCTION public.get_my_auto_add_events()
RETURNS TABLE (
  id             uuid,
  community_id   uuid,
  community_name text,
  community_kind text,
  activity_name  text,
  created_at     timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.id, e.community_id, c.name, c.kind, e.activity_name, e.created_at
  FROM public.community_auto_add_events e
  JOIN public.communities c ON c.id = e.community_id
  WHERE e.user_id = auth.uid()
    AND e.dismissed = false
  ORDER BY e.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_my_auto_add_events() FROM public;
GRANT EXECUTE ON FUNCTION public.get_my_auto_add_events() TO authenticated;

CREATE OR REPLACE FUNCTION public.dismiss_auto_add_event(
  p_event_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.community_auto_add_events
  SET dismissed = true
  WHERE id = p_event_id AND user_id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.dismiss_auto_add_event(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.dismiss_auto_add_event(uuid) TO authenticated;
