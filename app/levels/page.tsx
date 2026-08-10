// ---------------------------------------------------------------------------
// /levels — placeholder for the "Levels" bottom-nav slot. Skill aggregation
// (see BACKLOG.md → "Skill aggregation") is what fills this in later.
// ---------------------------------------------------------------------------

import { PendingLink } from "@/app/_components/pending-link";
import { requireOnboardedUser } from "@/lib/auth/require-onboarded-user";

export default async function LevelsPage() {
  await requireOnboardedUser();
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-2xl flex-col gap-8 bg-white p-6 dark:bg-zinc-950">
      <header>
        <PendingLink
          href="/"
          className="inline-flex items-center text-sm text-zinc-500 underline-offset-2 hover:underline"
        >
          ← Mission
        </PendingLink>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Levels</h1>
      </header>
      <div className="rounded-md border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
        <p className="font-medium text-zinc-700 dark:text-zinc-300">
          Levels are coming soon.
        </p>
        <p className="mt-2">
          This will surface your progression across skills — the tags you
          use most often, promoted into ranked areas of practice.
        </p>
      </div>
    </main>
  );
}
