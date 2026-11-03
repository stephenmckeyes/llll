-- ---------------------------------------------------------------------------
-- 0081 — Coach PLANS: a named plan (title + description/notes) that contains
-- MULTIPLE activities, replacing the old single-activity "template" model.
--
-- A plan is its own thing with an explanation up top and a list of activities
-- below (each activity authored like the normal Add-Activity form). A coach
-- sends a whole plan to a client as an offer; accepting materializes ALL of the
-- plan's activities onto the client's calendar.
--
--   * coach_plans (title + description + visibility) — owner-managed.
--   * coach_plan_activities (per-plan activity rows, ordered).
--   * coach_plan_offers (a sent plan snapshot: name/description + coach name) +
--     coach_plan_offer_activities (the snapshotted activities).
--
-- The old coach_activity_templates / coach_activity_offers tables (0074) are
-- left in place but no longer used by the UI. `visibility` is here for the
-- upcoming richer-profile work (public/free plans); only 'private' is honored
-- by this migration's flows.
--
-- Requires 0072 (coach_profiles) + 0073 (coaching_relationships).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.coach_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  visibility text NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'public')),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coach_plans_coach_idx ON public.coach_plans (coach_user_id);

CREATE TABLE IF NOT EXISTS public.coach_plan_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.coach_plans(id) ON DELETE CASCADE,
  name text NOT NULL,
  notes text,
  rhythm jsonb NOT NULL,
  scheduled_times text[] NOT NULL DEFAULT '{}',
  scheduled_end_times text[] NOT NULL DEFAULT '{}',
  default_skill_tags text[] NOT NULL DEFAULT '{}',
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coach_plan_activities_plan_idx
  ON public.coach_plan_activities (plan_id, sort_order);

CREATE TABLE IF NOT EXISTS public.coach_plan_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  client_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  coach_name text,
  plan_title text NOT NULL,
  plan_description text,
  start_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz
);

CREATE INDEX IF NOT EXISTS coach_plan_offers_client_idx
  ON public.coach_plan_offers (client_user_id, status);

CREATE TABLE IF NOT EXISTS public.coach_plan_offer_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL REFERENCES public.coach_plan_offers(id) ON DELETE CASCADE,
  name text NOT NULL,
  notes text,
  rhythm jsonb NOT NULL,
  scheduled_times text[] NOT NULL DEFAULT '{}',
  scheduled_end_times text[] NOT NULL DEFAULT '{}',
  default_skill_tags text[] NOT NULL DEFAULT '{}',
  sort_order int NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS coach_plan_offer_activities_offer_idx
  ON public.coach_plan_offer_activities (offer_id, sort_order);

ALTER TABLE public.coach_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_plan_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_plan_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_plan_offer_activities ENABLE ROW LEVEL SECURITY;

-- Plans: owner-managed; public plans are readable by anyone (for previews).
DROP POLICY IF EXISTS coach_plans_owner_all ON public.coach_plans;
CREATE POLICY coach_plans_owner_all ON public.coach_plans
  FOR ALL USING (coach_user_id = auth.uid())
  WITH CHECK (coach_user_id = auth.uid());

DROP POLICY IF EXISTS coach_plans_public_select ON public.coach_plans;
CREATE POLICY coach_plans_public_select ON public.coach_plans
  FOR SELECT USING (visibility = 'public');

-- Plan activities: manageable by the plan's owner; readable when the parent
-- plan is readable (owner or public).
DROP POLICY IF EXISTS coach_plan_activities_owner_all ON public.coach_plan_activities;
CREATE POLICY coach_plan_activities_owner_all ON public.coach_plan_activities
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.coach_plans p
            WHERE p.id = plan_id AND p.coach_user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.coach_plans p
            WHERE p.id = plan_id AND p.coach_user_id = auth.uid())
  );

DROP POLICY IF EXISTS coach_plan_activities_public_select ON public.coach_plan_activities;
CREATE POLICY coach_plan_activities_public_select ON public.coach_plan_activities
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.coach_plans p
            WHERE p.id = plan_id AND p.visibility = 'public')
  );

-- Offers: either participant reads; coach of an active relationship sends;
-- client updates status (accept/decline).
DROP POLICY IF EXISTS coach_plan_offers_select ON public.coach_plan_offers;
CREATE POLICY coach_plan_offers_select ON public.coach_plan_offers
  FOR SELECT USING (
    coach_user_id = auth.uid() OR client_user_id = auth.uid()
  );

DROP POLICY IF EXISTS coach_plan_offers_insert ON public.coach_plan_offers;
CREATE POLICY coach_plan_offers_insert ON public.coach_plan_offers
  FOR INSERT WITH CHECK (
    coach_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.coaching_relationships c
      WHERE c.status = 'active'
        AND c.coach_user_id = auth.uid()
        AND c.client_user_id = coach_plan_offers.client_user_id
    )
  );

DROP POLICY IF EXISTS coach_plan_offers_client_update ON public.coach_plan_offers;
CREATE POLICY coach_plan_offers_client_update ON public.coach_plan_offers
  FOR UPDATE USING (client_user_id = auth.uid());

-- Offer activities: readable/insertable alongside their parent offer.
DROP POLICY IF EXISTS coach_plan_offer_activities_select ON public.coach_plan_offer_activities;
CREATE POLICY coach_plan_offer_activities_select ON public.coach_plan_offer_activities
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.coach_plan_offers o
            WHERE o.id = offer_id
              AND (o.coach_user_id = auth.uid() OR o.client_user_id = auth.uid()))
  );

DROP POLICY IF EXISTS coach_plan_offer_activities_insert ON public.coach_plan_offer_activities;
CREATE POLICY coach_plan_offer_activities_insert ON public.coach_plan_offer_activities
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.coach_plan_offers o
            WHERE o.id = offer_id AND o.coach_user_id = auth.uid())
  );

NOTIFY pgrst, 'reload schema';
