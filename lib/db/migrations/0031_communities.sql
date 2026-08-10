-- 0031 — Communities (Groups / Clubs / Guilds).
--
-- One shared `communities` table differentiated by `kind`. Membership,
-- ranks, join requests, activities, and per-user auto-add prefs are
-- all keyed by community_id so shared UI (dropdown, calendar,
-- leadership settings) works across all three types.
--
-- This migration ships the SCHEMA + minimum RLS + the create/join
-- RPCs needed to make Groups/Clubs/Guilds usable end-to-end for the
-- first phase (create, list, view, request-to-join).  Follow-up
-- phases layer on: calendar+auto-add wiring, leadership rank editor,
-- clubs public discovery, guild skill tracks.
--
-- See BACKLOG.md → "Communities (Groups / Clubs / Guilds)" for the
-- full spec.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.communities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('group', 'club', 'guild')),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  -- Optional short handle for "special search" (Groups) or a stable
  -- shareable slug (Clubs / Guilds). Lowercase, alnum + _ / -, 3-32.
  handle text UNIQUE CHECK (
    handle IS NULL OR handle ~ '^[a-z0-9_-]{3,32}$'
  ),
  description text,
  -- Groups are always private (invite / request-only); Clubs and Guilds
  -- can be public. Enforced by a per-kind CHECK below.
  visibility text NOT NULL CHECK (visibility IN ('private', 'public')),
  -- 'open'         = anyone can join instantly
  -- 'application'  = user submits a join request, leadership approves
  -- 'invite'       = leadership must invite (no self-service join)
  join_policy text NOT NULL CHECK (join_policy IN ('open', 'application', 'invite')),
  -- Clubs: what non-members can see. { showMembers, showActivities, ... }
  outsider_visibility jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Groups can never be public and never open-join.
ALTER TABLE public.communities
  DROP CONSTRAINT IF EXISTS communities_group_defaults;
ALTER TABLE public.communities
  ADD CONSTRAINT communities_group_defaults
  CHECK (
    kind <> 'group'
    OR (visibility = 'private' AND join_policy IN ('invite', 'application'))
  );

CREATE INDEX IF NOT EXISTS communities_kind_idx ON public.communities (kind);
CREATE INDEX IF NOT EXISTS communities_created_by_idx ON public.communities (created_by);

-- ---------------------------------------------------------------------------
-- Members
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.community_members (
  community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- MVP roles: 'leader' | 'co_leader' | 'member'. Rank names from
  -- community_ranks slot in later once the rank editor ships.
  role text NOT NULL DEFAULT 'member',
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (community_id, user_id)
);

CREATE INDEX IF NOT EXISTS community_members_user_idx
  ON public.community_members (user_id);

-- ---------------------------------------------------------------------------
-- Ranks (custom leadership permissions — populated when the rank
-- editor ships; the create RPC seeds nothing here for MVP)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.community_ranks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  -- Per-permission bitmap: { can_invite, can_approve_requests,
  -- can_add_activities, can_edit_settings, can_promote, can_kick }
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (community_id, name)
);

CREATE INDEX IF NOT EXISTS community_ranks_community_idx
  ON public.community_ranks (community_id);

-- ---------------------------------------------------------------------------
-- Join requests
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.community_join_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  note text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'declined', 'cancelled')),
  handled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  handled_at timestamptz
);

-- Only one pending request per (community, user) at a time — approving or
-- declining flips status so the partial-unique lets a subsequent request
-- through.
CREATE UNIQUE INDEX IF NOT EXISTS community_join_requests_pending_uniq
  ON public.community_join_requests (community_id, user_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS community_join_requests_community_idx
  ON public.community_join_requests (community_id, status);

-- ---------------------------------------------------------------------------
-- Community activities (activities shared into the community's calendar)
-- + per-member auto-add prefs (silently copy new community activities
-- onto the member's own list)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.community_activities (
  community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  activity_id uuid NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
  added_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (community_id, activity_id)
);

CREATE INDEX IF NOT EXISTS community_activities_activity_idx
  ON public.community_activities (activity_id);

CREATE TABLE IF NOT EXISTS public.community_auto_add_prefs (
  community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  auto_add boolean NOT NULL DEFAULT false,
  PRIMARY KEY (community_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE public.communities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_ranks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_join_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_auto_add_prefs ENABLE ROW LEVEL SECURITY;

-- SECURITY DEFINER helper to sidestep recursive RLS when a policy asks
-- "am I a member of this community?". Marked STABLE so the planner can
-- cache it within a statement.
CREATE OR REPLACE FUNCTION public.is_community_member(
  p_community_id uuid,
  p_user_id uuid
) RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.community_members
    WHERE community_id = p_community_id AND user_id = p_user_id
  );
$$;

REVOKE ALL ON FUNCTION public.is_community_member(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.is_community_member(uuid, uuid) TO authenticated;

-- ---- communities --------------------------------------------------------

DROP POLICY IF EXISTS communities_select ON public.communities;
CREATE POLICY communities_select ON public.communities
  FOR SELECT
  USING (
    visibility = 'public'
    OR public.is_community_member(id, auth.uid())
  );

-- Direct INSERT allowed for the authenticated user IFF they set
-- themselves as created_by. In practice we route creation through the
-- create_community RPC (which also inserts the leader member row);
-- this policy is a defense-in-depth fallback.
DROP POLICY IF EXISTS communities_insert_self ON public.communities;
CREATE POLICY communities_insert_self ON public.communities
  FOR INSERT
  WITH CHECK (created_by = auth.uid());

-- Updates + deletes go through SECURITY DEFINER RPCs (permission-checked).
-- No direct UPDATE/DELETE policy — anon/authenticated can't touch rows.

-- ---- community_members --------------------------------------------------

DROP POLICY IF EXISTS community_members_select ON public.community_members;
CREATE POLICY community_members_select ON public.community_members
  FOR SELECT
  USING (
    public.is_community_member(community_id, auth.uid())
  );

-- No direct INSERT/UPDATE/DELETE — all through RPCs.

-- ---- community_ranks ----------------------------------------------------

DROP POLICY IF EXISTS community_ranks_select ON public.community_ranks;
CREATE POLICY community_ranks_select ON public.community_ranks
  FOR SELECT
  USING (
    public.is_community_member(community_id, auth.uid())
  );

-- ---- community_join_requests --------------------------------------------

DROP POLICY IF EXISTS community_join_requests_select ON public.community_join_requests;
CREATE POLICY community_join_requests_select ON public.community_join_requests
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.is_community_member(community_id, auth.uid())
  );

-- ---- community_activities -----------------------------------------------

DROP POLICY IF EXISTS community_activities_select ON public.community_activities;
CREATE POLICY community_activities_select ON public.community_activities
  FOR SELECT
  USING (
    public.is_community_member(community_id, auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.communities c
      WHERE c.id = community_activities.community_id
        AND c.visibility = 'public'
    )
  );

-- ---- community_auto_add_prefs -------------------------------------------

DROP POLICY IF EXISTS community_auto_add_prefs_select ON public.community_auto_add_prefs;
CREATE POLICY community_auto_add_prefs_select ON public.community_auto_add_prefs
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS community_auto_add_prefs_write ON public.community_auto_add_prefs;
CREATE POLICY community_auto_add_prefs_write ON public.community_auto_add_prefs
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- RPCs (SECURITY DEFINER — bypass RLS + do their own auth checks)
-- ---------------------------------------------------------------------------

-- create_community — insert the row + the creator as leader in one txn.
CREATE OR REPLACE FUNCTION public.create_community(
  p_kind text,
  p_name text,
  p_description text DEFAULT NULL,
  p_handle text DEFAULT NULL,
  p_visibility text DEFAULT 'private',
  p_join_policy text DEFAULT 'invite'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_visibility text := p_visibility;
  v_join_policy text := p_join_policy;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_kind NOT IN ('group', 'club', 'guild') THEN
    RAISE EXCEPTION 'invalid kind: %', p_kind;
  END IF;
  IF p_kind = 'group' THEN
    -- Force private + non-open regardless of what the client sent.
    v_visibility := 'private';
    IF v_join_policy NOT IN ('invite', 'application') THEN
      v_join_policy := 'invite';
    END IF;
  END IF;

  INSERT INTO public.communities (
    kind, name, description, handle, visibility, join_policy, created_by
  ) VALUES (
    p_kind,
    p_name,
    NULLIF(TRIM(p_description), ''),
    NULLIF(TRIM(LOWER(p_handle)), ''),
    v_visibility,
    v_join_policy,
    v_uid
  )
  RETURNING id INTO v_id;

  INSERT INTO public.community_members (community_id, user_id, role)
  VALUES (v_id, v_uid, 'leader');

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_community(text, text, text, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.create_community(text, text, text, text, text, text) TO authenticated;

-- request_join_community — INSERT a pending join request; for 'open'
-- join_policy this immediately admits the user; for 'invite' it errors
-- (you can't request an invite).
CREATE OR REPLACE FUNCTION public.request_join_community(
  p_community_id uuid,
  p_note text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_policy text;
  v_visibility text;
  v_existing_member boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT join_policy, visibility INTO v_policy, v_visibility
  FROM public.communities WHERE id = p_community_id;
  IF v_policy IS NULL THEN
    RAISE EXCEPTION 'community not found';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.community_members
    WHERE community_id = p_community_id AND user_id = v_uid
  ) INTO v_existing_member;
  IF v_existing_member THEN
    RETURN 'already_member';
  END IF;

  IF v_policy = 'invite' THEN
    RAISE EXCEPTION 'this community is invite-only';
  END IF;

  IF v_policy = 'open' THEN
    INSERT INTO public.community_members (community_id, user_id, role)
    VALUES (p_community_id, v_uid, 'member');
    RETURN 'joined';
  END IF;

  -- application flow — INSERT pending request. Idempotent-ish via the
  -- partial-unique on (community_id, user_id, status='pending').
  INSERT INTO public.community_join_requests (community_id, user_id, note)
  VALUES (p_community_id, v_uid, NULLIF(TRIM(p_note), ''))
  ON CONFLICT DO NOTHING;
  RETURN 'requested';
END;
$$;

REVOKE ALL ON FUNCTION public.request_join_community(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.request_join_community(uuid, text) TO authenticated;

-- decide_join_request — leader / co_leader approve or decline.
CREATE OR REPLACE FUNCTION public.decide_join_request(
  p_request_id uuid,
  p_approve boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_community uuid;
  v_user uuid;
  v_status text;
  v_my_role text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT community_id, user_id, status
    INTO v_community, v_user, v_status
  FROM public.community_join_requests WHERE id = p_request_id;
  IF v_community IS NULL THEN
    RAISE EXCEPTION 'request not found';
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'request is not pending';
  END IF;

  SELECT role INTO v_my_role
  FROM public.community_members
  WHERE community_id = v_community AND user_id = v_uid;
  IF v_my_role NOT IN ('leader', 'co_leader') THEN
    RAISE EXCEPTION 'not permitted';
  END IF;

  UPDATE public.community_join_requests
    SET status = CASE WHEN p_approve THEN 'approved' ELSE 'declined' END,
        handled_by = v_uid,
        handled_at = now()
    WHERE id = p_request_id;

  IF p_approve THEN
    INSERT INTO public.community_members (community_id, user_id, role)
    VALUES (v_community, v_user, 'member')
    ON CONFLICT DO NOTHING;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.decide_join_request(uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.decide_join_request(uuid, boolean) TO authenticated;

-- leave_community — DELETE own membership. Blocks the LAST leader from
-- leaving (they'd orphan the community); they must promote someone or
-- delete the community first.
CREATE OR REPLACE FUNCTION public.leave_community(
  p_community_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_leader_count int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT role INTO v_role
  FROM public.community_members
  WHERE community_id = p_community_id AND user_id = v_uid;
  IF v_role IS NULL THEN
    RETURN;  -- not a member; no-op
  END IF;

  IF v_role = 'leader' THEN
    SELECT COUNT(*) INTO v_leader_count
    FROM public.community_members
    WHERE community_id = p_community_id AND role = 'leader';
    IF v_leader_count <= 1 THEN
      RAISE EXCEPTION 'last leader cannot leave — promote a co-leader or delete the community first';
    END IF;
  END IF;

  DELETE FROM public.community_members
  WHERE community_id = p_community_id AND user_id = v_uid;
END;
$$;

REVOKE ALL ON FUNCTION public.leave_community(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.leave_community(uuid) TO authenticated;
