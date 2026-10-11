-- ---------------------------------------------------------------------------
-- 0070 — Link a community AGGREGATE activity to a member's personal calendar.
--
-- A member can add a community aggregate activity to their own calendar as a
-- normal personal activity that carries a back-reference to the community one.
-- When the member completes/misses/reverts a personal occurrence of a linked
-- activity, that status is mirrored onto their per-member row for the matching
-- community occurrence (same date) — so one action counts in both places and
-- the group's N/M fraction updates.
--
--   * activities.linked_community_activity_id — FK to the community aggregate
--     activity (NULL for ordinary personal activities).
--   * propagate_linked_aggregate() + trigger on activity_instances status
--     changes — mirrors the owner's status onto community_owned_instance_members
--     (SECURITY DEFINER, since that table's writes are RPC-only). One-way
--     (personal → community); marking in the community does not write back.
--
-- Requires 0056 (community_owned_*) + 0061 (aggregate completion).
-- ---------------------------------------------------------------------------

ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS linked_community_activity_id uuid
    REFERENCES public.community_owned_activities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS activities_linked_community_idx
  ON public.activities (linked_community_activity_id)
  WHERE linked_community_activity_id IS NOT NULL;

-- Mirror a personal occurrence's status onto the member's community aggregate
-- row for the same-dated community occurrence. Runs for every status change on
-- activity_instances but exits immediately when the parent activity isn't
-- linked (one indexed lookup).
CREATE OR REPLACE FUNCTION public.propagate_linked_aggregate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_linked uuid;
  v_owner uuid;
  v_community uuid;
  v_coi uuid;
BEGIN
  SELECT a.linked_community_activity_id, a.user_id
    INTO v_linked, v_owner
  FROM public.activities a
  WHERE a.id = NEW.activity_id;

  IF v_linked IS NULL THEN
    RETURN NEW; -- ordinary personal activity: nothing to mirror
  END IF;

  -- The matching community occurrence (same activity link + same day).
  SELECT i.id, i.community_id
    INTO v_coi, v_community
  FROM public.community_owned_instances i
  WHERE i.activity_id = v_linked
    AND i.scheduled_for = NEW.scheduled_for
  LIMIT 1;

  IF v_coi IS NULL THEN
    RETURN NEW; -- no community occurrence that day
  END IF;

  -- Only mirror if the owner is still a member of that community.
  IF NOT public.is_community_member(v_community, v_owner) THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'completed' OR NEW.status = 'missed' THEN
    INSERT INTO public.community_owned_instance_members
      (instance_id, community_id, user_id, status, updated_at)
    VALUES (v_coi, v_community, v_owner, NEW.status, now())
    ON CONFLICT (instance_id, user_id)
    DO UPDATE SET status = EXCLUDED.status, updated_at = now();
  ELSE
    -- reverted to pending (or anything else) → clear the member's mark
    DELETE FROM public.community_owned_instance_members
    WHERE instance_id = v_coi AND user_id = v_owner;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_propagate_linked_aggregate ON public.activity_instances;
CREATE TRIGGER trg_propagate_linked_aggregate
  AFTER UPDATE OF status ON public.activity_instances
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.propagate_linked_aggregate();

NOTIFY pgrst, 'reload schema';
