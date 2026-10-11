-- ---------------------------------------------------------------------------
-- 0071 — Page layout phase 2: allow Total + Streaks as member tabs.
--
-- Extends the leadership page-layout config (migration 0068) so "total" and
-- "streaks" are valid member tabs leadership can show/hide/reorder, alongside
-- home / calendar / chat. The default order is unchanged (home → calendar →
-- chat), so existing communities are unaffected — total/streaks are opt-in.
--
-- Only the allowed-keys set in set_community_page_layout changes.
-- ---------------------------------------------------------------------------

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
  v_known text[] := ARRAY['home', 'calendar', 'total', 'streaks', 'chat'];
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

NOTIFY pgrst, 'reload schema';
