-- ---------------------------------------------------------------------------
-- 0074 — Coaches phase 4: coach activity cache (templates) + offers.
--
-- A coach keeps a reusable library of activity templates (name, rhythm, times,
-- tags). They send a template to a client (active coaching relationship) as an
-- OFFER — a snapshot of the template fields + a suggested start date. The
-- client accepts (→ the app materializes a normal personal activity on their
-- calendar) or declines. The cache lets a coach mass-distribute basic plans and
-- duplicate-then-tweak a near-identical plan per client.
--
--   * coach_activity_templates — the coach's library (coach-owned).
--   * coach_activity_offers — a sent plan awaiting the client's accept/decline.
--     INSERT gated (RLS) to the coach of an active coaching relationship;
--     the client can update status (accept/decline).
--   * get_my_coach_offers(status) — client's incoming offers + coach name.
--
-- Requires 0072 (coach_profiles) + 0073 (coaching_relationships).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.coach_activity_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  notes text,
  rhythm jsonb NOT NULL,
  scheduled_times text[] NOT NULL DEFAULT '{}',
  scheduled_end_times text[] NOT NULL DEFAULT '{}',
  default_skill_tags text[] NOT NULL DEFAULT '{}',
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coach_templates_coach_idx
  ON public.coach_activity_templates (coach_user_id);

CREATE TABLE IF NOT EXISTS public.coach_activity_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  client_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  notes text,
  rhythm jsonb NOT NULL,
  scheduled_times text[] NOT NULL DEFAULT '{}',
  scheduled_end_times text[] NOT NULL DEFAULT '{}',
  default_skill_tags text[] NOT NULL DEFAULT '{}',
  start_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz
);

CREATE INDEX IF NOT EXISTS coach_offers_client_idx
  ON public.coach_activity_offers (client_user_id, status);
CREATE INDEX IF NOT EXISTS coach_offers_coach_idx
  ON public.coach_activity_offers (coach_user_id);

ALTER TABLE public.coach_activity_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_activity_offers ENABLE ROW LEVEL SECURITY;

-- Templates: fully owner-managed (the coach).
DROP POLICY IF EXISTS coach_templates_all ON public.coach_activity_templates;
CREATE POLICY coach_templates_all ON public.coach_activity_templates
  FOR ALL USING (coach_user_id = auth.uid())
  WITH CHECK (coach_user_id = auth.uid());

-- Offers: either participant can read.
DROP POLICY IF EXISTS coach_offers_select ON public.coach_activity_offers;
CREATE POLICY coach_offers_select ON public.coach_activity_offers
  FOR SELECT USING (
    coach_user_id = auth.uid() OR client_user_id = auth.uid()
  );

-- Only the coach of an ACTIVE coaching relationship may send an offer.
DROP POLICY IF EXISTS coach_offers_insert ON public.coach_activity_offers;
CREATE POLICY coach_offers_insert ON public.coach_activity_offers
  FOR INSERT WITH CHECK (
    coach_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.coaching_relationships c
      WHERE c.status = 'active'
        AND c.coach_user_id = auth.uid()
        AND c.client_user_id = coach_activity_offers.client_user_id
    )
  );

-- The client responds (accept/decline) → status update on their own offers.
DROP POLICY IF EXISTS coach_offers_client_update ON public.coach_activity_offers;
CREATE POLICY coach_offers_client_update ON public.coach_activity_offers
  FOR UPDATE USING (client_user_id = auth.uid());

-- get_my_coach_offers — the caller's incoming offers (as client) + coach name.
CREATE OR REPLACE FUNCTION public.get_my_coach_offers(p_status text DEFAULT 'pending')
RETURNS TABLE (
  id uuid,
  coach_user_id uuid,
  coach_name text,
  coach_username text,
  name text,
  notes text,
  rhythm jsonb,
  scheduled_times text[],
  start_date date,
  status text,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT o.id, o.coach_user_id, pr.display_name, pr.username, o.name, o.notes,
         o.rhythm, o.scheduled_times, o.start_date, o.status, o.created_at
  FROM public.coach_activity_offers o
  JOIN public.profiles pr ON pr.id = o.coach_user_id
  WHERE o.client_user_id = auth.uid()
    AND (p_status = 'all' OR o.status = p_status)
  ORDER BY o.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_my_coach_offers(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_my_coach_offers(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
