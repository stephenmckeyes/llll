// ---------------------------------------------------------------------------
// /settings/timezone — change the profile timezone.
//
// Same shape as the onboarding form but pre-fills with the user's
// currently-stored value (instead of forcing browser-detection). Saving
// hits updateProfile.
// ---------------------------------------------------------------------------

import { SettingsShell } from "../_settings-shell";
import { requireOnboardedUser } from "@/lib/auth/require-onboarded-user";

import { TimezoneForm } from "./timezone-form";

export default async function TimezoneSettingsPage() {
  const { profile } = await requireOnboardedUser();

  return (
    <SettingsShell title="Timezone">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Used to anchor your day. If you travel often, set this to where
        you actually live — Mission won&rsquo;t auto-update based on the
        device.
      </p>
      <TimezoneForm initialTimezone={profile.timezone ?? "UTC"} />
    </SettingsShell>
  );
}
