// ---------------------------------------------------------------------------
// /settings/data — export the user's history as JSON for AI analysis.
//
// Same content the original /settings page hosted under its Data
// section. Now lives on its own focused page so the Settings index can
// stay as a chooser.
// ---------------------------------------------------------------------------

import { SettingsShell } from "../_settings-shell";
import { requireOnboardedUser } from "@/lib/auth/require-onboarded-user";

import { ExportButton } from "../export-button";

const AI_PROMPT_TEMPLATE = `Below is my Mission productivity export. Please:

1. Identify the days of the week or times of day when I most often skip activities.
2. Find pairs of activities that seem to interfere with each other (correlated misses).
3. Read the notes on completion rows for common blockers or themes.
4. Surface 3-5 trends I might not see myself, with the data that supports each.

Export follows.`;

export default async function DataSettingsPage() {
  await requireOnboardedUser();

  return (
    <SettingsShell title="Data">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Download every activity, instance, and completion in your
        account as a JSON file. Useful for analyzing your patterns in
        an AI — paste the file alongside the prompt below.
      </p>

      <ExportButton />

      <details className="rounded-md border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
          Paste-ready AI prompt
        </summary>
        <pre className="overflow-x-auto whitespace-pre-wrap break-words border-t border-zinc-200 p-3 text-xs text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">
          {AI_PROMPT_TEMPLATE}
        </pre>
      </details>
    </SettingsShell>
  );
}
