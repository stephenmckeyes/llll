-- ---------------------------------------------------------------------------
-- 0072 — Coaches, phase 1: profiles + application/verification + directory.
--
-- A user applies to be a coach (bio, photo, price). An admin verifies them
-- (for now the sole admin is whoever has profiles.is_admin = true). Verified
-- coaches appear in the public "Find a Coach" directory with their photo, bio,
-- price, and average rating. Later phases add coach↔client chat (reuse
-- `messages`), activity sharing, the coach activity "cache" (templates), and
-- review writing.
--
--   * profiles.is_admin — platform admin flag (verifies coach applications).
--   * coach_profiles — one row per applicant; status pending/verified/rejected.
--   * coach_reviews — per (coach, reviewer) rating 1-5 + body (write UI later).
--   * apply_as_coach / set_coach_status (admin) / get_coach_directory /
--     get_pending_coach_applications (admin) / get_my_coach_profile RPCs.
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.coach_profiles (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  bio text,
  photo_url text,
  price_amount numeric(10, 2),
  price_unit text CHECK (price_unit IN ('day', 'week')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'verified', 'rejected')),
  applied_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coach_profiles_status_idx
  ON public.coach_profiles (status);

CREATE TABLE IF NOT EXISTS public.coach_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (coach_user_id, reviewer_id)
);

CREATE INDEX IF NOT EXISTS coach_reviews_coach_idx
  ON public.coach_reviews (coach_user_id);

ALTER TABLE public.coach_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_reviews ENABLE ROW LEVEL SECURITY;

-- Reads go through SECURITY DEFINER RPCs below; keep direct table reads to the
-- owner (their own application) only.
DROP POLICY IF EXISTS coach_profiles_select_own ON public.coach_profiles;
CREATE POLICY coach_profiles_select_own ON public.coach_profiles
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS coach_reviews_select_all ON public.coach_reviews;
CREATE POLICY coach_reviews_select_all ON public.coach_reviews
  FOR SELECT USING (true);

-- apply_as_coach — create/update the caller's own coach application. First call
-- sets status='pending'; later edits keep the current status (admins re-review
-- if needed). Returns the resulting status.
CREATE OR REPLACE FUNCTION public.apply_as_coach(
  p_bio text,
  p_photo_url text,
  p_price_amount numeric,
  p_price_unit text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_status text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_price_unit IS NOT NULL AND p_price_unit NOT IN ('day', 'week') THEN
    RAISE EXCEPTION 'price unit must be day or week';
  END IF;

  INSERT INTO public.coach_profiles
    (user_id, bio, photo_url, price_amount, price_unit, status, updated_at)
  VALUES
    (v_uid, NULLIF(trim(coalesce(p_bio, '')), ''), NULLIF(trim(coalesce(p_photo_url, '')), ''),
     p_price_amount, p_price_unit, 'pending', now())
  ON CONFLICT (user_id) DO UPDATE SET
    bio = EXCLUDED.bio,
    photo_url = EXCLUDED.photo_url,
    price_amount = EXCLUDED.price_amount,
    price_unit = EXCLUDED.price_unit,
    updated_at = now()
  RETURNING status INTO v_status;
  RETURN v_status;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_as_coach(text, text, numeric, text) FROM public;
GRANT EXECUTE ON FUNCTION public.apply_as_coach(text, text, numeric, text) TO authenticated;

-- set_coach_status — admin verifies / rejects / re-pends an application.
CREATE OR REPLACE FUNCTION public.set_coach_status(
  p_user_id uuid,
  p_status text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  SELECT is_admin INTO v_is_admin FROM public.profiles WHERE id = v_uid;
  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'not permitted';
  END IF;
  IF p_status NOT IN ('pending', 'verified', 'rejected') THEN
    RAISE EXCEPTION 'invalid status';
  END IF;
  UPDATE public.coach_profiles
  SET status = p_status, reviewed_at = now(), reviewed_by = v_uid, updated_at = now()
  WHERE user_id = p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_coach_status(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.set_coach_status(uuid, text) TO authenticated;

-- get_coach_directory — the public "Find a Coach" list: verified coaches with
-- display info + rating aggregate. Any authenticated user.
CREATE OR REPLACE FUNCTION public.get_coach_directory()
RETURNS TABLE (
  user_id uuid,
  display_name text,
  username text,
  bio text,
  photo_url text,
  price_amount numeric,
  price_unit text,
  rating_avg numeric,
  rating_count int
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    cp.user_id,
    pr.display_name,
    pr.username,
    cp.bio,
    cp.photo_url,
    cp.price_amount,
    cp.price_unit,
    (SELECT round(avg(r.rating), 1) FROM public.coach_reviews r WHERE r.coach_user_id = cp.user_id),
    (SELECT count(*)::int FROM public.coach_reviews r WHERE r.coach_user_id = cp.user_id)
  FROM public.coach_profiles cp
  JOIN public.profiles pr ON pr.id = cp.user_id
  WHERE cp.status = 'verified'
  ORDER BY pr.display_name NULLS LAST, pr.username NULLS LAST;
$$;

REVOKE ALL ON FUNCTION public.get_coach_directory() FROM public;
GRANT EXECUTE ON FUNCTION public.get_coach_directory() TO authenticated;

-- get_pending_coach_applications — admin review queue.
CREATE OR REPLACE FUNCTION public.get_pending_coach_applications()
RETURNS TABLE (
  user_id uuid,
  display_name text,
  username text,
  bio text,
  photo_url text,
  price_amount numeric,
  price_unit text,
  applied_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    cp.user_id, pr.display_name, pr.username, cp.bio, cp.photo_url,
    cp.price_amount, cp.price_unit, cp.applied_at
  FROM public.coach_profiles cp
  JOIN public.profiles pr ON pr.id = cp.user_id
  WHERE cp.status = 'pending'
    AND EXISTS (
      SELECT 1 FROM public.profiles me
      WHERE me.id = auth.uid() AND me.is_admin = true
    )
  ORDER BY cp.applied_at;
$$;

REVOKE ALL ON FUNCTION public.get_pending_coach_applications() FROM public;
GRANT EXECUTE ON FUNCTION public.get_pending_coach_applications() TO authenticated;

NOTIFY pgrst, 'reload schema';
