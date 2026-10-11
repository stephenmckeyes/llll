-- ---------------------------------------------------------------------------
-- 0068 — Leadership-configurable community page layout.
--
-- Leadership can choose which member-facing sub-tabs a community surfaces, and
-- in what order. Stored as an ordered JSON array of tab keys on the community,
-- e.g. ["calendar","home","chat"]. NULL = the default order
-- (home → calendar → chat), so existing communities are unaffected.
--
-- The Settings tab is NOT part of this config — it's always leadership-only
-- and appended by the client for members with a management permission.
--
--   * communities.page_layout jsonb (nullable).
--   * set_community_page_layout — leadership toggle (can_edit_settings),
--     validates the array is a subset of the known member tabs with no
--     duplicates and at least one entry; pass JSON null to reset to default.
--
-- Requires 0031 (communities + has_community_permission era).
-- ---------------------------------------------------------------------------

ALTER TABLE public.communities
  ADD COLUMN IF NOT EXISTS page_layout jsonb;

CREATE OR REPLACE FUNCTION public.set_community_page_layout(
  p_community_id uuid,
  p_layout jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_known text[] := ARRAY['home', 'calendar', 'chat'];
  v_elem text;
  v_seen text[] := ARRAY[]::text[];
  v_count int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.has_community_permission(p_community_id, v_uid, 'can_edit_settings') THEN
    RAISE EXCEPTION 'not permitted';
  END IF;

  -- JSON null (or SQL NULL) resets to the default order.
  IF p_layout IS NULL OR jsonb_typeof(p_layout) = 'null' THEN
    UPDATE public.communities SET page_layout = NULL WHERE id = p_community_id;
    RETURN;
  END IF;

  IF jsonb_typeof(p_layout) <> 'array' THEN
    RAISE EXCEPTION 'page_layout must be a JSON array';
  END IF;

  v_count := jsonb_array_length(p_layout);
  IF v_count < 1 THEN
    RAISE EXCEPTION 'page_layout must list at least one tab';
  END IF;

  -- Validate each entry: a known member tab, no duplicates.
  FOR v_elem IN SELECT jsonb_array_elements_text(p_layout) LOOP
    IF NOT (v_elem = ANY (v_known)) THEN
      RAISE EXCEPTION 'unknown tab: %', v_elem;
    END IF;
    IF v_elem = ANY (v_seen) THEN
      RAISE EXCEPTION 'duplicate tab: %', v_elem;
    END IF;
    v_seen := array_append(v_seen, v_elem);
  END LOOP;

  UPDATE public.communities SET page_layout = p_layout WHERE id = p_community_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_community_page_layout(uuid, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.set_community_page_layout(uuid, jsonb) TO authenticated;
