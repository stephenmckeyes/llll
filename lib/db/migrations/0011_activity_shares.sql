-- ===========================================================================
-- 0011_activity_shares.sql — share a rhythm with a friend (read-only).
--
-- Builds on the friendships from 0010. A share is one row: "owner shared
-- activity A with friend B". Sharing is always per-activity, per-friend
-- (nothing is public) and revocable. share_progress controls whether the
-- friend also sees the owner's completion history, or just the template.
--
-- IMPORTANT — this migration does NOT touch the RLS on activities /
-- activity_instances or any existing query. Friends read shared rhythms
-- ONLY through the SECURITY DEFINER function get_shared_with_me() below,
-- which returns exactly what's shared with the caller and nothing else.
-- That keeps the core calendar/grid views completely unaffected.
--
-- Safe to re-run.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.activity_shares (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id     uuid NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
  owner_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shared_with_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Include the owner's completion history (true) or share just the
  -- template/schedule (false). Default true = friends can follow along.
  share_progress  boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT activity_shares_distinct CHECK (owner_id <> shared_with_id),
  CONSTRAINT activity_shares_unique UNIQUE (activity_id, shared_with_id)
);

CREATE INDEX IF NOT EXISTS activity_shares_recipient_idx
  ON public.activity_shares (shared_with_id);
CREATE INDEX IF NOT EXISTS activity_shares_owner_idx
  ON public.activity_shares (owner_id);

ALTER TABLE public.activity_shares ENABLE ROW LEVEL SECURITY;

-- See shares you're part of (either as owner or recipient).
DROP POLICY IF EXISTS activity_shares_self_select ON public.activity_shares;
CREATE POLICY activity_shares_self_select ON public.activity_shares
  FOR SELECT USING (
    auth.uid() = owner_id OR auth.uid() = shared_with_id
  );

-- Create a share: you must be the owner AND actually own the activity
-- (and you can only share with an accepted friend).
DROP POLICY IF EXISTS activity_shares_owner_insert ON public.activity_shares;
CREATE POLICY activity_shares_owner_insert ON public.activity_shares
  FOR INSERT WITH CHECK (
    owner_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.activities a
      WHERE a.id = activity_id AND a.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.friendships f
      WHERE f.status = 'accepted'
        AND (
          (f.requester_id = auth.uid() AND f.addressee_id = shared_with_id)
          OR (f.addressee_id = auth.uid() AND f.requester_id = shared_with_id)
        )
    )
  );

-- Toggle share_progress: owner only.
DROP POLICY IF EXISTS activity_shares_owner_update ON public.activity_shares;
CREATE POLICY activity_shares_owner_update ON public.activity_shares
  FOR UPDATE USING (owner_id = auth.uid());

-- Revoke a share: owner only.
DROP POLICY IF EXISTS activity_shares_owner_delete ON public.activity_shares;
CREATE POLICY activity_shares_owner_delete ON public.activity_shares
  FOR DELETE USING (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- get_shared_with_me() — every rhythm shared WITH the caller, including
-- the full activity definition (so it can be displayed read-only and
-- copied) plus the owner's safe fields and the share's settings.
-- SECURITY DEFINER so it can read the owner's activity row, but it
-- returns ONLY rows where shared_with_id = caller — never anything else.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_shared_with_me()
RETURNS TABLE (
  share_id            uuid,
  activity_id         uuid,
  owner_id            uuid,
  owner_username      text,
  owner_display_name  text,
  share_progress      boolean,
  name                text,
  notes               text,
  rhythm              jsonb,
  priority            smallint,
  scheduled_times     text[],
  default_skill_tags  text[],
  start_date          date,
  end_date            date,
  archived_at         timestamptz,
  created_at          timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id, a.id, s.owner_id, p.username, p.display_name, s.share_progress,
    a.name, a.notes, a.rhythm, a.priority, a.scheduled_times,
    a.default_skill_tags, a.start_date, a.end_date, a.archived_at,
    s.created_at
  FROM public.activity_shares s
  JOIN public.activities a ON a.id = s.activity_id
  JOIN public.profiles p ON p.id = s.owner_id
  WHERE s.shared_with_id = auth.uid()
  ORDER BY s.created_at DESC;
$$;
