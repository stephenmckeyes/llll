// ---------------------------------------------------------------------------
// requireOnboardedUser — auth + onboarding guard used by every protected
// page (`/`, `/activities`, `/settings`).
//
// Behavior:
//   1. No session         → redirect to /login
//   2. No profile.onboarded_at → redirect to /onboarding
//   3. Otherwise          → return { user, profile }
//
// We don't put this in middleware. Edge-runtime middleware can't easily
// query Supabase via the JS SDK (cookie sync is brittle), and a per-page
// guard keeps the auth/onboarding logic next to the data fetch it
// already does. Adds one small `profiles` lookup per protected page —
// the row is tiny and the user almost always has it cached by Supabase's
// session cache after the first hit.
// ---------------------------------------------------------------------------

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export async function requireOnboardedUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone, display_name, onboarded_at")
    .eq("id", user.id)
    .maybeSingle();

  // Profile creation is automatic via the handle_new_auth_user trigger
  // (migration 0001). If we don't see a row, treat it as not-yet-
  // onboarded — sending the user to the onboarding screen creates the
  // row implicitly via the upsert there. We DON'T crash on a missing
  // profile because Supabase's eventual consistency on the auth-user
  // trigger can lag by a tick on first signup.
  if (!profile || !profile.onboarded_at) {
    redirect("/onboarding");
  }

  return { supabase, user, profile };
}
