-- ===========================================================================
-- 0010_social_friends.sql — friends layer (identities + friendships).
--
-- Foundation for the social features. This migration is deliberately
-- scoped to friends + lookups; activity SHARING ships in a later
-- migration that builds on the friendships defined here.
--
-- Safe to re-run: every statement guards with IF [NOT] EXISTS / OR
-- REPLACE / DROP-then-CREATE.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Identity fields on profiles.
--    - username: optional, unique, user-chosen handle for friend lookup.
--    - email:    denormalized from auth.users so friend lookup can match
--                an exact email WITHOUT exposing auth.users to clients.
--                Kept in sync by the signup trigger below.
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username text,
  ADD COLUMN IF NOT EXISTS email    text;

-- Case-insensitive uniqueness for usernames (NULLs allowed = multiple
-- users without a handle yet). Unique on lower(username).
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower_idx
  ON public.profiles (lower(username))
  WHERE username IS NOT NULL;

-- Backfill emails for existing profiles from auth.users (admin context).
UPDATE public.profiles AS p
SET    email = u.email
FROM   auth.users AS u
WHERE  u.id = p.id
  AND  p.email IS DISTINCT FROM u.email;

-- ---------------------------------------------------------------------------
-- 2. Keep profile email in sync on signup. Extends the existing
--    handle_new_auth_user trigger to copy the new user's email.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, timezone, email, created_at)
  VALUES (NEW.id, 'UTC', NEW.email, NOW())
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Controlled friend lookup. SECURITY DEFINER so it can match an exact
--    username/email across ALL profiles (RLS otherwise restricts a user
--    to their own row). Returns ONLY minimal public fields, only on an
--    EXACT (case-insensitive) match, and never the caller themselves —
--    so it can't be used to enumerate or fuzzy-scrape the user base.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.find_user_by_handle(handle text)
RETURNS TABLE (id uuid, username text, display_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.username, p.display_name
  FROM public.profiles p
  WHERE p.id <> auth.uid()
    AND (
      lower(p.username) = lower(trim(handle))
      OR lower(p.email) = lower(trim(handle))
    )
  LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- 4. Friendships. One row per (requester, addressee) ordered pair.
--    status: pending → accepted | declined. A friendship is "active"
--    when status = 'accepted' (regardless of who requested).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.friendships (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  addressee_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  responded_at  timestamptz,
  CONSTRAINT friendships_distinct CHECK (requester_id <> addressee_id),
  CONSTRAINT friendships_pair_unique UNIQUE (requester_id, addressee_id)
);

CREATE INDEX IF NOT EXISTS friendships_addressee_idx
  ON public.friendships (addressee_id, status);
CREATE INDEX IF NOT EXISTS friendships_requester_idx
  ON public.friendships (requester_id, status);

ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;

-- See rows you're part of (either side).
DROP POLICY IF EXISTS friendships_self_select ON public.friendships;
CREATE POLICY friendships_self_select ON public.friendships
  FOR SELECT USING (
    auth.uid() = requester_id OR auth.uid() = addressee_id
  );

-- Send a request: you must be the requester.
DROP POLICY IF EXISTS friendships_self_insert ON public.friendships;
CREATE POLICY friendships_self_insert ON public.friendships
  FOR INSERT WITH CHECK (auth.uid() = requester_id);

-- Respond (accept/decline): only the addressee can change a request.
DROP POLICY IF EXISTS friendships_addressee_update ON public.friendships;
CREATE POLICY friendships_addressee_update ON public.friendships
  FOR UPDATE USING (auth.uid() = addressee_id);

-- Cancel a sent request OR unfriend: either party can delete the row.
DROP POLICY IF EXISTS friendships_self_delete ON public.friendships;
CREATE POLICY friendships_self_delete ON public.friendships
  FOR DELETE USING (
    auth.uid() = requester_id OR auth.uid() = addressee_id
  );

-- ---------------------------------------------------------------------------
-- 5. social_overview() — the caller's friendships joined to the OTHER
--    party's SAFE profile fields (id / username / display_name only —
--    never email). SECURITY DEFINER so it can read the counterpart's
--    profile row, but it returns nothing sensitive and only for people
--    you actually have a friendship/request with. Powers both the
--    Friends page and the Notifications page.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.social_overview()
RETURNS TABLE (
  friendship_id      uuid,
  other_id           uuid,
  other_username     text,
  other_display_name text,
  status             text,
  direction          text,
  created_at         timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    f.id,
    CASE WHEN f.requester_id = auth.uid()
         THEN f.addressee_id ELSE f.requester_id END,
    p.username,
    p.display_name,
    f.status,
    CASE WHEN f.requester_id = auth.uid()
         THEN 'outgoing' ELSE 'incoming' END,
    f.created_at
  FROM public.friendships f
  JOIN public.profiles p
    ON p.id = CASE WHEN f.requester_id = auth.uid()
                   THEN f.addressee_id ELSE f.requester_id END
  WHERE f.requester_id = auth.uid() OR f.addressee_id = auth.uid()
  ORDER BY f.created_at DESC;
$$;
