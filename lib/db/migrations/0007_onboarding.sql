-- ===========================================================================
-- 0007_onboarding.sql — first-time-user setup flow.
--
-- Adds `profiles.onboarded_at`. NULL = user hasn't completed onboarding
-- yet; the app routes those users to /onboarding regardless of which
-- page they navigate to.
--
-- Backfill: every EXISTING profile is treated as already onboarded so
-- current users aren't bounced to a setup screen on next login. New
-- signups inserted via `handle_new_auth_user` get the default (NULL)
-- and have to complete the form once.
-- ===========================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarded_at timestamptz;

-- Grandfather existing rows: any profile that exists when this
-- migration runs is treated as already onboarded. We use created_at
-- as the timestamp so we have something meaningful, not now().
UPDATE public.profiles
SET    onboarded_at = created_at
WHERE  onboarded_at IS NULL;
