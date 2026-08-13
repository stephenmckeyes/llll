// ---------------------------------------------------------------------------
// /adventures — placeholder for the "Adventures" bottom-nav slot. What this
// eventually becomes is TBD; leaving the route in place so the nav has a
// live destination.
// ---------------------------------------------------------------------------

import { NotificationBell } from "@/app/_components/notification-bell";
import { PendingLink } from "@/app/_components/pending-link";
import { requireOnboardedUser } from "@/lib/auth/require-onboarded-user";

export default async function AdventuresPage() {
  await requireOnboardedUser();
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-2xl flex-col gap-8 bg-white p-6 dark:bg-zinc-950">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <PendingLink
            href="/"
            className="inline-flex items-center text-sm text-zinc-500 underline-offset-2 hover:underline"
          >
            ← Mission
          </PendingLink>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            Adventures
          </h1>
        </div>
        <NotificationBell />
      </header>
      <div className="rounded-md border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
        <p className="font-medium text-zinc-700 dark:text-zinc-300">
          Adventures are coming soon.
        </p>
        <p className="mt-2">
          The plan is a bigger-scope companion to Schedule — longer-arc
          quests and milestones built on top of your daily rhythms.
        </p>
      </div>
    </main>
  );
}
