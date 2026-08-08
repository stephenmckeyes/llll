// ---------------------------------------------------------------------------
// /activities — "Total View": every activity (active + archived) in one
// place. The old top-right "Archive" button now lives as a third section
// tab here, in line with Calendar / Grid (see SectionTabs).
//
// The body is a client component (TotalView) that groups the list by
// Status / Tag / Rhythm, filters by Active / Archived, and opens a
// per-activity modal (Edit rhythm / History / Archive · Unarchive /
// Delete). This page just authenticates, fetches the full list + tag
// palette, and hands them down.
// ---------------------------------------------------------------------------

import { requireOnboardedUser } from "@/lib/auth/require-onboarded-user";
import {
  isAddActivityDensity,
  type AddActivityDensity,
} from "@/lib/domain/add-activity-density";
import { buildTagMap, computeTagUsage, type TagMap } from "@/lib/domain/tags";

import { DashboardHeader } from "@/app/_components/dashboard-header";
import { SectionTabs } from "@/app/_components/section-tabs";

import type { ActivityRow } from "./activity-detail-modal";
import { TotalView } from "./total-view";

function todayInTimeZone(tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export default async function ActivitiesPage() {
  // requireOnboardedUser handles both the unauthed → /login bounce and
  // the not-yet-onboarded → /onboarding bounce in one call.
  const { supabase, user, profile } = await requireOnboardedUser();

  const [{ data }, { data: tagRows }] = await Promise.all([
    supabase
      .from("activities")
      .select(
        "id, name, notes, rhythm, start_date, end_date, priority, default_skill_tags, scheduled_times, reminders, archived_at, created_at, track_on_grid, rollover_missed_days, rollover_change_rhythm, auto_archive"
      ),
    supabase.from("tags").select("id, name, color"),
  ]);

  const all = (data ?? []) as unknown as ActivityRow[];
  const active = all.filter((a) => a.archived_at === null);
  const archived = all.filter((a) => a.archived_at !== null);

  // For auto-archived (Past-filter) activities we surface both the
  // originally-scheduled date and the day the user actually completed
  // it — "Scheduled Jul 12 · Completed Jul 15". Only the singles that
  // clutter the Past bucket typically have this pair, but the query
  // is scoped to auto_archive=true anyway so we don't pay for it on
  // the Active or Archived tabs.
  const autoArchivedIds = all
    .filter((a) => a.auto_archive)
    .map((a) => a.id);

  const completedByActivityId: Record<string, string> = {};
  if (autoArchivedIds.length > 0) {
    // Fetch each activity's LATEST completion via the instance chain.
    // Query pattern is intentionally denormalized-lite: we accept two
    // fields per row (activity_id + occurred_at) and reduce to a
    // single latest per activity client-side.
    const { data: compRows } = await supabase
      .from("completion_instances")
      .select(
        "instance_id, completions!inner(occurred_at, deleted_at), activity_instances!inner(activity_id)"
      )
      .in("activity_instances.activity_id", autoArchivedIds)
      .is("completions.deleted_at", null);
    // PostgREST types !inner joins as an array even though the join
    // returns a single row per relationship. Cast to unknown-then-Row
    // to bypass Supabase's array wrapper.
    type Row = {
      completions:
        | { occurred_at: string; deleted_at: string | null }
        | Array<{ occurred_at: string; deleted_at: string | null }>
        | null;
      activity_instances:
        | { activity_id: string }
        | Array<{ activity_id: string }>
        | null;
    };
    for (const r of (compRows ?? []) as unknown as Row[]) {
      const c = Array.isArray(r.completions)
        ? r.completions[0]
        : r.completions;
      const ai = Array.isArray(r.activity_instances)
        ? r.activity_instances[0]
        : r.activity_instances;
      if (!c || !ai) continue;
      const aId = ai.activity_id;
      const existing = completedByActivityId[aId];
      if (!existing || c.occurred_at > existing) {
        completedByActivityId[aId] = c.occurred_at;
      }
    }
  }

  // Tag usage counts cover ACTIVE activities only — archived rows
  // shouldn't keep an old tag pinned to the top of the picker.
  const usageByName = computeTagUsage(active);
  const tagMap: TagMap = buildTagMap(
    (tagRows ?? []) as Array<{ id: string; name: string; color: string }>,
    usageByName
  );

  const todayStr = todayInTimeZone(profile.timezone ?? "UTC");
  const density: AddActivityDensity = isAddActivityDensity(
    (profile as { add_activity_density?: string }).add_activity_density
  )
    ? ((profile as { add_activity_density: AddActivityDensity })
        .add_activity_density)
    : "default";

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-2xl flex-col gap-4 p-6">
      <DashboardHeader userEmail={user.email ?? ""} />

      <SectionTabs active="total" date={todayStr} />

      <p className="text-sm text-zinc-500">
        {active.length} active · {archived.length} archived · {all.length} total
      </p>

      <TotalView
        activities={all}
        tagMap={tagMap}
        density={density}
        completedByActivityId={completedByActivityId}
      />
    </main>
  );
}
