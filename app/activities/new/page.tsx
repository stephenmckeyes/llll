// ---------------------------------------------------------------------------
// /activities/new — add a new activity (the unified producer for what
// used to be habits AND tasks).
// ---------------------------------------------------------------------------

import Link from "next/link";

import { requireOnboardedUser } from "@/lib/auth/require-onboarded-user";
import { buildTagMap, computeTagUsage } from "@/lib/domain/tags";

import { ActivityForm } from "./activity-form";

export default async function NewActivityPage() {
  // requireOnboardedUser handles both the unauthed → /login bounce and
  // the not-yet-onboarded → /onboarding bounce in one call.
  const { supabase } = await requireOnboardedUser();

  // Fetch the user's tag palette + per-tag usage counts so the picker
  // can render existing tags inline AND sort the "Most frequent" list
  // by popularity. Usage counts cover active (non-archived) activities
  // only.
  const [{ data: tagRows }, { data: activityTagRows }] = await Promise.all([
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
    <main className="mx-auto flex min-h-svh w-full max-w-xl flex-col gap-6 p-6">
      <header className="space-y-1">
        <Link
          href="/"
          className="text-sm text-zinc-500 underline-offset-2 hover:underline"
        >
          ← Mission
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Add Activity</h1>
      </header>

      <ActivityForm initialTagMap={tagMap} />
    </main>
  );
}
