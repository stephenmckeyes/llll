// ---------------------------------------------------------------------------
// /settings/feedback — report a bug or suggest an improvement. Submissions
// are emailed to the developer; the recipient address is never shown.
// ---------------------------------------------------------------------------

import { requireOnboardedUser } from "@/lib/auth/require-onboarded-user";

import { SettingsShell } from "../_settings-shell";
import { FeedbackForm } from "./feedback-form";

export default async function FeedbackSettingsPage() {
  await requireOnboardedUser();

  return (
    <SettingsShell title="Feedback">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Found a bug or have an idea to make Mission better? Send it straight to
        the team. We read everything.
      </p>
      <FeedbackForm />
    </SettingsShell>
  );
}
