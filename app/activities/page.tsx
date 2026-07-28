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
        "id, name, notes, rhythm, start_date, end_date, priority, default_skill_tags, scheduled_times, reminders, archived_at, created_at, track_on_grid, rollover_missed_days, rollover_change_rhythm"
      ),
    supabase.from("tags").select("id, name, color"),
  ]);

  const all = (data ?? []) as unknown as ActivityRow[];
  const active = all.filter((a) => a.archived_at === null);
  const archived = all.filter((a) => a.archived_at !== null);

  // Tag usage counts cover ACTIVE activities only — archived rows
  // shouldn't keep an old tag pinned to the top of the picker.
  const usageByName = computeTagUsage(active);
  const tagMap: TagMap = buildTagMap(
    (tagRows ?? []) as Array<{ id: string; name: string; color: string }>,
    usageByName
  );

  const todayStr = todayInTimeZone(profile.timezone ?? "UTC");

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-2xl flex-col gap-4 p-6">
      <DashboardHeader userEmail={user.email ?? ""} />

      <SectionTabs active="total" date={todayStr} />

      <p className="text-sm text-zinc-500">
        {active.length} active · {archived.length} archived · {all.length} total
      </p>

      <TotalView activities={all} tagMap={tagMap} />
    </main>
  );
}
