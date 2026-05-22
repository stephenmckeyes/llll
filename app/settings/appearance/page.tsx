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

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        <strong>Battery:</strong> on phones with OLED screens (most recent
        iPhones and Android flagships) dark and sleep modes draw less
        power — roughly 5–15% less at typical brightness, and up to ~40%
        at high brightness, since black pixels are switched off. On LCD
        screens it makes no meaningful difference.
      </p>
    </SettingsShell>
  );
}
