// ---------------------------------------------------------------------------
// /activities/new — add a new activity (the unified producer for what
// used to be habits AND tasks).
// ---------------------------------------------------------------------------

import Link from "next/link";

import { requireOnboardedUser } from "@/lib/auth/require-onboarded-user";
import {
  isAddActivityDensity,
  type AddActivityDensity,
} from "@/lib/domain/add-activity-density";
import { buildTagMap, computeTagUsage } from "@/lib/domain/tags";

import { ActivityForm } from "./activity-form";

export default async function NewActivityPage() {
  // requireOnboardedUser handles both the unauthed → /login bounce and
  // the not-yet-onboarded → /onboarding bounce in one call.
  const { supabase, user } = await requireOnboardedUser();

  // Fetch the user's tag palette + per-tag usage counts + density.
  // usageByName sorts the tag picker's "Most frequent" list by
  // popularity; density comes from the profile column added in
  // migration 0023 (defaults to 'default' for anything unrecognized).
  const [{ data: tagRows }, { data: activityTagRows }, { data: profile }] =
    await Promise.all([
      supabase.from("tags").select("id, name, color").is("archived_at", null),
      supabase
        .from("activities")
        .select("default_skill_tags")
        .is("archived_at", null),
      supabase
        .from("profiles")
        .select("add_activity_density")
        .eq("id", user.id)
        .maybeSingle(),
    ]);
  const usageByName = computeTagUsage(
    (activityTagRows ?? []) as Array<{ default_skill_tags: string[] | null }>
  );
  const tagMap = buildTagMap(
    (tagRows ?? []) as Array<{ id: string; name: string; color: string }>,
    usageByName
  );
  const rawDensity =
    (profile as { add_activity_density?: string } | null)?.add_activity_density ??
    "default";
  const density: AddActivityDensity = isAddActivityDensity(rawDensity)
    ? rawDensity
    : "compact";

  return (
    <main className="mx-auto flex h-full w-full max-w-xl flex-col gap-6 overflow-y-auto p-6">
      <header className="space-y-1">
        <Link
          href="/"
          className="text-sm text-zinc-500 underline-offset-2 hover:underline"
        >
          ← Mission
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Add Activity</h1>
      </header>

      <ActivityForm initialTagMap={tagMap} density={density} />
    </main>
  );
}
