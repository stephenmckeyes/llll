// ---------------------------------------------------------------------------
// ensureInstancesBackfilled — call this when serving any view that depends
// on activity_instances being populated up to some future date.
//
// At activity-creation time we only generate INSTANCE_HORIZON_DAYS of
// instances. For indefinite rhythms (no end_date), this means the calendar
// "runs out" once the horizon is past. This helper extends every active
// activity's instance set up to `throughDateStr`, idempotently — already-
// present instances are skipped via the (activity_id, scheduled_for) unique
// index + ignoreDuplicates on upsert.
//
// Idea: rhythms can change mid-life (rhythm edits regenerate the future),
// so this helper looks at each activity's CURRENT rhythm rather than the
// historical one. Past instances are preserved as-is regardless.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays } from "date-fns";

import { generateInstances } from "@/lib/domain/rhythms";
import type { Rhythm } from "@/lib/validators/rhythm";

export async function ensureInstancesBackfilled(
  supabase: SupabaseClient,
  userId: string,
  throughDateStr: string
): Promise<void> {
  const { data: activities } = await supabase
    .from("activities")
    .select("id, rhythm, start_date, end_date")
    .eq("user_id", userId)
    .is("archived_at", null);

  if (!activities || activities.length === 0) return;

  const activityIds = activities.map((a) => a.id);

  // Batched max-scheduled_for per activity. One query for the whole user.
  const { data: existing } = await supabase
    .from("activity_instances")
    .select("activity_id, scheduled_for")
    .in("activity_id", activityIds)
    .order("scheduled_for", { ascending: false });

  const latestByActivity = new Map<string, string>();
  for (const inst of existing ?? []) {
    if (!latestByActivity.has(inst.activity_id)) {
      latestByActivity.set(inst.activity_id, inst.scheduled_for);
    }
  }

  for (const activity of activities as Array<{
    id: string;
    rhythm: Rhythm;
    start_date: string;
    end_date: string | null;
  }>) {
    const effectiveEnd =
      activity.end_date && activity.end_date < throughDateStr
        ? activity.end_date
        : throughDateStr;

    const latest = latestByActivity.get(activity.id);
    if (latest && latest >= effectiveEnd) continue; // already covered

    const fromDate = latest
      ? addOneDay(latest)
      : activity.start_date;
    if (fromDate > effectiveEnd) continue;

    let toGenerate: { scheduledFor: string }[] = [];
    try {
      toGenerate = generateInstances(activity.rhythm, {
        from: fromDate,
        to: effectiveEnd,
      });
    } catch {
      continue; // skip malformed rhythms
    }

    if (toGenerate.length === 0) continue;

    const rows = toGenerate.map((i) => ({
      activity_id: activity.id,
      scheduled_for: i.scheduledFor,
      status: "pending" as const,
    }));

    // ignoreDuplicates uses ON CONFLICT DO NOTHING — safe to call even if
    // some target rows already exist (race conditions, manual SQL, etc.).
    await supabase
      .from("activity_instances")
      .upsert(rows, {
        onConflict: "activity_id,scheduled_for",
        ignoreDuplicates: true,
      });
  }
}

function addOneDay(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  return addDays(new Date(y, m - 1, d), 1).toISOString().slice(0, 10);
}
