-- ===========================================================================
-- Auth setup: profile auto-create trigger + Row-Level Security policies
-- ---------------------------------------------------------------------------
-- This migration cannot be expressed in Drizzle's TypeScript schema, so it
-- was generated with `drizzle-kit generate --custom` and the SQL written
-- by hand. Re-applying is safe: every statement uses IF NOT EXISTS or
-- OR REPLACE where possible.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Auto-create a profile row whenever a new auth user signs up.
--
-- Without this, sign-up succeeds in auth.users but every query that joins
-- through public.profiles.user_id finds nothing. SECURITY DEFINER lets the
-- function bypass RLS on profiles (it runs as the function owner), which is
-- what we want for this controlled insert.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, timezone, created_at)
  VALUES (NEW.id, 'UTC', NOW())
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- 2. Row-Level Security.
--
-- Enabling RLS without policies = "no one can access anything" (except the
-- service role, which bypasses RLS). Each policy below grants the minimum
-- needed access for the owning user. Once auth is wired up on the front-end,
-- the anon Supabase key combined with the user's session JWT will satisfy
-- `auth.uid()`.
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_activities           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_activity_instances   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks                          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.completions                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.completion_instances           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.completion_tasks               ENABLE ROW LEVEL SECURITY;

-- profiles: a user reads/updates their own row only.
DROP POLICY IF EXISTS profiles_self_select ON public.profiles;
CREATE POLICY profiles_self_select ON public.profiles
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS profiles_self_update ON public.profiles;
CREATE POLICY profiles_self_update ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- (Inserts into profiles happen via the SECURITY DEFINER trigger above;
--  no public insert policy needed.)

-- recurring_activities: full access to one's own.
DROP POLICY IF EXISTS recurring_activities_self ON public.recurring_activities;
CREATE POLICY recurring_activities_self ON public.recurring_activities
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- recurring_activity_instances: owner via the parent activity.
DROP POLICY IF EXISTS rai_self ON public.recurring_activity_instances;
CREATE POLICY rai_self ON public.recurring_activity_instances
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.recurring_activities ra
      WHERE ra.id = recurring_activity_id
        AND ra.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.recurring_activities ra
      WHERE ra.id = recurring_activity_id
        AND ra.user_id = auth.uid()
    )
  );

-- tasks: full access to one's own.
DROP POLICY IF EXISTS tasks_self ON public.tasks;
CREATE POLICY tasks_self ON public.tasks
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- completions: full access to one's own.
DROP POLICY IF EXISTS completions_self ON public.completions;
CREATE POLICY completions_self ON public.completions
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- completion_instances: owner via parent completion.
DROP POLICY IF EXISTS completion_instances_self ON public.completion_instances;
CREATE POLICY completion_instances_self ON public.completion_instances
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.completions c
      WHERE c.id = completion_id AND c.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.completions c
      WHERE c.id = completion_id AND c.user_id = auth.uid()
    )
  );

-- completion_tasks: owner via parent completion.
DROP POLICY IF EXISTS completion_tasks_self ON public.completion_tasks;
CREATE POLICY completion_tasks_self ON public.completion_tasks
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.completions c
      WHERE c.id = completion_id AND c.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.completions c
      WHERE c.id = completion_id AND c.user_id = auth.uid()
    )
  );
