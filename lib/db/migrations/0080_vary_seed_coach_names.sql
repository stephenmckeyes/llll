-- ---------------------------------------------------------------------------
-- 0080 — Vary the seed coaches' names.
--
-- 0078 paired first/last names in lockstep (both arrays length 20, indexed the
-- same way), so the directory showed repeats like three "Alex Rivera". This
-- re-derives the display name so the last-name index also advances with each
-- 20-block, giving distinct full names across all 50 seed coaches. Only touches
-- the seed rows (username LIKE 'seedcoach%').
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  first_names text[] := ARRAY[
    'Alex','Jordan','Sam','Taylor','Morgan','Casey','Riley','Jamie','Avery','Quinn',
    'Drew','Reese','Skyler','Cameron','Devon','Harper','Rowan','Emerson','Parker','Sage'];
  last_names text[] := ARRAY[
    'Rivera','Chen','Patel','Nguyen','Kim','Johnson','Garcia','Okafor','Haddad','Larsen',
    'Silva','Mori','Novak','Flores','Abbott','Reyes','Walsh','Osei','Petrov','Yamamoto'];
  n int;
  fi int;
  li int;
BEGIN
  FOR n IN 1..50 LOOP
    fi := ((n - 1) % 20) + 1;
    -- Advance the last-name index by the 20-block too, so n and n+20 differ.
    li := (((n - 1) + ((n - 1) / 20)) % 20) + 1;
    UPDATE public.profiles
    SET display_name = first_names[fi] || ' ' || last_names[li]
    WHERE username = 'seedcoach' || n;
  END LOOP;
END $$;
