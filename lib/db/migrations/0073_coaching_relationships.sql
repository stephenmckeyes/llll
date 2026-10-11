-- ---------------------------------------------------------------------------
-- 0073 — Coaches phase 2: coaching relationships + coach↔client chat.
--
-- A client "engages" a verified coach, creating a coaching_relationships row
-- (active). That relationship (a) anchors "current vs past" coaches/clients and
-- (b) permits 1:1 messaging between the pair WITHOUT a friendship — by
-- extending the messages INSERT policy. Chat reuses the existing `messages`
-- table + ChatThread UI via a dedicated coach-chat route.
--
--   * coaching_relationships (coach_user_id, client_user_id, status, …).
--   * start_coaching / end_coaching RPCs.
--   * messages_self_insert recreated: friendship OR active coaching pair.
--
-- Requires 0014 (messages) + 0072 (coach_profiles).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.coaching_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  client_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  CHECK (coach_user_id <> client_user_id),
  UNIQUE (coach_user_id, client_user_id)
);

CREATE INDEX IF NOT EXISTS coaching_rel_coach_idx
  ON public.coaching_relationships (coach_user_id);
CREATE INDEX IF NOT EXISTS coaching_rel_client_idx
  ON public.coaching_relationships (client_user_id);

ALTER TABLE public.coaching_relationships ENABLE ROW LEVEL SECURITY;

-- Either participant can read the relationship.
DROP POLICY IF EXISTS coaching_rel_select ON public.coaching_relationships;
CREATE POLICY coaching_rel_select ON public.coaching_relationships
  FOR SELECT USING (
    coach_user_id = auth.uid() OR client_user_id = auth.uid()
  );

-- start_coaching — the caller (client) engages a verified coach. Reactivates an
-- ended relationship. Returns the relationship id.
CREATE OR REPLACE FUNCTION public.start_coaching(p_coach_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_verified boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_coach_user_id = v_uid THEN
    RAISE EXCEPTION 'you cannot coach yourself';
  END IF;
  SELECT (status = 'verified') INTO v_verified
  FROM public.coach_profiles WHERE user_id = p_coach_user_id;
  IF NOT COALESCE(v_verified, false) THEN
    RAISE EXCEPTION 'not a verified coach';
  END IF;

  INSERT INTO public.coaching_relationships
    (coach_user_id, client_user_id, status, started_at, ended_at)
  VALUES (p_coach_user_id, v_uid, 'active', now(), NULL)
  ON CONFLICT (coach_user_id, client_user_id)
  DO UPDATE SET status = 'active', started_at = now(), ended_at = NULL
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.start_coaching(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.start_coaching(uuid) TO authenticated;

-- end_coaching — either participant ends an active relationship.
CREATE OR REPLACE FUNCTION public.end_coaching(p_other_user_id uuid)
RETURNS void
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
  UPDATE public.coaching_relationships
  SET status = 'ended', ended_at = now()
  WHERE status = 'active'
    AND (
      (coach_user_id = v_uid AND client_user_id = p_other_user_id)
      OR (client_user_id = v_uid AND coach_user_id = p_other_user_id)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.end_coaching(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.end_coaching(uuid) TO authenticated;

-- get_my_coaches — relationships where the caller is the client (their coaches).
CREATE OR REPLACE FUNCTION public.get_my_coaches()
RETURNS TABLE (
  other_user_id uuid,
  display_name text,
  username text,
  photo_url text,
  status text,
  started_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT c.coach_user_id, pr.display_name, pr.username, cp.photo_url,
         c.status, c.started_at
  FROM public.coaching_relationships c
  JOIN public.profiles pr ON pr.id = c.coach_user_id
  LEFT JOIN public.coach_profiles cp ON cp.user_id = c.coach_user_id
  WHERE c.client_user_id = auth.uid()
  ORDER BY (c.status = 'active') DESC, c.started_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_my_coaches() FROM public;
GRANT EXECUTE ON FUNCTION public.get_my_coaches() TO authenticated;

-- get_my_clients — relationships where the caller is the coach (their clients).
CREATE OR REPLACE FUNCTION public.get_my_clients()
RETURNS TABLE (
  other_user_id uuid,
  display_name text,
  username text,
  status text,
  started_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT c.client_user_id, pr.display_name, pr.username, c.status, c.started_at
  FROM public.coaching_relationships c
  JOIN public.profiles pr ON pr.id = c.client_user_id
  WHERE c.coach_user_id = auth.uid()
  ORDER BY (c.status = 'active') DESC, c.started_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_my_clients() FROM public;
GRANT EXECUTE ON FUNCTION public.get_my_clients() TO authenticated;

-- get_coaching_counterparty — the other participant's name + relationship
-- status, for the coach-chat page guard (returns a row only if a relationship
-- exists in either direction).
CREATE OR REPLACE FUNCTION public.get_coaching_counterparty(p_other_user_id uuid)
RETURNS TABLE (
  display_name text,
  username text,
  status text,
  i_am_coach boolean
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT pr.display_name, pr.username, c.status,
         (c.coach_user_id = auth.uid()) AS i_am_coach
  FROM public.coaching_relationships c
  JOIN public.profiles pr ON pr.id = p_other_user_id
  WHERE (c.coach_user_id = auth.uid() AND c.client_user_id = p_other_user_id)
     OR (c.client_user_id = auth.uid() AND c.coach_user_id = p_other_user_id)
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_coaching_counterparty(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_coaching_counterparty(uuid) TO authenticated;

-- Allow 1:1 messaging between an accepted friendship OR an active coaching pair.
DROP POLICY IF EXISTS messages_self_insert ON public.messages;
CREATE POLICY messages_self_insert ON public.messages
  FOR INSERT WITH CHECK (
    sender_id = auth.uid()
    AND (
      EXISTS (
        SELECT 1 FROM public.friendships f
        WHERE f.status = 'accepted'
          AND (
            (f.requester_id = auth.uid() AND f.addressee_id = recipient_id)
            OR (f.addressee_id = auth.uid() AND f.requester_id = recipient_id)
          )
      )
      OR EXISTS (
        SELECT 1 FROM public.coaching_relationships c
        WHERE c.status = 'active'
          AND (
            (c.coach_user_id = auth.uid() AND c.client_user_id = recipient_id)
            OR (c.client_user_id = auth.uid() AND c.coach_user_id = recipient_id)
          )
      )
    )
  );

NOTIFY pgrst, 'reload schema';
