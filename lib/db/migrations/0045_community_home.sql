-- ---------------------------------------------------------------------------
-- 0045 — Community homepage + member-visibility setting.
--
-- Splitting a community into sub-tabs (Home / Calendar / Chat / Settings):
--   * home_content — the editable landing page members see first. Free text
--     (rendered as plain text with line breaks — no HTML). Edited by
--     leadership.
--   * show_members — leadership toggle for whether the member roster + count
--     are shown on the Home/overview (leadership always sees members in
--     Settings for management, regardless).
--
-- Requires 0031/0040 (is_community_leadership).
-- ---------------------------------------------------------------------------

ALTER TABLE public.communities
  ADD COLUMN IF NOT EXISTS home_content text;
ALTER TABLE public.communities
  ADD COLUMN IF NOT EXISTS show_members boolean NOT NULL DEFAULT true;

-- set_community_home — leadership edit the homepage content.
CREATE OR REPLACE FUNCTION public.set_community_home(
  p_community_id uuid,
  p_content text
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
  IF NOT public.is_community_leadership(p_community_id, v_uid) THEN
    RAISE EXCEPTION 'not permitted';
  END IF;

  UPDATE public.communities
  SET home_content = NULLIF(TRIM(p_content), ''),
      updated_at = now()
  WHERE id = p_community_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_community_home(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.set_community_home(uuid, text) TO authenticated;

-- set_community_show_members — leadership toggle member-roster visibility.
CREATE OR REPLACE FUNCTION public.set_community_show_members(
  p_community_id uuid,
  p_show boolean
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
  IF NOT public.is_community_leadership(p_community_id, v_uid) THEN
    RAISE EXCEPTION 'not permitted';
  END IF;

  UPDATE public.communities
  SET show_members = p_show, updated_at = now()
  WHERE id = p_community_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_community_show_members(uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.set_community_show_members(uuid, boolean) TO authenticated;
