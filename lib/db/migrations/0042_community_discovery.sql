-- ---------------------------------------------------------------------------
-- 0042 — Community discovery (Phase 5).
--
-- Public clubs / guilds are already discoverable via the communities_select
-- RLS policy (visibility = 'public'), so name/handle search runs as a plain
-- client query — no RPC needed for that.
--
-- Private GROUPS are handle-only: you can't SELECT them under RLS unless
-- you're a member, so this SECURITY DEFINER RPC lets someone look one up by
-- EXACT handle (case-insensitive) in order to request to join it. It returns
-- only the safe summary fields, and only on an exact handle match — no
-- listing / enumeration.
--
-- NOTE: this migration adds only a function (no new column), so the
-- schema-check banner can't detect it automatically — apply it manually.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.find_community_by_handle(
  p_handle text
) RETURNS TABLE (
  id           uuid,
  kind         text,
  name         text,
  handle       text,
  description  text,
  visibility   text,
  join_policy  text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.kind, c.name, c.handle, c.description, c.visibility, c.join_policy
  FROM public.communities c
  WHERE c.handle IS NOT NULL
    AND lower(c.handle) = lower(trim(p_handle))
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.find_community_by_handle(text) FROM public;
GRANT EXECUTE ON FUNCTION public.find_community_by_handle(text) TO authenticated;
