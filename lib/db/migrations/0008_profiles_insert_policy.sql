-- ===========================================================================
-- 0008_profiles_insert_policy.sql — let a user INSERT their own profile.
--
-- Migration 0001 created SELECT + UPDATE policies on profiles and relied
-- on the `handle_new_auth_user` trigger (SECURITY DEFINER) to create the
-- row on signup. In practice that trigger doesn't always fire on hosted
-- Supabase (e.g. certain signup paths), leaving a new user with NO
-- profile row. The onboarding flow's upsert then tries to INSERT one and
-- is blocked by RLS — "new row violates row-level security policy for
-- table 'profiles'" — which hard-blocks brand-new users from finishing
-- signup.
--
-- Adding a self-insert policy makes the onboarding upsert resilient
-- regardless of whether the trigger ran. WITH CHECK (auth.uid() = id)
-- guarantees a user can only ever create THEIR OWN profile row.
-- ===========================================================================

DROP POLICY IF EXISTS profiles_self_insert ON public.profiles;
CREATE POLICY profiles_self_insert ON public.profiles
  FOR INSERT
  WITH CHECK (auth.uid() = id);
