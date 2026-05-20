// ---------------------------------------------------------------------------
// fetchActivityHistory — bundles every instance for one activity, plus
// summary stats, into a single response the History modal renders.
//
// Modal-only, fetched on-demand:
//   - Doesn't bloat the /activities page's initial render (which has
//     N activities; we don't want N parallel history queries).
//   - Doesn't bloat the Day/Grid views (same reason).
// The user only pays for the data when they open History for a specific
// activity.
// ---------------------------------------------------------------------------

"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type HistoryInstance = {
  id: string;
  scheduled_for: string;
  status: "pending" | "completed" | "missed";
  /** Was this past-due-and-still-pending at fetch time? Lets the modal
   *  surface "unlabeled" rows distinctly from "scheduled" (future) rows
   *  without recomputing the today comparison on every render. */
  unlabeled: boolean;
  /** Number of completion rows linked. For multi-time / frequency
   *  activities this can be > 0 even while status is still "pending"
   *  (X of N progress). */
  completion_count: number;
};

export type HistoryStats = {
  total: number;
  completed: number;
  missed: number;
  unlabeled: number;
  pending_future: number;
  /** Completed / (completed + missed + unlabeled). null when there's
   *  nothing to score against (e.g. brand-new activity with only future
   *  scheduled rows). */
  completion_rate: number | null;
  /** Consecutive completed instances ending at the most recent past-or-
   *  current scheduled occurrence. 0 means the current run is broken. */
  current_streak: number;
  /** Longest run of consecutive completed-then-completed history this
   *  activity has ever achieved. */
  best_streak: number;
};

export type HistoryPayload = {
  activity: {
    id: string;
    name: string;
    start_date: string;
    end_date: string | null;
    archived_at: string | null;
  };
  stats: HistoryStats;
  /** ALL instances for this activity, sorted DESC by scheduled_for so
   *  the modal can render newest-first without re-sorting. */
  instances: HistoryInstance[];
};

export async function fetchActivityHistory(
  activityId: string
): Promise<HistoryPayload | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // 1) Activity metadata. RLS already scopes by user_id; the explicit
  // filter is belt-and-suspenders in case RLS is ever loosened.
  const { data: activityRow, error: aerr } = await supabase
    .from("activities")
    .select("id, name, start_date, end_date, archived_at")
    .eq("id", activityId)
    .maybeSingle();
  if (aerr || !activityRow) {
    return { error: aerr?.message ?? "Activity not found." };
  }

  // 2) Every instance for this activity, with linked-completion count.
  type RawInstance = {
    id: string;
    scheduled_for: string;
    status: string;
    completion_instances: Array<{ completion_id: string }> | null;
  };
  const { data: rawInstances } = await supabase
    .from("activity_instances")
    .select(
      "id, scheduled_for, status, completion_instances ( completion_id )"
    )
    .eq("activity_id", activityId)
    .order("scheduled_for", { ascending: false });

  const todayStr = new Date().toISOString().slice(0, 10);

  const instances: HistoryInstance[] = (
    (rawInstances ?? []) as RawInstance[]
  ).map((r) => ({
    id: r.id,
    scheduled_for: r.scheduled_for,
    status: (r.status === "completed" || r.status === "missed"
      ? r.status
      : "pending") as HistoryInstance["status"],
    unlabeled: r.status === "pending" && r.scheduled_for < todayStr,
    completion_count: r.completion_instances?.length ?? 0,
  }));

  // 3) Stats.
  const completed = instances.filter((i) => i.status === "completed").length;
  const missed = instances.filter((i) => i.status === "missed").length;
  const unlabeled = instances.filter((i) => i.unlabeled).length;
  const pendingFuture = instances.filter(
    (i) => i.status === "pending" && !i.unlabeled
  ).length;
  const decided = completed + missed + unlabeled;
  const completionRate =
    decided === 0 ? null : Math.round((completed / decided) * 100);

  // Streaks: walk the chronological list (oldest → newest) tracking
  // both the current-tail run and the best run seen so far.
  // Pending past-due ("unlabeled") rows BREAK a streak — they're days
  // the user neither completed nor missed, and we don't get to credit
  // them as a continuation. Pending future rows are ignored entirely
  // (no verdict yet, no break).
  let current = 0;
  let best = 0;
  // Walk oldest-first: instances came back DESC, so reverse a copy.
  const chronological = [...instances].reverse();
  for (const inst of chronological) {
    if (inst.status === "completed") {
      current++;
      if (current > best) best = current;
    } else if (
      inst.status === "missed" ||
      inst.unlabeled
    ) {
      current = 0;
    }
    // pending-future: skip (don't break, don't extend).
  }

  return {
    activity: activityRow,
    stats: {
      total: instances.length,
      completed,
      missed,
      unlabeled,
      pending_future: pendingFuture,
      completion_rate: completionRate,
      current_streak: current,
      best_streak: best,
    },
    instances,
  };
}
