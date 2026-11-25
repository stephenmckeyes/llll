-- ---------------------------------------------------------------------------
-- 0086_invitation_change_notices.sql — tell attendees when an invitation they
-- added to their calendar is changed or cancelled.
--
-- An AFTER UPDATE trigger on invitations writes one pending notice per
-- attendee (except whoever made the edit):
--   kind 'updated'   — `changes` = { field: { from, to } } for the fields that
--                      shape the attendee's calendar copy (name, notes, rhythm,
--                      dates, times, tags, location). Repeated edits before the
--                      attendee responds MERGE into the one pending notice,
--                      keeping each field's ORIGINAL `from`.
--   kind 'cancelled' — the invitation was archived.
-- The attendee resolves it from /notifications: apply the changes to their
-- copy / remove it ('applied' | 'removed') or keep their copy ('kept').
-- Audience/skill/spots edits don't touch anyone's calendar, so they don't
-- notify.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.invitation_change_notices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id uuid NOT NULL REFERENCES public.invitations(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('updated', 'cancelled')),
  changes       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz,
  resolution    text CHECK (resolution IS NULL OR resolution IN ('applied', 'removed', 'kept'))
);

-- At most one pending notice per (invitation, attendee).
CREATE UNIQUE INDEX IF NOT EXISTS invitation_change_notices_pending_uniq
  ON public.invitation_change_notices (invitation_id, user_id)
  WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS invitation_change_notices_user_idx
  ON public.invitation_change_notices (user_id) WHERE resolved_at IS NULL;

ALTER TABLE public.invitation_change_notices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invitation_change_notices_select_own ON public.invitation_change_notices;
CREATE POLICY invitation_change_notices_select_own ON public.invitation_change_notices
  FOR SELECT USING (user_id = auth.uid());

-- Attendees may only resolve their own notices (rows are created by the trigger).
DROP POLICY IF EXISTS invitation_change_notices_update_own ON public.invitation_change_notices;
CREATE POLICY invitation_change_notices_update_own ON public.invitation_change_notices
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ---- trigger ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_invitation_attendees()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_editor uuid := auth.uid();
  v_diff jsonb := '{}'::jsonb;
  r record;
  v_existing record;
  v_merged jsonb;
BEGIN
  -- Cancelled (archived) → cancellation notice, replacing any pending update.
  IF NEW.archived_at IS NOT NULL AND OLD.archived_at IS NULL THEN
    FOR r IN
      SELECT a.user_id FROM public.invitation_attendees a
      WHERE a.invitation_id = NEW.id
        AND a.user_id IS DISTINCT FROM v_editor
    LOOP
      INSERT INTO public.invitation_change_notices (invitation_id, user_id, kind)
      VALUES (NEW.id, r.user_id, 'cancelled')
      ON CONFLICT (invitation_id, user_id) WHERE resolved_at IS NULL
      DO UPDATE SET kind = 'cancelled', updated_at = now();
    END LOOP;
    RETURN NEW;
  END IF;

  -- Edits to an archived invitation (or a restore) don't notify.
  IF NEW.archived_at IS NOT NULL OR OLD.archived_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.name IS DISTINCT FROM OLD.name THEN
    v_diff := v_diff || jsonb_build_object('name', jsonb_build_object('from', OLD.name, 'to', NEW.name));
  END IF;
  IF NEW.notes IS DISTINCT FROM OLD.notes THEN
    v_diff := v_diff || jsonb_build_object('notes', jsonb_build_object('from', OLD.notes, 'to', NEW.notes));
  END IF;
  IF NEW.rhythm IS DISTINCT FROM OLD.rhythm THEN
    v_diff := v_diff || jsonb_build_object('rhythm', jsonb_build_object('from', OLD.rhythm, 'to', NEW.rhythm));
  END IF;
  IF NEW.start_date IS DISTINCT FROM OLD.start_date THEN
    v_diff := v_diff || jsonb_build_object('start_date', jsonb_build_object('from', OLD.start_date, 'to', NEW.start_date));
  END IF;
  IF NEW.end_date IS DISTINCT FROM OLD.end_date THEN
    v_diff := v_diff || jsonb_build_object('end_date', jsonb_build_object('from', OLD.end_date, 'to', NEW.end_date));
  END IF;
  IF NEW.scheduled_times IS DISTINCT FROM OLD.scheduled_times
     OR NEW.scheduled_end_times IS DISTINCT FROM OLD.scheduled_end_times THEN
    v_diff := v_diff || jsonb_build_object('times', jsonb_build_object(
      'from', jsonb_build_object('starts', to_jsonb(OLD.scheduled_times), 'ends', to_jsonb(OLD.scheduled_end_times)),
      'to',   jsonb_build_object('starts', to_jsonb(NEW.scheduled_times), 'ends', to_jsonb(NEW.scheduled_end_times))));
  END IF;
  IF NEW.default_skill_tags IS DISTINCT FROM OLD.default_skill_tags THEN
    v_diff := v_diff || jsonb_build_object('tags', jsonb_build_object('from', to_jsonb(OLD.default_skill_tags), 'to', to_jsonb(NEW.default_skill_tags)));
  END IF;
  IF NEW.location_name IS DISTINCT FROM OLD.location_name THEN
    v_diff := v_diff || jsonb_build_object('location', jsonb_build_object('from', OLD.location_name, 'to', NEW.location_name));
  END IF;

  IF v_diff = '{}'::jsonb THEN
    RETURN NEW;
  END IF;

  FOR r IN
    SELECT a.user_id FROM public.invitation_attendees a
    WHERE a.invitation_id = NEW.id
      AND a.user_id IS DISTINCT FROM v_editor
  LOOP
    SELECT id, changes INTO v_existing
    FROM public.invitation_change_notices
    WHERE invitation_id = NEW.id AND user_id = r.user_id AND resolved_at IS NULL;

    IF v_existing.id IS NULL THEN
      INSERT INTO public.invitation_change_notices (invitation_id, user_id, kind, changes)
      VALUES (NEW.id, r.user_id, 'updated', v_diff);
    ELSE
      -- Merge: keep the ORIGINAL `from` for fields already pending.
      SELECT v_existing.changes || COALESCE(jsonb_object_agg(
               d.key,
               jsonb_build_object(
                 'from', COALESCE(v_existing.changes -> d.key -> 'from', d.value -> 'from'),
                 'to',   d.value -> 'to')), '{}'::jsonb)
        INTO v_merged
      FROM jsonb_each(v_diff) d;
      UPDATE public.invitation_change_notices
      SET changes = v_merged, kind = 'updated', updated_at = now()
      WHERE id = v_existing.id;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invitations_notify_attendees ON public.invitations;
CREATE TRIGGER invitations_notify_attendees
  AFTER UPDATE ON public.invitations
  FOR EACH ROW EXECUTE FUNCTION public.notify_invitation_attendees();

NOTIFY pgrst, 'reload schema';
