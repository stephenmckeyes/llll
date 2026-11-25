-- ---------------------------------------------------------------------------
-- 0084_invitations.sql — Invitations (Community → Invitations tab).
--
-- An invitation is an activity (same shape as a normal activity: name, notes,
-- rhythm, dates, times, tags) that a PERSON or a COMMUNITY posts to invite
-- others to join them. Unlike a normal activity it REQUIRES a time of day and
-- a location, and carries an audience + skill level so viewers can filter.
--
-- Host:
--   - host_user_id is always the creator.
--   - host_community_id (optional) = posted on behalf of a community; requires
--     the creator to hold can_add_activities in that community.
-- Audience (who can see it):
--   - 'community' — members of audience_community_id (the hosting community,
--                   or for a person host, any community they belong to)
--   - 'friends'   — the creator's accepted friends (person host only)
--   - 'nearby'    — anyone whose (client-supplied) location is within
--                   radius_km of the invitation's coordinates. Location is a
--                   discovery filter, NOT a security boundary: the viewer's
--                   coordinates are passed per-query and never stored.
--   - 'public'    — any signed-in user
-- skill_level is a self-declared label ('all' | 'beginner' | 'intermediate' |
-- 'advanced'); the app has no per-user skill system yet.
--
-- Joining ("Add to my calendar") copies the invitation into a personal
-- activity (done in TS so it reuses generateInstances + reminders) and records
-- an invitation_attendees row linking the copy. capacity (optional) is
-- enforced in join_invitation.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.invitations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  host_community_id    uuid REFERENCES public.communities(id) ON DELETE CASCADE,
  name                 text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  notes                text,
  rhythm               jsonb NOT NULL,
  start_date           date NOT NULL,
  end_date             date,
  scheduled_times      text[] NOT NULL DEFAULT '{}'::text[],
  scheduled_end_times  text[] NOT NULL DEFAULT '{}'::text[],
  default_skill_tags   text[] NOT NULL DEFAULT '{}'::text[],
  location_name        text NOT NULL CHECK (char_length(location_name) BETWEEN 1 AND 200),
  latitude             double precision,
  longitude            double precision,
  audience             text NOT NULL DEFAULT 'friends'
                         CHECK (audience IN ('community', 'friends', 'nearby', 'public')),
  audience_community_id uuid REFERENCES public.communities(id) ON DELETE CASCADE,
  radius_km            numeric CHECK (radius_km IS NULL OR (radius_km > 0 AND radius_km <= 1000)),
  skill_level          text NOT NULL DEFAULT 'all'
                         CHECK (skill_level IN ('all', 'beginner', 'intermediate', 'advanced')),
  capacity             int CHECK (capacity IS NULL OR capacity BETWEEN 1 AND 10000),
  archived_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invitations_has_time CHECK (cardinality(scheduled_times) >= 1),
  CONSTRAINT invitations_community_audience CHECK (
    audience <> 'community' OR audience_community_id IS NOT NULL
  ),
  CONSTRAINT invitations_nearby_needs_coords CHECK (
    audience <> 'nearby'
    OR (latitude IS NOT NULL AND longitude IS NOT NULL AND radius_km IS NOT NULL)
  ),
  CONSTRAINT invitations_community_host_no_friends CHECK (
    host_community_id IS NULL OR audience <> 'friends'
  )
);

CREATE INDEX IF NOT EXISTS invitations_host_user_idx ON public.invitations (host_user_id);
CREATE INDEX IF NOT EXISTS invitations_audience_community_idx ON public.invitations (audience_community_id);
CREATE INDEX IF NOT EXISTS invitations_active_idx ON public.invitations (audience) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS public.invitation_attendees (
  invitation_id uuid NOT NULL REFERENCES public.invitations(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_id   uuid REFERENCES public.activities(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (invitation_id, user_id)
);

CREATE INDEX IF NOT EXISTS invitation_attendees_user_idx ON public.invitation_attendees (user_id);

ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitation_attendees ENABLE ROW LEVEL SECURITY;

-- ---- helpers ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._are_friends(p_a uuid, p_b uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.friendships f
    WHERE f.status = 'accepted'
      AND ((f.requester_id = p_a AND f.addressee_id = p_b)
        OR (f.requester_id = p_b AND f.addressee_id = p_a))
  );
$$;
REVOKE ALL ON FUNCTION public._are_friends(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public._are_friends(uuid, uuid) TO authenticated;

-- Can p_user manage (edit / cancel) the invitation?
CREATE OR REPLACE FUNCTION public.can_manage_invitation(p_invitation_id uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.invitations i
    WHERE i.id = p_invitation_id
      AND (i.host_user_id = p_user
        OR (i.host_community_id IS NOT NULL
            AND public.has_community_permission(i.host_community_id, p_user, 'can_add_activities')))
  );
$$;
REVOKE ALL ON FUNCTION public.can_manage_invitation(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.can_manage_invitation(uuid, uuid) TO authenticated;

-- Audience check (location-agnostic: 'nearby' is readable by anyone signed in;
-- the distance gate is applied by get_available_invitations).
CREATE OR REPLACE FUNCTION public.can_view_invitation(p_invitation_id uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.invitations i
    WHERE i.id = p_invitation_id
      AND (
        i.host_user_id = p_user
        OR i.audience IN ('public', 'nearby')
        OR (i.audience = 'community'
            AND public.is_community_member(i.audience_community_id, p_user))
        OR (i.audience = 'friends' AND public._are_friends(i.host_user_id, p_user))
        OR (i.host_community_id IS NOT NULL
            AND public.has_community_permission(i.host_community_id, p_user, 'can_add_activities'))
        OR EXISTS (SELECT 1 FROM public.invitation_attendees a
                   WHERE a.invitation_id = i.id AND a.user_id = p_user)
      )
  );
$$;
REVOKE ALL ON FUNCTION public.can_view_invitation(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.can_view_invitation(uuid, uuid) TO authenticated;

-- ---- invitations RLS --------------------------------------------------------

DROP POLICY IF EXISTS invitations_select ON public.invitations;
CREATE POLICY invitations_select ON public.invitations
  FOR SELECT USING (public.can_view_invitation(id, auth.uid()));

DROP POLICY IF EXISTS invitations_insert ON public.invitations;
CREATE POLICY invitations_insert ON public.invitations
  FOR INSERT WITH CHECK (
    host_user_id = auth.uid()
    AND (host_community_id IS NULL
         OR public.has_community_permission(host_community_id, auth.uid(), 'can_add_activities'))
    AND (audience <> 'community'
         OR public.is_community_member(audience_community_id, auth.uid()))
    -- A community-hosted invitation targeting "community" must target ITS community.
    AND (host_community_id IS NULL OR audience <> 'community'
         OR audience_community_id = host_community_id)
  );

DROP POLICY IF EXISTS invitations_update ON public.invitations;
CREATE POLICY invitations_update ON public.invitations
  FOR UPDATE
  USING (public.can_manage_invitation(id, auth.uid()))
  WITH CHECK (
    (host_community_id IS NULL
     OR public.has_community_permission(host_community_id, auth.uid(), 'can_add_activities')
     OR host_user_id = auth.uid())
    AND (audience <> 'community'
         OR public.is_community_member(audience_community_id, auth.uid()))
  );

DROP POLICY IF EXISTS invitations_delete ON public.invitations;
CREATE POLICY invitations_delete ON public.invitations
  FOR DELETE USING (public.can_manage_invitation(id, auth.uid()));

-- ---- attendees RLS ----------------------------------------------------------
-- Read: your own rows, or rows of invitations you manage (attendee list).
-- Writes go through join_invitation / leave_invitation.

DROP POLICY IF EXISTS invitation_attendees_select ON public.invitation_attendees;
CREATE POLICY invitation_attendees_select ON public.invitation_attendees
  FOR SELECT USING (
    user_id = auth.uid()
    OR public.can_manage_invitation(invitation_id, auth.uid())
  );

DROP POLICY IF EXISTS invitation_attendees_delete_own ON public.invitation_attendees;
CREATE POLICY invitation_attendees_delete_own ON public.invitation_attendees
  FOR DELETE USING (user_id = auth.uid());

-- ---- RPCs -------------------------------------------------------------------

-- join_invitation — record the caller as attending (idempotent), linking the
-- personal activity copy. Enforces visibility + capacity.
CREATE OR REPLACE FUNCTION public.join_invitation(p_invitation_id uuid, p_activity_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_capacity int;
  v_count int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.can_view_invitation(p_invitation_id, v_uid) THEN
    RAISE EXCEPTION 'invitation not found';
  END IF;
  IF p_activity_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.activities WHERE id = p_activity_id AND user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'not your activity';
  END IF;

  SELECT capacity INTO v_capacity FROM public.invitations
  WHERE id = p_invitation_id AND archived_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invitation is no longer available';
  END IF;

  IF EXISTS (SELECT 1 FROM public.invitation_attendees
             WHERE invitation_id = p_invitation_id AND user_id = v_uid) THEN
    UPDATE public.invitation_attendees SET activity_id = p_activity_id
    WHERE invitation_id = p_invitation_id AND user_id = v_uid;
    RETURN;
  END IF;

  IF v_capacity IS NOT NULL THEN
    SELECT count(*) INTO v_count FROM public.invitation_attendees
    WHERE invitation_id = p_invitation_id;
    IF v_count >= v_capacity THEN
      RAISE EXCEPTION 'invitation is full';
    END IF;
  END IF;

  INSERT INTO public.invitation_attendees (invitation_id, user_id, activity_id)
  VALUES (p_invitation_id, v_uid, p_activity_id);
END;
$$;
REVOKE ALL ON FUNCTION public.join_invitation(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.join_invitation(uuid, uuid) TO authenticated;

-- get_available_invitations — every active invitation the caller can see,
-- with host / community names, attendee count, whether the caller is going,
-- and distance from the caller's (optional, per-query) location. 'nearby'
-- invitations are only returned when the caller is within radius_km (or is
-- the host / an attendee / a manager).
DROP FUNCTION IF EXISTS public.get_available_invitations(double precision, double precision);
CREATE OR REPLACE FUNCTION public.get_available_invitations(
  p_lat double precision DEFAULT NULL,
  p_lng double precision DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  host_user_id uuid,
  host_name text,
  host_community_id uuid,
  host_community_name text,
  name text,
  notes text,
  rhythm jsonb,
  start_date date,
  end_date date,
  scheduled_times text[],
  scheduled_end_times text[],
  default_skill_tags text[],
  location_name text,
  latitude double precision,
  longitude double precision,
  audience text,
  audience_community_id uuid,
  audience_community_name text,
  radius_km numeric,
  skill_level text,
  capacity int,
  attendee_count int,
  i_am_going boolean,
  my_activity_id uuid,
  can_manage boolean,
  distance_km double precision,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  WITH base AS (
    SELECT i.*,
      CASE
        WHEN p_lat IS NULL OR p_lng IS NULL OR i.latitude IS NULL OR i.longitude IS NULL
          THEN NULL
        ELSE 6371.0 * 2 * asin(sqrt(
          power(sin(radians(i.latitude - p_lat) / 2), 2)
          + cos(radians(p_lat)) * cos(radians(i.latitude))
            * power(sin(radians(i.longitude - p_lng) / 2), 2)
        ))
      END AS dist,
      public.can_manage_invitation(i.id, auth.uid()) AS mgr,
      a.user_id IS NOT NULL AS going,
      a.activity_id AS my_act
    FROM public.invitations i
    LEFT JOIN public.invitation_attendees a
      ON a.invitation_id = i.id AND a.user_id = auth.uid()
    WHERE i.archived_at IS NULL
      AND auth.uid() IS NOT NULL
      AND public.can_view_invitation(i.id, auth.uid())
      -- Hide fully-past invitations (single past its date / recurring past its end).
      AND COALESCE(i.end_date, CASE WHEN i.rhythm->>'type' = 'single' THEN i.start_date END,
                   'infinity'::date) >= (now() AT TIME ZONE 'utc')::date - 1
  )
  SELECT
    b.id, b.host_user_id,
    COALESCE(p.display_name, p.username) AS host_name,
    b.host_community_id, hc.name AS host_community_name,
    b.name, b.notes, b.rhythm, b.start_date, b.end_date,
    b.scheduled_times, b.scheduled_end_times, b.default_skill_tags,
    b.location_name, b.latitude, b.longitude,
    b.audience, b.audience_community_id, ac.name AS audience_community_name,
    b.radius_km, b.skill_level, b.capacity,
    (SELECT count(*)::int FROM public.invitation_attendees x WHERE x.invitation_id = b.id),
    b.going, b.my_act, b.mgr, b.dist, b.created_at
  FROM base b
  LEFT JOIN public.profiles p ON p.id = b.host_user_id
  LEFT JOIN public.communities hc ON hc.id = b.host_community_id
  LEFT JOIN public.communities ac ON ac.id = b.audience_community_id
  WHERE b.audience <> 'nearby'
     OR b.host_user_id = auth.uid()
     OR b.mgr
     OR b.going
     OR (b.dist IS NOT NULL AND b.dist <= b.radius_km::double precision)
  ORDER BY b.start_date, b.created_at;
$$;
REVOKE ALL ON FUNCTION public.get_available_invitations(double precision, double precision) FROM public;
GRANT EXECUTE ON FUNCTION public.get_available_invitations(double precision, double precision) TO authenticated;

-- get_invitation_attendees — names of attendees, for managers only.
CREATE OR REPLACE FUNCTION public.get_invitation_attendees(p_invitation_id uuid)
RETURNS TABLE (user_id uuid, display_name text, username text, created_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT a.user_id, p.display_name, p.username, a.created_at
  FROM public.invitation_attendees a
  LEFT JOIN public.profiles p ON p.id = a.user_id
  WHERE a.invitation_id = p_invitation_id
    AND public.can_manage_invitation(p_invitation_id, auth.uid())
  ORDER BY a.created_at;
$$;
REVOKE ALL ON FUNCTION public.get_invitation_attendees(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_invitation_attendees(uuid) TO authenticated;

-- get_my_invitation_communities — every community the caller belongs to, with
-- whether they may HOST an invitation for it (can_add_activities).
CREATE OR REPLACE FUNCTION public.get_my_invitation_communities()
RETURNS TABLE (id uuid, name text, kind text, can_host boolean)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT c.id, c.name, c.kind,
         public.has_community_permission(c.id, auth.uid(), 'can_add_activities')
  FROM public.community_members m
  JOIN public.communities c ON c.id = m.community_id
  WHERE m.user_id = auth.uid()
  ORDER BY c.name;
$$;
REVOKE ALL ON FUNCTION public.get_my_invitation_communities() FROM public;
GRANT EXECUTE ON FUNCTION public.get_my_invitation_communities() TO authenticated;

NOTIFY pgrst, 'reload schema';
