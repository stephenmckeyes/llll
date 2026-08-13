-- ---------------------------------------------------------------------------
-- 0052 — One-time backfill: give every existing user a username.
--
-- Onboarding now requires a username (so anyone can be invited to a community
-- by handle), but users who onboarded before that change may have none. Per
-- product call: for those users, derive a username from their display name.
--
-- Sanitization: keep [A-Za-z0-9_.], turn whitespace runs into "_", drop
-- anything else, clamp to 30 chars, pad short results to the 3-char minimum.
-- If a user has no usable display name, fall back to "user_<id-prefix>".
-- Collisions (case-insensitive, matching how invite lookups resolve) get a
-- numeric suffix.
--
-- One-shot DML — safe to re-run: it only touches rows still missing a
-- username. Function-less; apply manually.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  r RECORD;
  base text;
  candidate text;
  n int;
BEGIN
  FOR r IN
    SELECT id, display_name
    FROM public.profiles
    WHERE username IS NULL OR btrim(username) = ''
  LOOP
    -- whitespace -> underscore, then strip disallowed chars, then clamp.
    base := regexp_replace(COALESCE(r.display_name, ''), '\s+', '_', 'g');
    base := regexp_replace(base, '[^A-Za-z0-9_.]', '', 'g');
    base := left(base, 30);

    IF length(base) = 0 THEN
      base := 'user_' || substring(replace(r.id::text, '-', '') from 1 for 8);
    ELSIF length(base) < 3 THEN
      base := rpad(base, 3, '0');
    END IF;

    -- Find a free handle, case-insensitively.
    candidate := base;
    n := 1;
    WHILE EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE lower(p.username) = lower(candidate) AND p.id <> r.id
    ) LOOP
      candidate := left(base, 26) || '_' || n::text;
      n := n + 1;
    END LOOP;

    UPDATE public.profiles SET username = candidate WHERE id = r.id;
  END LOOP;
END $$;
