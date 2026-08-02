// ---------------------------------------------------------------------------
// /settings/appearance — theme picker (System / Light / Dark / Sleep).
//
// Sleep mode = dark base + a warm, low-blue filter via globals.css.
// All persistence is client-side (localStorage) per the ThemeToggle
// implementation — no profile column needed.
// ---------------------------------------------------------------------------

import { SettingsShell } from "../_settings-shell";
import { requireOnboardedUser } from "@/lib/auth/require-onboarded-user";

import {
  isAddActivityDensity,
  type AddActivityDensity,
} from "@/lib/domain/add-activity-density";
import { isTimeFormat, type TimeFormat } from "@/lib/ui/format-time";
import { AddActivityDensityPicker } from "./add-activity-density-picker";
import { CalendarSync } from "./calendar-sync";
import { TimeFormatPicker } from "./time-format-picker";
import { ThemeToggle } from "../theme-toggle";

export default async function AppearanceSettingsPage() {
  const { supabase, user } = await requireOnboardedUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("add_activity_density, time_format, ics_token")
    .eq("id", user.id)
    .maybeSingle();
  const rawDensity =
    (profile as { add_activity_density?: string } | null)?.add_activity_density ??
    "default";
  const initialDensity: AddActivityDensity = isAddActivityDensity(rawDensity)
    ? rawDensity
    : "default";
  const rawFormat =
    (profile as { time_format?: string } | null)?.time_format ?? "auto";
  const initialFormat: TimeFormat = isTimeFormat(rawFormat)
    ? rawFormat
    : "auto";
  const initialIcsToken =
    (profile as { ics_token?: string | null } | null)?.ics_token ?? null;

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

      <hr className="my-2 border-zinc-200 dark:border-zinc-800" />

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Time format</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Controls how scheduled times render everywhere — day list,
          activity modal, week/month banners.
        </p>
        <TimeFormatPicker initialFormat={initialFormat} />
      </div>

      <hr className="my-2 border-zinc-200 dark:border-zinc-800" />

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Calendar sync</h2>
        <CalendarSync initialToken={initialIcsToken} />
      </div>

      <hr className="my-2 border-zinc-200 dark:border-zinc-800" />

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Add Activity form</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Choose how tightly the Add Activity form packs its fields.
          Same options either way — Compact minimizes scrolling on
          phones, Expanded gives more breathing room on desktop.
        </p>
        <AddActivityDensityPicker initialDensity={initialDensity} />
      </div>
    </SettingsShell>
  );
}
