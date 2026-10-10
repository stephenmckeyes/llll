// ---------------------------------------------------------------------------
// /c/[id] — PUBLIC, logged-out read-only calendar for a community that has
// opted into public sharing (migration 0067). No auth required; the data
// comes from the anon-safe get_public_community_calendar RPC, which returns
// null unless the community is public + public_calendar=true → 404.
// ---------------------------------------------------------------------------

import { notFound } from "next/navigation";

import { getPublicCommunityCalendar } from "@/app/actions/communities";
import { KIND_LABEL } from "@/lib/domain/community";

import { PublicCalendarView } from "./public-calendar-view";

export default async function PublicCommunityCalendarPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getPublicCommunityCalendar(id);
  if (!data) notFound();

  const { community } = data;
  const kindLabel = KIND_LABEL[community.kind]?.one ?? "community";

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-2xl flex-col gap-4 bg-white px-6 py-8 dark:bg-zinc-950">
      <header className="flex flex-col gap-1">
        <p className="text-xs uppercase tracking-wide text-zinc-500">
          {kindLabel} calendar
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {community.name}
        </h1>
        {community.description && (
          <p className="whitespace-pre-wrap text-sm text-zinc-600 dark:text-zinc-400">
            {community.description}
          </p>
        )}
      </header>

      <PublicCalendarView
        shares={data.activities}
        instances={data.instances}
        todayStr={data.todayStr}
      />

      <footer className="mt-4 border-t border-zinc-200 pt-4 text-center text-xs text-zinc-400 dark:border-zinc-800">
        Shared read-only via Mission.
      </footer>
    </main>
  );
}
