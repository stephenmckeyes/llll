// ---------------------------------------------------------------------------
// /settings/account — account-level controls.
//
//   - Display name (editable, optional)
//   - Email change (kicks off Supabase email-confirmation flow)
//   - Password change
//
// 2FA enrollment lives in BACKLOG — Supabase exposes MFA APIs
// (supabase.auth.mfa.enroll/{challenge,verify}) but it needs its own
// dedicated UI + recovery-code flow. Not in this turn.
// ---------------------------------------------------------------------------

import { SettingsShell } from "../_settings-shell";
import { requireOnboardedUser } from "@/lib/auth/require-onboarded-user";

import { AccountForms } from "./account-forms";

export default async function AccountSettingsPage() {
  const { user, profile } = await requireOnboardedUser();

  return (
    <SettingsShell title="Account">
      <AccountForms
        currentEmail={user.email ?? ""}
        currentDisplayName={profile.display_name ?? ""}
      />
    </SettingsShell>
  );
}
