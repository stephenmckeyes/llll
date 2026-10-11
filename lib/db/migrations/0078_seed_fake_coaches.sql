-- ---------------------------------------------------------------------------
-- 0078 — Seed ~50 FAKE verified coaches to populate the Find-a-Coach directory
-- for testing. These are display-only profiles (no auth.users rows — profiles.id
-- has no FK to auth.users), so you can browse them but not actually sign in as
-- them. Messaging/engaging a fake coach will fail at the messages FK (expected).
--
-- DELETE LATER with:
--   DELETE FROM public.profiles WHERE username LIKE 'seedcoach%';
--   (cascades to coach_profiles via ON DELETE CASCADE)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  first_names text[] := ARRAY[
    'Alex','Jordan','Sam','Taylor','Morgan','Casey','Riley','Jamie','Avery','Quinn',
    'Drew','Reese','Skyler','Cameron','Devon','Harper','Rowan','Emerson','Parker','Sage'];
  last_names text[] := ARRAY[
    'Rivera','Chen','Patel','Nguyen','Kim','Johnson','Garcia','Okafor','Haddad','Larsen',
    'Silva','Mori','Novak','Flores','Abbott','Reyes','Walsh','Osei','Petrov','Yamamoto'];
  specialties text[] := ARRAY[
    'strength training','distance running','yoga & mobility','nutrition','habit building',
    'sleep & recovery','mindfulness','weight loss','marathon prep','functional fitness'];
  n int;
  uid uuid;
  fn text; ln text; sp text;
  price numeric; unit text;
BEGIN
  FOR n IN 1..50 LOOP
    uid := gen_random_uuid();
    fn := first_names[((n - 1) % array_length(first_names, 1)) + 1];
    ln := last_names[((n - 1) % array_length(last_names, 1)) + 1];
    sp := specialties[((n - 1) % array_length(specialties, 1)) + 1];
    price := 20 + ((n * 7) % 16) * 10;          -- 20..170
    unit := CASE WHEN n % 2 = 0 THEN 'week' ELSE 'day' END;

    INSERT INTO public.profiles (id, timezone, display_name, username, email, onboarded_at, created_at)
    VALUES (
      uid, 'UTC', fn || ' ' || ln, 'seedcoach' || n,
      'coach' || n || '@seed.coach.local', now(), now()
    )
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.coach_profiles (
      user_id, bio, photo_url, price_amount, price_unit, status,
      applied_at, reviewed_at, updated_at
    )
    VALUES (
      uid,
      'Certified ' || sp || ' coach. I help clients set realistic goals and build routines that stick.',
      'https://i.pravatar.cc/150?u=seedcoach' || n,
      price, unit, 'verified', now(), now(), now()
    )
    ON CONFLICT (user_id) DO NOTHING;
  END LOOP;
END $$;
