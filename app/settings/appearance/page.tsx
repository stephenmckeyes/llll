// ---------------------------------------------------------------------------
// /settings/appearance — theme picker (System / Light / Dark / Sleep).
//
// Sleep mode = dark base + a warm, low-blue filter via globals.css.
// All persistence is client-side (localStorage) per the ThemeToggle
// implementation — no profile column needed.
// ---------------------------------------------------------------------------

import { SettingsShell } from "../_settings-shell";
import { requireOnboardedUser } from "@/lib/auth/require-onboarded-user";

import { ThemeToggle } from "../theme-toggle";

export default async function AppearanceSettingsPage() {
  await requireOnboardedUser();

  return (
    <SettingsShell title="Appearance">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Theme controls how Mission looks. Sleep mode dims the screen and
        shifts colors warm to minimize blue light before bed.
      </p>
      <ThemeToggle />
    </SettingsShell>
  );
}
