// ---------------------------------------------------------------------------
// Server actions for the sharing layer (migration 0011 — activity_shares).
//
// A share is one row: "owner shared activity A with friend B" (read-only,
// per-activity, per-friend, revocable). The owner controls everything:
//   - shareActivity / unshareActivity — start or revoke a share.
//   - setShareProgress — toggle whether the friend also sees the owner's
//     completion history (true) or just the template/schedule (false).
//   - getShareState — list the owner's active activities + which are
//     shared with a given friend (drives the per-friend Share modal).
//
// The recipient side reads ONLY through the get_shared_with_me() SECURITY
// DEFINER RPC, which returns exactly what's shared WITH the caller and
// nothing else. Friends can view + copy, never edit. Insert is additionally
// gated by RLS (must own the activity AND have an accepted friendship).
// ---------------------------------------------------------------------------

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import type { Rhythm } from "@/lib/validators/rhythm";

// ---------------------------------------------------------------------------
// Owner side
// ---------------------------------------------------------------------------

export type ShareableActivity = {
  id: string;
  name: string;
  /** Currently shared with the friend this state was fetched for. */
  shared: boolean;
  /** When shared, whether the owner's progress is included. */
  shareProgress: boolean;
  /** Fields below are for the share modal's Group by / Search
   *  controls (matching Total View). Rhythm feeds "Group by rhythm";
   *  default_skill_tags feeds "Group by tag"; track_on_grid feeds
   *  "Group by status" (Active · On grid vs Active · Off grid).
   *  scheduled_times is passed alongside rhythm so the group's label
   *  matches how the activity appears elsewhere (e.g. "Multi Daily"). */
  rhythm: Rhythm;
  defaultSkillTags: string[];
  scheduledTimes: string[];
  trackOnGrid: boolean;
};

// getShareState — the caller's active (non-archived) activities annotated
// with whether each is currently shared with `friendId`. Used to render the
// per-friend "Share rhythms" modal with the right toggles pre-checked.
export async function getShareState(
  friendId: string
): Promise<ShareableActivity[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: activities }, { data: shares }] = await Promise.all([
    supabase
      .from("activities")
      .select(
        "id, name, rhythm, default_skill_tags, scheduled_times, track_on_grid"
      )
      .eq("user_id", user.id)
      .is("archived_at", null)
      .order("name", { ascending: true }),
    supabase
      .from("activity_shares")
      .select("activity_id, share_progress")
      .eq("owner_id", user.id)
      .eq("shared_with_id", friendId),
  ]);

  const shareMap = new Map(
    ((shares ?? []) as Array<{ activity_id: string; share_progress: boolean }>).map(
      (s) => [s.activity_id, s.share_progress]
    )
  );

  type Row = {
    id: string;
    name: string;
    rhythm: Rhythm;
    default_skill_tags: string[] | null;
    scheduled_times: string[] | null;
    track_on_grid: boolean;
  };
  return ((activities ?? []) as Row[]).map((a) => ({
    id: a.id,
    name: a.name,
    shared: shareMap.has(a.id),
    shareProgress: shareMap.get(a.id) ?? true,
    rhythm: a.rhythm,
    defaultSkillTags: a.default_skill_tags ?? [],
    scheduledTimes: a.scheduled_times ?? [],
    trackOnGrid: a.track_on_grid,
  }));
}

// shareActivity — share one activity with a friend. `shareProgress`
// defaults to true (friend can follow along). Idempotent on the unique
// (activity_id, shared_with_id) constraint. RLS enforces that the caller
// owns the activity and has an accepted friendship with the recipient.
//
// When the INSERT actually creates a row (i.e. not a re-share of
// something the friend already had), we also drop a
// `is_share_notification=true` message into the chat so the friend
// sees the same "check-in panel" the ask-for-help flow uses, minus
// the red urgency. Re-shares don't spam.
export async function shareActivity(
  activityId: string,
  friendId: string,
  shareProgress: boolean = true
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.from("activity_shares").insert({
    activity_id: activityId,
    owner_id: user.id,
    shared_with_id: friendId,
    share_progress: shareProgress,
  });
  const wasNew = !error;
  // 23505 = unique violation (already shared) → treat as success.
  if (error && error.code !== "23505") return { error: error.message };

  if (wasNew) {
    // Best-effort: look up the activity name to embed in the chat
    // notification. If the lookup fails for any reason (RLS, deleted
    // in a race) we just skip the message — the share still counts.
    const { data: act } = await supabase
      .from("activities")
      .select("name")
      .eq("id", activityId)
      .maybeSingle();
    const name = (act as { name?: string } | null)?.name;
    if (name) {
      await supabase.from("messages").insert({
        sender_id: user.id,
        recipient_id: friendId,
        body: "",
        quoted_activity_id: activityId,
        quoted_activity_name: name,
        is_share_notification: true,
      });
      revalidatePath(`/friends/${friendId}/chat`);
      revalidatePath("/notifications");
    }
  }

  revalidatePath("/friends");
  return { ok: true };
}

// setShareProgress — flip the "share my progress" flag on an existing
// share. Owner only (RLS).
export async function setShareProgress(
  activityId: string,
  friendId: string,
  shareProgress: boolean
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("activity_shares")
    .update({ share_progress: shareProgress })
    .eq("owner_id", user.id)
    .eq("activity_id", activityId)
    .eq("shared_with_id", friendId);
  if (error) return { error: error.message };

  return { ok: true };
}

// unshareActivity — revoke a share. Owner only (RLS).
export async function unshareActivity(
  activityId: string,
  friendId: string
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("activity_shares")
    .delete()
    .eq("owner_id", user.id)
    .eq("activity_id", activityId)
    .eq("shared_with_id", friendId);
  if (error) return { error: error.message };

  revalidatePath("/friends");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Recipient side
// ---------------------------------------------------------------------------

export type SharedActivity = {
  shareId: string;
  activityId: string;
  ownerId: string;
  ownerUsername: string | null;
  ownerDisplayName: string | null;
  shareProgress: boolean;
  name: string;
  notes: string | null;
  rhythm: Rhythm;
  priority: number;
  scheduledTimes: string[];
  defaultSkillTags: string[];
  startDate: string;
  endDate: string | null;
  archivedAt: string | null;
  createdAt: string;
};

// getSharedWithMe — every rhythm shared WITH the caller, via the
// get_shared_with_me() SECURITY DEFINER RPC. Returns the full activity
// definition (so it can be displayed read-only and copied) plus the
// owner's safe fields and the share's settings — and ONLY rows where the
// caller is the recipient.
// A dated occurrence of a shared rhythm, returned by the
// get_shared_instances_with_me RPC. Only present for shares where the owner
// turned ON "share my progress" (and the activity isn't archived) — so a
// template-only or archived share contributes NO instances.
export type SharedInstance = {
  ownerId: string;
  activityId: string;
  instanceId: string;
  scheduledFor: string;
  status: "pending" | "completed" | "missed" | "skipped" | "shifted";
  completionCount: number;
  /** One YYYY-MM-DD per live completion, in the OWNER's timezone so it
   *  matches the day the owner sees on their own dashboard. Used by the
   *  friend dropdown to place each completion on its own day for
   *  frequency rhythms. Added in migration 0019. Falls back to an empty
   *  array on older RPC deployments. */
  completionDates: string[];
  /** Owner's post-hoc reflection about this occurrence, shown read-only
   *  in the friend view. NULL / empty = no comment. Added in migration
   *  0020. Falls back to null on older RPC deployments. */
  comment: string | null;
};

// getSharedInstancesWithMe — occurrences (+ completion state) of every
// rhythm shared WITH the caller within [from, to]. Read-only; gated to
// share_progress=true, non-archived activities by the RPC. The caller
// filters by ownerId to scope to one friend.
export async function getSharedInstancesWithMe(
  from: string,
  to: string
): Promise<SharedInstance[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase.rpc("get_shared_instances_with_me", {
    p_from: from,
    p_to: to,
  });
  const rows = (data ?? []) as Array<{
    owner_id: string;
    activity_id: string;
    instance_id: string;
    scheduled_for: string;
    status: string;
    completion_count: number;
    completion_dates?: string[] | null;
    comment?: string | null;
  }>;
  return rows.map((r) => ({
    ownerId: r.owner_id,
    activityId: r.activity_id,
    instanceId: r.instance_id,
    scheduledFor: r.scheduled_for,
    status: r.status as SharedInstance["status"],
    completionCount: r.completion_count,
    completionDates: r.completion_dates ?? [],
    comment: r.comment ?? null,
  }));
}

export async function getSharedWithMe(): Promise<SharedActivity[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase.rpc("get_shared_with_me");
  const rows = (data ?? []) as Array<{
    share_id: string;
    activity_id: string;
    owner_id: string;
    owner_username: string | null;
    owner_display_name: string | null;
    share_progress: boolean;
    name: string;
    notes: string | null;
    rhythm: Rhythm;
    priority: number;
    scheduled_times: string[] | null;
    default_skill_tags: string[] | null;
    start_date: string;
    end_date: string | null;
    archived_at: string | null;
    created_at: string;
  }>;

  return rows.map((r) => ({
    shareId: r.share_id,
    activityId: r.activity_id,
    ownerId: r.owner_id,
    ownerUsername: r.owner_username,
    ownerDisplayName: r.owner_display_name,
    shareProgress: r.share_progress,
    name: r.name,
    notes: r.notes,
    rhythm: r.rhythm,
    priority: r.priority,
    scheduledTimes: r.scheduled_times ?? [],
    defaultSkillTags: r.default_skill_tags ?? [],
    startDate: r.start_date,
    endDate: r.end_date,
    archivedAt: r.archived_at,
    createdAt: r.created_at,
  }));
}
