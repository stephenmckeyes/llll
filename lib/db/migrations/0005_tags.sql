-- ===========================================================================
-- tags: per-user color palette for activity tags.
-- ---------------------------------------------------------------------------
-- Strictly a (user_id, name) → color lookup. Activities still store tag
-- NAMES on `activities.default_skill_tags text[]` (unchanged) — this table
-- only adds the optional color metadata. Two consequences:
--
--   1. Back-compat is automatic. Every existing activity keeps its tags
--      verbatim. Until the user explicitly colors a tag via the picker,
--      the UI renders that tag with a gray fallback.
--   2. Renaming a tag (a future feature) means UPDATEing this row's
--      `name` AND iterating over the user's activities to update each
--      `default_skill_tags[]` array. That's a single domain helper, not
--      a schema change.
--
-- `color` is a palette KEY (e.g., 'emerald', 'sky', 'amber'), NOT a hex.
-- The app maps palette keys to Tailwind class names so light + dark
-- modes both get sensible variants — see lib/domain/tags.ts.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.tags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name        text NOT NULL,
  color       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS tags_user_idx ON public.tags(user_id);

-- ---------------------------------------------------------------------------
-- RLS: each user reads/writes only their own tags. Same pattern as
-- activities and completions.
-- ---------------------------------------------------------------------------

ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tags_self ON public.tags;
CREATE POLICY tags_self ON public.tags
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
