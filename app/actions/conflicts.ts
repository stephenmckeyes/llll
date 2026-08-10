// ---------------------------------------------------------------------------
// Server actions for timeline conflict acknowledgements (migration 0036).
//
// A user acknowledges an overlapping-schedule pair by inserting a row
// keyed by `${date}|${eventKey1}|${eventKey2}` (lex-sorted so the same
// pair collapses to one row regardless of detection order). The
// Timeline + /notifications page both read this set and hide any pair
// already in it — persistence is server-side, so ack'ing on one
// device drops it everywhere.
//
// Detection itself lives client-side in `timeline-shared.ts` for the
// Timeline views. For /notifications we also compute conflicts
// server-side against today's instances so the page can list
// unacknowledged ones without needing the user to open Timeline.
// ---------------------------------------------------------------------------

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
  detectConflicts,
  type TimelineEvent,
} from "@/app/_components/timeline-shared";

// The acknowledge / list pair, plus a computed "conflicts still open
// for TODAY" helper used by the notifications page.

export async function acknowledgeConflict(
  pairKey: string
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const key = String(pairKey).slice(0, 400);
  if (!key.includes("|")) return { error: "Bad pair key." };

  const { error } = await supabase
    .from("conflict_acknowledgements")
    .upsert({ user_id: user.id, pair_key: key }, {
      onConflict: "user_id,pair_key",
      ignoreDuplicates: true,
    });
  if (error) return { error: error.message };

  revalidatePath("/");
  revalidatePath("/notifications");
  return { ok: true };
}

export async function listAcknowledgedPairKeys(): Promise<string[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase
    .from("conflict_acknowledgements")
    .select("pair_key")
    .eq("user_id", user.id);
  if (error || !data) return [];
  return (data as Array<{ pair_key: string }>).map((r) => r.pair_key);
}

export type NotificationConflict = {
  pairKey: string;
  date: string;
  a: { name: string; start: string; end: string };
  b: { name: string; start: string; end: string };
};

// Compute today's conflicts (from ALL of the user's active scheduled
// activities for the day), minus anything already acknowledged. Used
// by /notifications so the user sees the same list Timeline surfaces
// even without opening Timeline.
export async function getUnacknowledgedConflictsForDate(
  date: string
): Promise<NotificationConflict[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: instRows }, { data: ackRows }] = await Promise.all([
    supabase
      .from("activity_instances")
      .select(
        `id,
         activities (
           id, name, scheduled_times, scheduled_end_times, archived_at
         )`
      )
      .eq("scheduled_for", date),
    supabase
      .from("conflict_acknowledgements")
      .select("pair_key")
      .eq("user_id", user.id),
  ]);

  type Row = {
    id: string;
    activities: {
      id: string;
      name: string;
      scheduled_times: string[] | null;
      scheduled_end_times: string[] | null;
      archived_at: string | null;
    } | null;
  };

  type EventData = { name: string };
  const events: TimelineEvent<EventData>[] = [];
  for (const r of ((instRows ?? []) as unknown as Row[])) {
    if (!r.activities || r.activities.archived_at) continue;
    const starts = r.activities.scheduled_times ?? [];
    const ends = r.activities.scheduled_end_times ?? [];
    for (let i = 0; i < starts.length; i++) {
      events.push({
        key: `${r.id}:${i}`,
        data: { name: r.activities.name },
        start: starts[i],
        end: ends[i] ?? "",
      });
    }
  }

  const conflicts = detectConflicts(events);
  const acknowledged = new Set(
    ((ackRows ?? []) as Array<{ pair_key: string }>).map((r) => r.pair_key)
  );

  const out: NotificationConflict[] = [];
  for (const c of conflicts) {
    const [x, y] = c.a.key < c.b.key ? [c.a, c.b] : [c.b, c.a];
    const pairKey = `${date}|${x.key}|${y.key}`;
    if (acknowledged.has(pairKey)) continue;
    out.push({
      pairKey,
      date,
      a: { name: c.a.data.name, start: c.a.start, end: c.a.end },
      b: { name: c.b.data.name, start: c.b.start, end: c.b.end },
    });
  }
  return out;
}
