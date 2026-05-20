// ---------------------------------------------------------------------------
// completeOnboarding — server action called by /onboarding's form.
//
// Writes timezone + optional display_name to the user's profile and
// flips onboarded_at to now(). After this returns, every protected
// page's requireOnboardedUser guard will pass and the user can use
// the app normally.
//
// Why upsert and not just update: the handle_new_auth_user trigger
// (migration 0001) creates the profile row on signup, but for safety
// against eventual-consistency lag we upsert here. ON CONFLICT DO
// UPDATE keeps any existing data the user might have already had.
// ---------------------------------------------------------------------------

"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

// Use a permissive validator on the timezone string. Supabase doesn't
// have a built-in TZ-name check, and we don't want to maintain a frozen
// allowlist; the worst case if the user pastes garbage is that date
// math falls back to UTC, which is the existing default.
const TZ_NAME_RE = /^[A-Za-z][A-Za-z0-9_+\-/]{0,99}$/;

export type OnboardingState = { error: string } | { ok: true } | null;

export async function completeOnboarding(
  _prev: OnboardingState,
  formData: FormData
): Promise<OnboardingState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const tzRaw = String(formData.get("timezone") ?? "").trim();
  const displayNameRaw = String(formData.get("displayName") ?? "").trim();

  if (!tzRaw || !TZ_NAME_RE.test(tzRaw)) {
    return { error: "Please pick a valid timezone." };
  }

  const displayName = displayNameRaw.length === 0 ? null : displayNameRaw;
  if (displayName && displayName.length > 80) {
    return { error: "Display name is too long (max 80)." };
  }

  // Upsert (rather than UPDATE) defends against the rare race where
  // requireOnboardedUser ran before the auth trigger created the row.
  const { error } = await supabase.from("profiles").upsert({
    id: user.id,
    timezone: tzRaw,
    display_name: displayName,
    onboarded_at: new Date().toISOString(),
  });

  if (error) {
    return { error: error.message };
  }

  // Done — bounce to the app. The next page-load's
  // requireOnboardedUser will see onboarded_at and let the user
  // through without redirecting again.
  redirect("/");
}
