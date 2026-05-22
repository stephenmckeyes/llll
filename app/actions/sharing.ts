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
      .select("id, name")
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

  return ((activities ?? []) as Array<{ id: string; name: string }>).map(
    (a) => ({
      id: a.id,
      name: a.name,
      shared: shareMap.has(a.id),
      shareProgress: shareMap.get(a.id) ?? true,
    })
  );
}

// shareActivity — share one activity with a friend. `shareProgress`
// defaults to true (friend can follow along). Idempotent on the unique
// (activity_id, shared_with_id) constraint. RLS enforces that the caller
// owns the activity and has an accepted friendship with the recipient.
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
  // 23505 = unique violation (already shared) → treat as success.
  if (error && error.code !== "23505") return { error: error.message };

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
