-- ---------------------------------------------------------------------------
-- 0064 — Customizable community Home page (widgets).
--
-- Leadership composes the Home tab from sized "widgets" (text / upcoming
-- activities / image / members) laid out on a 2-column grid, and chooses
-- whether the page fits on one screen or scrolls.
--
--   communities.home_layout      jsonb  — ordered array of widget objects
--   communities.home_fit_one_page boolean — true = fit (no scroll)
--
-- The legacy `home_content` text column is kept; the editor seeds a text
-- widget from it on first use. Saving the layout is gated by
-- can_edit_settings (same as set_community_home). Requires 0051 + 0041.
-- ---------------------------------------------------------------------------

ALTER TABLE public.communities
  ADD COLUMN IF NOT EXISTS home_layout jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS home_fit_one_page boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.set_community_home_layout(
  p_community_id uuid,
  p_layout jsonb,
  p_fit boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.has_community_permission(p_community_id, v_uid, 'can_edit_settings') THEN
    RAISE EXCEPTION 'not permitted';
  END IF;
  IF p_layout IS NULL OR jsonb_typeof(p_layout) <> 'array' THEN
    RAISE EXCEPTION 'layout must be a json array';
  END IF;
  IF jsonb_array_length(p_layout) > 24 THEN
    RAISE EXCEPTION 'too many widgets';
  END IF;

  UPDATE public.communities
  SET home_layout = p_layout,
      home_fit_one_page = COALESCE(p_fit, false)
  WHERE id = p_community_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_community_home_layout(uuid, jsonb, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.set_community_home_layout(uuid, jsonb, boolean) TO authenticated;
