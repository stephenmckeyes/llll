-- ---------------------------------------------------------------------------
-- 0058 — Restore + permanently delete a community-owned activity (Phase 3b).
--
-- Complements archive (0056): archived community activities can now be
-- restored (un-archived; caller re-materializes future occurrences) or
-- permanently deleted (row + its occurrences via ON DELETE CASCADE).
-- Both gated by can_add_activities. Permanent delete mirrors the personal
-- app's "delete only from Archived" rule — the UI only offers it on the
-- archived list.
--
-- Requires 0056 (community_owned_activities), 0051 (has_community_permission).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.restore_community_activity(
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
  SET archived_at = NULL
  WHERE id = p_activity_id;
END;
$$;

REVOKE ALL ON FUNCTION public.restore_community_activity(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.restore_community_activity(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_community_activity(
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

  -- Occurrences cascade via the FK ON DELETE CASCADE.
  DELETE FROM public.community_owned_activities WHERE id = p_activity_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_community_activity(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.delete_community_activity(uuid) TO authenticated;
