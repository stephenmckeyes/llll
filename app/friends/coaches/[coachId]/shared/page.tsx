// ---------------------------------------------------------------------------
// /friends/coaches/[coachId]/shared — read-only view of the activities the
// OTHER party shared with the viewer, within a coaching relationship (migration
// 0076). Used by a coach to review a client's shared routines. [coachId] is the
// other participant's id. Reuses the shared read-only FriendCalendar.
// ---------------------------------------------------------------------------

import { redirect } from "next/navigation";

import { getCoachingCounterparty, getSharedByUser } from "@/app/actions/coaches";
import { requireOnboardedUser } from "@/lib/auth/require-onboarded-user";

import { PendingLink } from "@/app/_components/pending-link";
import { PublicCalendarView } from "@/app/c/[id]/public-calendar-view";

function ymdOffset(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default async function CoachSharedPage({
  params,
}: {
  params: Promise<{ coachId: string }>;
}) {
  const { coachId } = await params;
  await requireOnboardedUser();

  const party = await getCoachingCounterparty(coachId);
  if (!party) redirect("/friends/coaches");

  const todayStr = new Date().toISOString().slice(0, 10);
  const { activities, instances } = await getSharedByUser(
    coachId,
    ymdOffset(-35),
    ymdOffset(400)
  );

  return (
    <main className="mx-auto flex h-full w-full max-w-2xl flex-col bg-white p-4 dark:bg-zinc-950">
      <header className="flex shrink-0 flex-col gap-1 border-b border-zinc-200 pb-3 dark:border-zinc-800">
        <PendingLink
          href="/friends/coaches"
          className="inline-flex items-center text-sm text-zinc-500 underline-offset-2 hover:underline"
        >
          ← Coaches
        </PendingLink>
        <h1 className="text-xl font-semibold tracking-tight">
          {party.name}
          <span className="ml-2 align-middle text-xs font-normal text-zinc-500">
            shared activities
          </span>
        </h1>
      </header>

      {activities.length === 0 ? (
        <p className="mt-6 rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
          {party.name} hasn’t shared any activities with you yet.
        </p>
      ) : (
        <div className="min-h-0 flex-1">
          <PublicCalendarView
            shares={activities}
            instances={instances}
            todayStr={todayStr}
          />
        </div>
      )}
    </main>
  );
}
