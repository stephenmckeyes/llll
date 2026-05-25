// ---------------------------------------------------------------------------
// Server actions for "watching" a friend's shared rhythm (migration 0013).
//
//   - getWatches()      — every watch the caller has set (drives the friend
//                         view's Reminders buttons + the Notifications tab).
//   - setWatch()        — turn the three cadences on/off for one activity.
//                         All-off deletes the row.
//
// RLS enforces you can only watch activities shared WITH you (progress
// included). The reminders are computed live in /notifications — these
// actions only persist the preference.
// ---------------------------------------------------------------------------

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type Watch = {
  activityId: string;
  notifyEach: boolean;
  notifyDaily: boolean;
  notifyWeekly: boolean;
};

export async function getWatches(): Promise<Watch[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("activity_watches")
    .select("activity_id, notify_each, notify_daily, notify_weekly")
    .eq("watcher_id", user.id);

  return (
    (data ?? []) as Array<{
      activity_id: string;
      notify_each: boolean;
      notify_daily: boolean;
      notify_weekly: boolean;
    }>
  ).map((r) => ({
    activityId: r.activity_id,
    notifyEach: r.notify_each,
    notifyDaily: r.notify_daily,
    notifyWeekly: r.notify_weekly,
  }));
}

export async function setWatch(
  activityId: string,
  each: boolean,
  daily: boolean,
  weekly: boolean
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // All cadences off → remove the watch entirely.
  if (!each && !daily && !weekly) {
    const { error } = await supabase
      .from("activity_watches")
      .delete()
      .eq("watcher_id", user.id)
      .eq("activity_id", activityId);
    if (error) return { error: error.message };
    revalidatePath("/notifications");
    return { ok: true };
  }

  // Upsert the row (insert is RLS-gated to activities shared WITH you).
  const { error } = await supabase.from("activity_watches").upsert(
    {
      watcher_id: user.id,
      activity_id: activityId,
      notify_each: each,
      notify_daily: daily,
      notify_weekly: weekly,
    },
    { onConflict: "watcher_id,activity_id" }
  );
  if (error) return { error: error.message };

  revalidatePath("/notifications");
  return { ok: true };
}
