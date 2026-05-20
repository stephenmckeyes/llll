// ---------------------------------------------------------------------------
// ensureInstancesBackfilled — call this when serving any view that depends
// on activity_instances being populated up to some future date.
//
// At activity-creation time we only generate INSTANCE_HORIZON_DAYS of
// instances. For indefinite rhythms (no end_date), the calendar would
// silently "run out" once the user looks past that horizon. This helper
// extends every active activity's instance set up to `throughDateStr`,
// idempotently — already-present instances are skipped via the
// (activity_id, scheduled_for) unique index + ignoreDuplicates on upsert.
//
// Performance:
//   - In-memory throttle: re-runs at most once per hour per user. The
//     cache resets on server restart (in dev). For production
//     deployments, we'll migrate this to a profiles.last_backfilled_at
//     column.
//   - Only fetches FUTURE instances when checking "what's the latest
//     scheduled date per activity" — past instances aren't relevant for
//     extending forward, so they don't need to come back across the wire.
//   - Edits that affect generation (rhythm changes, date changes,
//     archive/unarchive) call invalidateBackfillCache(userId) so the
//     next page load runs backfill immediately, not an hour from now.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays } from "date-fns";

import { generateInstances } from "@/lib/domain/rhythms";
import type { Rhythm } from "@/lib/validators/rhythm";

const THROTTLE_MS = 60 * 60 * 1000; // 1 hour
const lastBackfillByUser = new Map<string, number>();

export function invalidateBackfillCache(userId: string): void {
  lastBackfillByUser.delete(userId);
}

export async function ensureInstancesBackfilled(
  supabase: SupabaseClient,
  userId: string,
  throughDateStr: string
): Promise<void> {
  const last = lastBackfillByUser.get(userId);
  if (last && Date.now() - last < THROTTLE_MS) return;

  const todayStr = new Date().toISOString().slice(0, 10);

  const { data: activities } = await supabase
    .from("activities")
    .select("id, rhythm, start_date, end_date, default_skill_tags")
    .eq("user_id", userId)
    .is("archived_at", null);

  if (!activities || activities.length === 0) {
    lastBackfillByUser.set(userId, Date.now());
    return;
  }

  const activityIds = activities.map((a) => a.id);

  // Only fetch FUTURE instances — past ones don't affect "where do we
  // need to extend to". Massively cuts the result size for users with
  // years of history.
  const { data: futureInstances } = await supabase
    .from("activity_instances")
    .select("activity_id, scheduled_for")
    .in("activity_id", activityIds)
    .gte("scheduled_for", todayStr)
    .order("scheduled_for", { ascending: false });

  const latestFutureByActivity = new Map<string, string>();
  for (const inst of futureInstances ?? []) {
    if (!latestFutureByActivity.has(inst.activity_id)) {
      latestFutureByActivity.set(inst.activity_id, inst.scheduled_for);
    }
  }

  for (const activity of activities as Array<{
    id: string;
    rhythm: Rhythm;
    start_date: string;
    end_date: string | null;
    default_skill_tags: string[] | null;
  }>) {
    const effectiveEnd =
      activity.end_date && activity.end_date < throughDateStr
        ? activity.end_date
        : throughDateStr;

    const latestFuture = latestFutureByActivity.get(activity.id);
    if (latestFuture && latestFuture >= effectiveEnd) continue; // covered

    // If we have no future instances at all, start either at today (so we
    // don't recreate already-completed past instances) or at start_date if
    // it's in the future.
    let fromDate: string;
    if (latestFuture) {
      fromDate = addOneDay(latestFuture);
    } else {
      fromDate =
        activity.start_date > todayStr ? activity.start_date : todayStr;
    }
    if (fromDate > effectiveEnd) continue;

    let toGenerate: { scheduledFor: string }[] = [];
    try {
      toGenerate = generateInstances(activity.rhythm, {
        from: fromDate,
        to: effectiveEnd,
      });
    } catch {
      continue;
    }

    if (toGenerate.length === 0) continue;

    // Snapshot the activity's CURRENT tags into each generated
    // instance. Background backfill is one of the paths that creates
    // new instances; without this, those instances would land with
    // empty tags. From here on Edit Activity changes don't propagate
    // backward through these rows.
    const tagsSnapshot = activity.default_skill_tags ?? [];
    const rows = toGenerate.map((i) => ({
      activity_id: activity.id,
      scheduled_for: i.scheduledFor,
      status: "pending" as const,
      tags: tagsSnapshot,
    }));

    await supabase
      .from("activity_instances")
      .upsert(rows, {
        onConflict: "activity_id,scheduled_for",
        ignoreDuplicates: true,
      });
  }

  lastBackfillByUser.set(userId, Date.now());
}

function addOneDay(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  return addDays(new Date(y, m - 1, d), 1).toISOString().slice(0, 10);
}
