// ---------------------------------------------------------------------------
// /settings — central place for everything that isn't day-to-day activity
// management. Replaces the "Sign out" button in the main header. Sections:
//
//   1. Account         — email (read-only). Future: display name, password
//                        change, email change.
//   2. Appearance      — theme picker (system / light / dark / sleep).
//                        Sleep mode = dark + warm filter for evenings.
//   3. Data            — export everything as JSON for AI trend analysis +
//                        a paste-ready AI prompt template.
//   4. Sign out        — at the very bottom per user spec, so it's not the
//                        first thing the user sees.
//
// Server component (auth check + email lookup). All interactive bits
// live in their own client components.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { redirect } from "next/navigation";

import { signOut } from "@/app/actions/auth";
import { createClient } from "@/lib/supabase/server";

import { ExportButton } from "./export-button";
import { ThemeToggle } from "./theme-toggle";

// The prompt the user can paste into an AI alongside their downloaded
// JSON. Kept here so it's discoverable + editable in one place.
const AI_PROMPT_TEMPLATE = `Below is my Mission productivity export. Please:

1. Identify the days of the week or times of day when I most often skip activities.
2. Find pairs of activities that seem to interfere with each other (correlated misses).
3. Read the notes on completion rows for common blockers or themes.
4. Surface 3-5 trends I might not see myself, with the data that supports each.

Export follows.`;

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-2xl flex-col gap-8 bg-white p-6 dark:bg-zinc-950">
      <header>
        <Link
          href="/"
          className="text-sm text-zinc-500 underline-offset-2 hover:underline"
        >
          ← Mission
        </Link>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Settings
        </h1>
      </header>

      {/* ----------------------------- Account ----------------------------- */}
      <Section title="Account">
        <Row label="Email">
          <span className="text-sm">{user.email}</span>
        </Row>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Display name, password, and email-change controls land in a
          future update. If you need to change your email today, contact
          support.
        </p>
      </Section>

      {/* ----------------------------- Appearance -------------------------- */}
      <Section title="Appearance">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Theme controls how Mission looks. Sleep mode dims the screen
          and shifts colors warm to minimize blue light before bed.
        </p>
        <ThemeToggle />
      </Section>

      {/* ----------------------------- Data -------------------------------- */}
      <Section title="Data">
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
      </Section>

      {/* ----------------------------- Sign out ---------------------------- */}
      {/* At the very bottom per user spec. Single page-level form so the
          signOut action posts cleanly. */}
      <Section title="Session">
        <form action={signOut}>
          <button
            type="submit"
            className="rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:bg-zinc-950 dark:text-red-400 dark:hover:bg-red-950"
          >
            Sign out
          </button>
        </form>
      </Section>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <dt className="w-24 shrink-0 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 break-words">{children}</dd>
    </div>
  );
}
