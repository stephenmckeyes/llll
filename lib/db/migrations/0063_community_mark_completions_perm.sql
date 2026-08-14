-- ---------------------------------------------------------------------------
-- 0063 — Gate COLLECTIVE marking on a can_mark_completions rank permission.
--
-- Until now set_community_instance_status (collective completion — one shared
-- verdict for the whole community) was open to ANY member. Per product
-- decision, leadership should control who can mark: this re-gates it on
-- has_community_permission(..., 'can_mark_completions'). Leadership always
-- resolves true; ranks get it only if leadership ticks the box in the Ranks
-- editor (the permission is a plain key in community_ranks.permissions jsonb,
-- so no schema change is needed for the resolver — 0051's
-- has_community_permission already reads arbitrary keys).
--
-- NOTE: this narrows access — plain members can no longer mark collective
-- occurrences unless granted the permission (or they're leadership). Aggregate
-- activities are unaffected: each member always marks their OWN status via
-- set_community_member_status (0061).
--
-- Requires 0051 (has_community_permission) + 0056 (set_community_instance_status).
-- ---------------------------------------------------------------------------

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
  IF NOT public.has_community_permission(v_community, v_uid, 'can_mark_completions') THEN
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
