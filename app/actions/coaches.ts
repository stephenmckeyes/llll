"use server";

// ---------------------------------------------------------------------------
// Coaches (migration 0072) — server actions for the Coaches tab.
//
// Phase 1: apply to be a coach, admin verification, and the public
// "Find a Coach" directory. Chat (reuse `messages`), activity sharing, the
// coach activity cache, and review writing arrive in later phases.
// ---------------------------------------------------------------------------

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type CoachDirectoryEntry = {
  userId: string;
  displayName: string | null;
  username: string | null;
  bio: string | null;
  photoUrl: string | null;
  priceAmount: number | null;
  priceUnit: "day" | "week" | null;
  ratingAvg: number | null;
  ratingCount: number;
};

export type MyCoachProfile = {
  bio: string | null;
  photoUrl: string | null;
  priceAmount: number | null;
  priceUnit: "day" | "week" | null;
  status: "pending" | "verified" | "rejected";
};

export type PendingCoachApplication = {
  userId: string;
  displayName: string | null;
  username: string | null;
  bio: string | null;
  photoUrl: string | null;
  priceAmount: number | null;
  priceUnit: "day" | "week" | null;
  appliedAt: string;
};

function coercePriceUnit(v: unknown): "day" | "week" | null {
  return v === "day" || v === "week" ? v : null;
}

// Is the current user a platform admin (can verify coach applications)?
export async function isCurrentUserAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  return (data as { is_admin?: boolean } | null)?.is_admin === true;
}

// The caller's own coach application (any status), or null if they haven't
// applied. Read via the owner RLS policy.
export async function getMyCoachProfile(): Promise<MyCoachProfile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("coach_profiles")
    .select("bio, photo_url, price_amount, price_unit, status")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!data) return null;
  const r = data as {
    bio: string | null;
    photo_url: string | null;
    price_amount: number | null;
    price_unit: string | null;
    status: string;
  };
  return {
    bio: r.bio,
    photoUrl: r.photo_url,
    priceAmount: r.price_amount,
    priceUnit: coercePriceUnit(r.price_unit),
    status:
      r.status === "verified" || r.status === "rejected"
        ? r.status
        : "pending",
  };
}

// The public "Find a Coach" directory — verified coaches only.
export async function getCoachDirectory(): Promise<CoachDirectoryEntry[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_coach_directory");
  return ((data ?? []) as Array<{
    user_id: string;
    display_name: string | null;
    username: string | null;
    bio: string | null;
    photo_url: string | null;
    price_amount: number | null;
    price_unit: string | null;
    rating_avg: number | null;
    rating_count: number;
  }>).map((r) => ({
    userId: r.user_id,
    displayName: r.display_name,
    username: r.username,
    bio: r.bio,
    photoUrl: r.photo_url,
    priceAmount: r.price_amount,
    priceUnit: coercePriceUnit(r.price_unit),
    ratingAvg: r.rating_avg,
    ratingCount: r.rating_count ?? 0,
  }));
}

// Pending applications for the admin review queue (RPC enforces is_admin).
export async function getPendingCoachApplications(): Promise<
  PendingCoachApplication[]
> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_pending_coach_applications");
  return ((data ?? []) as Array<{
    user_id: string;
    display_name: string | null;
    username: string | null;
    bio: string | null;
    photo_url: string | null;
    price_amount: number | null;
    price_unit: string | null;
    applied_at: string;
  }>).map((r) => ({
    userId: r.user_id,
    displayName: r.display_name,
    username: r.username,
    bio: r.bio,
    photoUrl: r.photo_url,
    priceAmount: r.price_amount,
    priceUnit: coercePriceUnit(r.price_unit),
    appliedAt: r.applied_at,
  }));
}

// Create/update the caller's coach application (sets status pending on apply).
export async function applyAsCoach(input: {
  bio: string;
  photoUrl: string;
  priceAmount: number | null;
  priceUnit: "day" | "week" | null;
}): Promise<{ error: string } | { ok: true; status: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase.rpc("apply_as_coach", {
    p_bio: input.bio,
    p_photo_url: input.photoUrl,
    p_price_amount: input.priceAmount,
    p_price_unit: input.priceUnit,
  });
  if (error) return { error: error.message };
  revalidatePath("/friends/coaches");
  return { ok: true, status: String(data ?? "pending") };
}

// ---------------------------------------------------------------------------
// Coaching relationships + chat (migration 0073).
// ---------------------------------------------------------------------------

export type CoachingParty = {
  otherUserId: string;
  displayName: string | null;
  username: string | null;
  photoUrl: string | null;
  status: "active" | "ended";
  startedAt: string;
};

function partyName(p: { displayName: string | null; username: string | null }) {
  return p.displayName ?? (p.username ? `@${p.username}` : "Someone");
}

// Engage a verified coach (as the client). Reactivates an ended relationship.
export async function startCoaching(
  coachUserId: string
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { error } = await supabase.rpc("start_coaching", {
    p_coach_user_id: coachUserId,
  });
  if (error) return { error: error.message };
  revalidatePath("/friends/coaches");
  return { ok: true };
}

// End an active coaching relationship (either participant).
export async function endCoaching(
  otherUserId: string
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { error } = await supabase.rpc("end_coaching", {
    p_other_user_id: otherUserId,
  });
  if (error) return { error: error.message };
  revalidatePath("/friends/coaches");
  return { ok: true };
}

// The caller's coaches (where they're the client).
export async function getMyCoaches(): Promise<CoachingParty[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_my_coaches");
  return ((data ?? []) as Array<{
    other_user_id: string;
    display_name: string | null;
    username: string | null;
    photo_url: string | null;
    status: string;
    started_at: string;
  }>).map((r) => ({
    otherUserId: r.other_user_id,
    displayName: r.display_name,
    username: r.username,
    photoUrl: r.photo_url,
    status: r.status === "ended" ? "ended" : "active",
    startedAt: r.started_at,
  }));
}

// The caller's clients (where they're the coach).
export async function getMyClients(): Promise<CoachingParty[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_my_clients");
  return ((data ?? []) as Array<{
    other_user_id: string;
    display_name: string | null;
    username: string | null;
    status: string;
    started_at: string;
  }>).map((r) => ({
    otherUserId: r.other_user_id,
    displayName: r.display_name,
    username: r.username,
    photoUrl: null,
    status: r.status === "ended" ? "ended" : "active",
    startedAt: r.started_at,
  }));
}

// The other participant of a coaching chat (guards the coach-chat page). Returns
// null if no relationship exists in either direction.
export async function getCoachingCounterparty(otherUserId: string): Promise<
  | { name: string; status: "active" | "ended"; iAmCoach: boolean }
  | null
> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_coaching_counterparty", {
    p_other_user_id: otherUserId,
  });
  const row = ((data ?? []) as Array<{
    display_name: string | null;
    username: string | null;
    status: string;
    i_am_coach: boolean;
  }>)[0];
  if (!row) return null;
  return {
    name: partyName({ displayName: row.display_name, username: row.username }),
    status: row.status === "ended" ? "ended" : "active",
    iAmCoach: row.i_am_coach,
  };
}

// Admin: verify / reject / re-pend a coach application.
export async function setCoachStatus(
  userId: string,
  status: "pending" | "verified" | "rejected"
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.rpc("set_coach_status", {
    p_user_id: userId,
    p_status: status,
  });
  if (error) return { error: error.message };
  revalidatePath("/friends/coaches");
  return { ok: true };
}
