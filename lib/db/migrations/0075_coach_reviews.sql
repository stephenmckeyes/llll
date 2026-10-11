-- ---------------------------------------------------------------------------
-- 0075 — Coaches phase 5: reviews/ratings writing.
--
-- A client who has (or had) a coaching relationship with a coach can leave a
-- 1-5 star review + optional text. One review per (coach, reviewer) — resubmit
-- updates it. The directory already surfaces the average + count (migration
-- 0072); this adds the write path + a per-coach reviews read.
--
--   * submit_coach_review — upsert the caller's review (requires a coaching
--     relationship, any status; can't review yourself).
--   * get_coach_reviews — a coach's reviews + reviewer names (public read).
--   * get_my_coach_review — the caller's own review of a coach (prefill).
--
-- Requires 0072 (coach_reviews) + 0073 (coaching_relationships).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.submit_coach_review(
  p_coach_user_id uuid,
  p_rating smallint,
  p_body text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_coach_user_id = v_uid THEN
    RAISE EXCEPTION 'you cannot review yourself';
  END IF;
  IF p_rating < 1 OR p_rating > 5 THEN
    RAISE EXCEPTION 'rating must be 1-5';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.coaching_relationships c
    WHERE c.coach_user_id = p_coach_user_id
      AND c.client_user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'you can only review a coach you have worked with';
  END IF;

  INSERT INTO public.coach_reviews
    (coach_user_id, reviewer_id, rating, body, created_at)
  VALUES
    (p_coach_user_id, v_uid, p_rating, NULLIF(trim(coalesce(p_body, '')), ''), now())
  ON CONFLICT (coach_user_id, reviewer_id)
  DO UPDATE SET rating = EXCLUDED.rating, body = EXCLUDED.body, created_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.submit_coach_review(uuid, smallint, text) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_coach_review(uuid, smallint, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_coach_reviews(p_coach_user_id uuid)
RETURNS TABLE (
  reviewer_name text,
  reviewer_username text,
  rating smallint,
  body text,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT pr.display_name, pr.username, r.rating, r.body, r.created_at
  FROM public.coach_reviews r
  JOIN public.profiles pr ON pr.id = r.reviewer_id
  WHERE r.coach_user_id = p_coach_user_id
  ORDER BY r.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_coach_reviews(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_coach_reviews(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_coach_review(p_coach_user_id uuid)
RETURNS TABLE (rating smallint, body text)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT r.rating, r.body
  FROM public.coach_reviews r
  WHERE r.coach_user_id = p_coach_user_id AND r.reviewer_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.get_my_coach_review(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_my_coach_review(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
