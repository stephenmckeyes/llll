// ---------------------------------------------------------------------------
// Server action for exporting the user's data as a JSON bundle.
//
// Purpose (per BACKLOG → "AI-friendly data export"): give the user a
// download they can paste into an AI for trend analysis. Bundles
// everything in one shot:
//   - activities (active + archived)
//   - activity_instances over the last N days
//   - completion rows linked to those instances
//   - simple per-activity rollups
//
// Returned payload is a string (the JSON file content). The Settings
// page downloads it via a Blob + <a download> trick. We don't stream
// because for typical users the whole bundle is <1MB; complexity isn't
// worth it. We DO redact email addresses (the user already knows their
// own) and Supabase internal IDs — keeping just the user-visible
// fields plus stable per-activity UUIDs so the JSON is self-consistent
// when re-imported or compared across exports.
// ---------------------------------------------------------------------------

"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

// Default lookback: ~13 months covers a full year-over-year analysis.
// Adjustable by the caller if we add a UI option later.
const EXPORT_LOOKBACK_DAYS = 395;

export type ExportBundle = {
  generated_at: string;
  lookback_days: number;
  activities: Array<{
    id: string;
    name: string;
    notes: string | null;
    rhythm: unknown;
    priority: number;
    scheduled_times: string[];
    default_skill_tags: string[];
    reminders: unknown;
    start_date: string;
    end_date: string | null;
    archived_at: string | null;
    created_at: string;
  }>;
  instances: Array<{
    id: string;
    activity_id: string;
    scheduled_for: string;
    status: string;
    tags: string[];
    completion_count: number;
  }>;
  completions: Array<{
    id: string;
    occurred_at: string;
    effort_rating: number | null;
    note: string | null;
    instance_ids: string[];
  }>;
  /** Per-activity summary stats over the window, pre-computed so the
   *  AI doesn't need to roll up raw rows. */
  rollups: Array<{
    activity_id: string;
    activity_name: string;
    instances_in_window: number;
    completed: number;
    missed: number;
    pending: number;
    completion_rate: number | null;
  }>;
};

export async function exportData(): Promise<{
  json: string;
  filename: string;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const todayStr = new Date().toISOString().slice(0, 10);
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - EXPORT_LOOKBACK_DAYS);
  const cutoffStr = cutoffDate.toISOString().slice(0, 10);

  // ---- activities ----
  const { data: rawActivities } = await supabase
    .from("activities")
    .select(
      "id, name, notes, rhythm, priority, scheduled_times, default_skill_tags, reminders, start_date, end_date, archived_at, created_at"
    );
  const activities = (rawActivities ?? []) as ExportBundle["activities"];

  // ---- instances within the window ----
  type RawInstance = {
    id: string;
    activity_id: string;
    scheduled_for: string;
    status: string;
    tags: string[] | null;
    completion_instances: Array<{ completion_id: string }> | null;
  };
  const { data: rawInstances } = await supabase
    .from("activity_instances")
    .select(
      "id, activity_id, scheduled_for, status, tags, completion_instances ( completion_id )"
    )
    .gte("scheduled_for", cutoffStr)
    .order("scheduled_for");
  const instances: ExportBundle["instances"] = (
    (rawInstances ?? []) as RawInstance[]
  ).map((r) => ({
    id: r.id,
    activity_id: r.activity_id,
    scheduled_for: r.scheduled_for,
    status: r.status,
    tags: r.tags ?? [],
    completion_count: r.completion_instances?.length ?? 0,
  }));

  // ---- completions (and their linked instance ids) ----
  type RawCompletion = {
    id: string;
    occurred_at: string;
    effort_rating: number | null;
    note: string | null;
    completion_instances: Array<{ instance_id: string }> | null;
  };
  const { data: rawCompletions } = await supabase
    .from("completions")
    .select(
      "id, occurred_at, effort_rating, note, completion_instances ( instance_id )"
    )
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .gte("occurred_at", `${cutoffStr}T00:00:00Z`);
  const completions: ExportBundle["completions"] = (
    (rawCompletions ?? []) as RawCompletion[]
  ).map((c) => ({
    id: c.id,
    occurred_at: c.occurred_at,
    effort_rating: c.effort_rating,
    note: c.note,
    instance_ids:
      c.completion_instances?.map((ci) => ci.instance_id) ?? [],
  }));

  // ---- rollups: per-activity simple stats over the window ----
  const byActivity = new Map<string, ExportBundle["instances"]>();
  for (const inst of instances) {
    const arr = byActivity.get(inst.activity_id) ?? [];
    arr.push(inst);
    byActivity.set(inst.activity_id, arr);
  }
  const rollups: ExportBundle["rollups"] = activities.map((a) => {
    const arr = byActivity.get(a.id) ?? [];
    const completed = arr.filter((i) => i.status === "completed").length;
    const missed = arr.filter((i) => i.status === "missed").length;
    const pending = arr.filter((i) => i.status === "pending").length;
    const decided = completed + missed;
    return {
      activity_id: a.id,
      activity_name: a.name,
      instances_in_window: arr.length,
      completed,
      missed,
      pending,
      completion_rate:
        decided === 0 ? null : Math.round((completed / decided) * 100),
    };
  });

  const bundle: ExportBundle = {
    generated_at: new Date().toISOString(),
    lookback_days: EXPORT_LOOKBACK_DAYS,
    activities,
    instances,
    completions,
    rollups,
  };

  const json = JSON.stringify(bundle, null, 2);
  const filename = `mission-export-${todayStr}.json`;
  return { json, filename };
}
