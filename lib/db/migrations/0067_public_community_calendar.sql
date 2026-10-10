-- ---------------------------------------------------------------------------
-- 0067 — Public (no-login) community calendar.
--
-- A community can opt into exposing its calendar on a public, logged-out page
-- (read-only). This adds:
--   * communities.public_calendar boolean (default false) — only meaningful
--     when visibility='public'.
--   * set_community_public_calendar — leadership toggle (can_edit_settings).
--   * get_public_community_calendar — an ANON-callable SECURITY DEFINER read
--     that returns the community's own activities + occurrences ONLY when
--     public_calendar=true AND visibility='public'. The member-only RLS on
--     community_owned_* is NOT loosened; this is a separate, explicitly-gated
--     path for the public page.
--
-- Requires 0031 (communities + has_community_permission era) + 0056
-- (community_owned_* tables) + 0062 (owned-activity option columns).
-- ---------------------------------------------------------------------------

ALTER TABLE public.communities
  ADD COLUMN IF NOT EXISTS public_calendar boolean NOT NULL DEFAULT false;

-- Leadership toggle. Enabling is only honored for public communities (a
-- private community can't be made publicly viewable).
CREATE OR REPLACE FUNCTION public.set_community_public_calendar(
  p_community_id uuid,
  p_on boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.has_community_permission(p_community_id, auth.uid(), 'can_edit_settings') THEN
    RAISE EXCEPTION 'not permitted';
  END IF;
  UPDATE public.communities
  SET public_calendar = (
    p_on AND visibility = 'public'
  )
  WHERE id = p_community_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_community_public_calendar(uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.set_community_public_calendar(uuid, boolean) TO authenticated;

-- Anon-safe public read. Returns jsonb { community, activities, instances }
-- for [p_from, p_to], or NULL when the community isn't publicly shared. Only
-- active (non-archived) owned activities are exposed.
CREATE OR REPLACE FUNCTION public.get_public_community_calendar(
  p_community_id uuid,
  p_from date,
  p_to date
) RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'community', jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'kind', c.kind,
      'handle', c.handle,
      'description', c.description
    ),
    'activities', COALESCE((
      SELECT jsonb_agg(to_jsonb(a) ORDER BY a.name)
      FROM public.community_owned_activities a
      WHERE a.community_id = c.id AND a.archived_at IS NULL
    ), '[]'::jsonb),
    'instances', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', i.id,
        'activity_id', i.activity_id,
        'scheduled_for', i.scheduled_for,
        'status', i.status,
        'comment', i.comment
      ))
      FROM public.community_owned_instances i
      JOIN public.community_owned_activities a2 ON a2.id = i.activity_id
      WHERE i.community_id = c.id
        AND a2.archived_at IS NULL
        AND i.scheduled_for BETWEEN p_from AND p_to
    ), '[]'::jsonb)
  )
  FROM public.communities c
  WHERE c.id = p_community_id
    AND c.public_calendar = true
    AND c.visibility = 'public';
$$;

REVOKE ALL ON FUNCTION public.get_public_community_calendar(uuid, date, date) FROM public;
GRANT EXECUTE ON FUNCTION public.get_public_community_calendar(uuid, date, date) TO anon, authenticated;
