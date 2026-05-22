// ---------------------------------------------------------------------------
// Server actions for the friends layer: lookup, requests, accept/decline,
// unfriend, and the overview used by the Friends + Notifications pages.
//
// All multi-user reads go through SECURITY DEFINER RPCs
// (find_user_by_handle, social_overview) that return only safe fields and
// only for people the caller actually has a relationship with — so the
// client never gets broad access to other users' profiles.
// ---------------------------------------------------------------------------

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type FoundUser = {
  id: string;
  username: string | null;
  displayName: string | null;
};

export type SocialEntry = {
  friendshipId: string;
  otherId: string;
  otherUsername: string | null;
  otherDisplayName: string | null;
  status: "pending" | "accepted" | "declined";
  direction: "incoming" | "outgoing";
  createdAt: string;
};

// ---------------------------------------------------------------------------
// searchUser — exact (case-insensitive) username/email lookup. Returns the
// match plus the caller's current relationship with them, so the UI can
// show the right button (Add / Pending / Friends / Respond).
// ---------------------------------------------------------------------------

export async function searchUser(
  handle: string
): Promise<
  | { error: string }
  | { user: null }
  | {
      user: FoundUser;
      relationship: "none" | "friends" | "outgoing" | "incoming" | "declined";
      friendshipId: string | null;
    }
> {
  const trimmed = handle.trim();
  if (trimmed.length === 0) return { error: "Enter a username or email." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase.rpc("find_user_by_handle", {
    handle: trimmed,
  });
  if (error) return { error: error.message };

  const rows = (data ?? []) as Array<{
    id: string;
    username: string | null;
    display_name: string | null;
  }>;
  if (rows.length === 0) return { user: null };

  const found = rows[0];

  // Existing relationship? Check both directions.
  const { data: existing } = await supabase
    .from("friendships")
    .select("id, requester_id, addressee_id, status")
    .or(
      `and(requester_id.eq.${user.id},addressee_id.eq.${found.id}),and(requester_id.eq.${found.id},addressee_id.eq.${user.id})`
    )
    .maybeSingle();

  let relationship:
    | "none"
    | "friends"
    | "outgoing"
    | "incoming"
    | "declined" = "none";
  let friendshipId: string | null = null;
  if (existing) {
    friendshipId = existing.id as string;
    const e = existing as {
      requester_id: string;
      status: string;
    };
    if (e.status === "accepted") relationship = "friends";
    else if (e.status === "declined") relationship = "declined";
    else
      relationship =
        e.requester_id === user.id ? "outgoing" : "incoming";
  }

  return {
    user: {
      id: found.id,
      username: found.username,
      displayName: found.display_name,
    },
    relationship,
    friendshipId,
  };
}

// ---------------------------------------------------------------------------
// sendFriendRequest — create a pending request. If the other person
// already sent YOU one (reverse pending), accept that instead of making a
// duplicate. If a row already exists, no-op (idempotent).
// ---------------------------------------------------------------------------

export async function sendFriendRequest(
  addresseeId: string
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (addresseeId === user.id) return { error: "You can't friend yourself." };

  // Reverse pending? Accept it.
  const { data: reverse } = await supabase
    .from("friendships")
    .select("id, status")
    .eq("requester_id", addresseeId)
    .eq("addressee_id", user.id)
    .maybeSingle();
  if (reverse) {
    if (reverse.status === "pending") {
      await supabase
        .from("friendships")
        .update({ status: "accepted", responded_at: new Date().toISOString() })
        .eq("id", reverse.id);
    }
    revalidatePath("/friends");
    revalidatePath("/notifications");
    return { ok: true };
  }

  const { error } = await supabase.from("friendships").insert({
    requester_id: user.id,
    addressee_id: addresseeId,
    status: "pending",
  });
  // 23505 = unique violation (request already exists) → treat as success.
  if (error && error.code !== "23505") return { error: error.message };

  revalidatePath("/friends");
  revalidatePath("/notifications");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// respondToRequest — accept or decline an incoming request. RLS ensures
// only the addressee can do this.
// ---------------------------------------------------------------------------

export async function respondToRequest(
  friendshipId: string,
  accept: boolean
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("friendships")
    .update({
      status: accept ? "accepted" : "declined",
      responded_at: new Date().toISOString(),
    })
    .eq("id", friendshipId);
  if (error) return { error: error.message };

  revalidatePath("/friends");
  revalidatePath("/notifications");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// removeFriend — unfriend, cancel a sent request, or clear a declined
// row. RLS allows either party to delete.
// ---------------------------------------------------------------------------

export async function removeFriend(
  friendshipId: string
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("friendships")
    .delete()
    .eq("id", friendshipId);
  if (error) return { error: error.message };

  revalidatePath("/friends");
  revalidatePath("/notifications");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// getSocialOverview — all of the caller's friendships with the other
// party's safe fields. Server components call this to render the Friends
// and Notifications pages.
// ---------------------------------------------------------------------------

export async function getSocialOverview(): Promise<SocialEntry[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase.rpc("social_overview");
  const rows = (data ?? []) as Array<{
    friendship_id: string;
    other_id: string;
    other_username: string | null;
    other_display_name: string | null;
    status: string;
    direction: string;
    created_at: string;
  }>;
  return rows.map((r) => ({
    friendshipId: r.friendship_id,
    otherId: r.other_id,
    otherUsername: r.other_username,
    otherDisplayName: r.other_display_name,
    status: r.status as SocialEntry["status"],
    direction: r.direction as SocialEntry["direction"],
    createdAt: r.created_at,
  }));
}
