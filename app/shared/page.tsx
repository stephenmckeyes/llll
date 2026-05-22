// ---------------------------------------------------------------------------
// /shared — "Shared with me": every rhythm a friend has shared with you,
// read-only, with a "Copy to my schedule" action on each. You can view and
// copy, but never edit the owner's activity (enforced by RLS + the
// get_shared_with_me SECURITY DEFINER RPC, which only ever returns rows
// shared WITH you).
//
// Inline display of shared rhythms inside your own calendar/grid views is a
// deliberate follow-up; this page is the standalone browse + copy surface.
// ---------------------------------------------------------------------------

import { getSharedWithMe } from "@/app/actions/sharing";
import { requireOnboardedUser } from "@/lib/auth/require-onboarded-user";
import { buildTagMap, computeTagUsage } from "@/lib/domain/tags";

import { PendingLink } from "@/app/_components/pending-link";

import { SharedList } from "./shared-list";

export default async function SharedPage() {
  const { supabase } = await requireOnboardedUser();

  // Tag palette for the copy form's TagPicker (mirrors /activities/new).
  const [shared, { data: tagRows }, { data: activityTagRows }] =
    await Promise.all([
      getSharedWithMe(),
      supabase.from("tags").select("id, name, color"),
      supabase
        .from("activities")
        .select("default_skill_tags")
        .is("archived_at", null),
    ]);

  const usageByName = computeTagUsage(
    (activityTagRows ?? []) as Array<{ default_skill_tags: string[] | null }>
  );
  const tagMap = buildTagMap(
    (tagRows ?? []) as Array<{ id: string; name: string; color: string }>,
    usageByName
  );

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-2xl flex-col gap-8 bg-white p-6 dark:bg-zinc-950">
      <header className="flex flex-col gap-1">
        <PendingLink
          href="/friends"
          className="inline-flex items-center text-sm text-zinc-500 underline-offset-2 hover:underline"
        >
          ← Friends
        </PendingLink>
        <h1 className="text-3xl font-semibold tracking-tight">
          Shared with me
        </h1>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Rhythms from friends ({shared.length})
        </h2>
        {shared.length === 0 ? (
          <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
            Nothing shared with you yet. When a friend shares a rhythm, it
            shows up here for you to copy.
          </p>
        ) : (
          <SharedList shared={shared} tagMap={tagMap} />
        )}
      </section>
    </main>
  );
}
