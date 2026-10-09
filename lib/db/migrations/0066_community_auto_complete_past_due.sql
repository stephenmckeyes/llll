-- ---------------------------------------------------------------------------
-- 0066 — Community auto-complete past-due occurrences.
--
-- Mirrors the personal autoCompletePastDue (migration 0065 era): a community-
-- owned activity flagged auto_resolve (e.g. a multi-day event, which defaults
-- to Auto-Complete) should have its past-due still-pending occurrences marked
-- completed automatically, so a Mon–Fri community event doesn't leave stale
-- pending occurrences nagging the whole community.
--
-- Collective semantics: the occurrence has one shared status, so auto-
-- completing it resolves it for everyone — which is exactly the intent of
-- Auto-Complete. Any member may trigger this (it's deterministic, not a
-- judgement call); the gate is just membership, matching
-- set_community_instance_status. Requires 0056 + 0060.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.auto_complete_community_past_due(
  p_community_id uuid,
  p_today date
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.is_community_member(p_community_id, auth.uid()) THEN
    RAISE EXCEPTION 'not permitted';
  END IF;

  UPDATE public.community_owned_instances i
  SET status = 'completed'
  FROM public.community_owned_activities a
  WHERE i.activity_id = a.id
    AND i.community_id = p_community_id
    AND a.auto_resolve = true
    AND a.archived_at IS NULL
    AND i.status = 'pending'
    AND i.scheduled_for < p_today;
END;
$$;

REVOKE ALL ON FUNCTION public.auto_complete_community_past_due(uuid, date) FROM public;
GRANT EXECUTE ON FUNCTION public.auto_complete_community_past_due(uuid, date) TO authenticated;
