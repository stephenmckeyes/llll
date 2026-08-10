// ---------------------------------------------------------------------------
// Server actions for Communities (migration 0031). All writes go through
// SECURITY DEFINER RPCs that do their own auth + permission checks; reads
// are gated by the RLS policies added in the same migration.
// ---------------------------------------------------------------------------

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
  ALLOWED_JOIN_POLICIES,
  ALLOWED_VISIBILITIES,
  isCommunityKind,
  type CommunityJoinPolicy,
  type CommunityKind,
  type CommunityRole,
  type CommunityVisibility,
} from "@/lib/domain/community";

export type CommunitySummary = {
  id: string;
  kind: CommunityKind;
  name: string;
  handle: string | null;
  description: string | null;
  visibility: CommunityVisibility;
  joinPolicy: CommunityJoinPolicy;
  createdAt: string;
  /** The caller's role in this community — null if they're not a member
   *  (which happens for public clubs/guilds the user has stumbled onto
   *  but not joined). */
  myRole: CommunityRole | null;
  memberCount: number;
};

export type CommunityMember = {
  userId: string;
  role: CommunityRole;
  joinedAt: string;
  displayName: string | null;
  username: string | null;
};

export type CommunityDetail = CommunitySummary & {
  members: CommunityMember[];
  /** Pending join requests, visible only to members (RLS enforced). Empty
   *  for non-leadership viewers — the UI decides whether to show the
   *  "Requests" section based on `myRole`. */
  pendingRequests: Array<{
    id: string;
    userId: string;
    note: string | null;
    createdAt: string;
    displayName: string | null;
    username: string | null;
  }>;
};

// listMyCommunities — every community of the given kind that the caller
// is a member of. Feeds the top-of-tab dropdown.
export async function listMyCommunities(
  kind: CommunityKind
): Promise<CommunitySummary[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Two-step: first the memberships (my user_id), then the communities.
  // A single joined query works too but two round-trips keeps types
  // simple and lets RLS gate each table independently.
  const { data: memberships } = await supabase
    .from("community_members")
    .select("community_id, role")
    .eq("user_id", user.id);

  const rows = (memberships ?? []) as Array<{
    community_id: string;
    role: string;
  }>;
  if (rows.length === 0) return [];

  const roleById = new Map(rows.map((r) => [r.community_id, r.role]));
  const ids = rows.map((r) => r.community_id);

  const { data: communities } = await supabase
    .from("communities")
    .select(
      "id, kind, name, handle, description, visibility, join_policy, created_at"
    )
    .in("id", ids)
    .eq("kind", kind)
    .order("created_at", { ascending: true });

  const cRows = (communities ?? []) as Array<{
    id: string;
    kind: string;
    name: string;
    handle: string | null;
    description: string | null;
    visibility: string;
    join_policy: string;
    created_at: string;
  }>;
  if (cRows.length === 0) return [];

  // Member counts — one head-count query grouped by community_id.
  const counts = await countMembers(cRows.map((c) => c.id));

  return cRows.map((c) => ({
    id: c.id,
    kind: c.kind as CommunityKind,
    name: c.name,
    handle: c.handle,
    description: c.description,
    visibility: c.visibility as CommunityVisibility,
    joinPolicy: c.join_policy as CommunityJoinPolicy,
    createdAt: c.created_at,
    myRole: (roleById.get(c.id) ?? "member") as CommunityRole,
    memberCount: counts.get(c.id) ?? 0,
  }));
}

// getCommunity — full detail for the overall page. Returns null when
// the caller can't see the community (private + not a member).
export async function getCommunity(
  communityId: string
): Promise<CommunityDetail | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: community } = await supabase
    .from("communities")
    .select(
      "id, kind, name, handle, description, visibility, join_policy, created_at"
    )
    .eq("id", communityId)
    .maybeSingle();
  if (!community) return null;
  const c = community as {
    id: string;
    kind: string;
    name: string;
    handle: string | null;
    description: string | null;
    visibility: string;
    join_policy: string;
    created_at: string;
  };

  // Members — RLS returns rows only when the caller is a member. Non-
  // members of public communities get an empty array here.
  const { data: memberRows } = await supabase
    .from("community_members")
    .select("user_id, role, joined_at")
    .eq("community_id", communityId)
    .order("joined_at", { ascending: true });
  const members = (memberRows ?? []) as Array<{
    user_id: string;
    role: string;
    joined_at: string;
  }>;

  const myRow = members.find((m) => m.user_id === user.id) ?? null;

  // Look up display names for every member + every open-request author.
  // These come from profiles (visible via existing RLS).
  const { data: pendingRows } = await supabase
    .from("community_join_requests")
    .select("id, user_id, note, created_at")
    .eq("community_id", communityId)
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  const pending = (pendingRows ?? []) as Array<{
    id: string;
    user_id: string;
    note: string | null;
    created_at: string;
  }>;

  const nameIds = Array.from(
    new Set([
      ...members.map((m) => m.user_id),
      ...pending.map((p) => p.user_id),
    ])
  );
  const nameLookup = await lookupDisplayNames(nameIds);

  return {
    id: c.id,
    kind: c.kind as CommunityKind,
    name: c.name,
    handle: c.handle,
    description: c.description,
    visibility: c.visibility as CommunityVisibility,
    joinPolicy: c.join_policy as CommunityJoinPolicy,
    createdAt: c.created_at,
    myRole: (myRow?.role as CommunityRole) ?? null,
    memberCount: members.length,
    members: members.map((m) => {
      const p = nameLookup.get(m.user_id);
      return {
        userId: m.user_id,
        role: m.role as CommunityRole,
        joinedAt: m.joined_at,
        displayName: p?.displayName ?? null,
        username: p?.username ?? null,
      };
    }),
    pendingRequests: pending.map((p) => {
      const prof = nameLookup.get(p.user_id);
      return {
        id: p.id,
        userId: p.user_id,
        note: p.note,
        createdAt: p.created_at,
        displayName: prof?.displayName ?? null,
        username: prof?.username ?? null,
      };
    }),
  };
}

// createCommunity — thin wrapper over the create_community RPC.
export async function createCommunity(input: {
  kind: CommunityKind;
  name: string;
  description?: string;
  handle?: string;
  visibility?: CommunityVisibility;
  joinPolicy?: CommunityJoinPolicy;
}): Promise<{ error: string } | { ok: true; id: string }> {
  if (!isCommunityKind(input.kind)) return { error: "Invalid kind." };
  const name = input.name.trim();
  if (name.length === 0 || name.length > 80) {
    return { error: "Name must be 1–80 characters." };
  }
  const description = input.description?.trim() ?? "";
  const handle = input.handle?.trim().toLowerCase() ?? "";
  if (handle && !/^[a-z0-9_-]{3,32}$/.test(handle)) {
    return {
      error:
        "Handle must be 3–32 characters, lowercase letters / digits / _ / -.",
    };
  }

  const visibility =
    input.visibility && ALLOWED_VISIBILITIES[input.kind].includes(input.visibility)
      ? input.visibility
      : ALLOWED_VISIBILITIES[input.kind][0];
  const joinPolicy =
    input.joinPolicy &&
    ALLOWED_JOIN_POLICIES[input.kind].includes(input.joinPolicy)
      ? input.joinPolicy
      : ALLOWED_JOIN_POLICIES[input.kind][0];

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase.rpc("create_community", {
    p_kind: input.kind,
    p_name: name,
    p_description: description,
    p_handle: handle,
    p_visibility: visibility,
    p_join_policy: joinPolicy,
  });
  if (error) {
    // 23505 = unique violation on handle
    if (error.code === "23505") {
      return { error: "That handle is already taken." };
    }
    return { error: error.message };
  }

  revalidatePath(`/friends/${input.kind}s`);
  return { ok: true, id: data as string };
}

// requestJoinCommunity — request or immediately join. Returns which
// happened so the client can render the right toast.
export async function requestJoinCommunity(
  communityId: string,
  note?: string
): Promise<
  { error: string } | { ok: true; result: "joined" | "requested" | "already_member" }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase.rpc("request_join_community", {
    p_community_id: communityId,
    p_note: note?.trim() ?? null,
  });
  if (error) return { error: error.message };
  revalidatePath("/friends");
  revalidatePath("/friends/groups");
  revalidatePath("/friends/clubs");
  revalidatePath("/friends/guilds");
  return {
    ok: true,
    result: data as "joined" | "requested" | "already_member",
  };
}

// decideJoinRequest — leader / co_leader approve or decline.
export async function decideJoinRequest(
  requestId: string,
  approve: boolean
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.rpc("decide_join_request", {
    p_request_id: requestId,
    p_approve: approve,
  });
  if (error) return { error: error.message };
  revalidatePath("/friends/groups");
  revalidatePath("/friends/clubs");
  revalidatePath("/friends/guilds");
  return { ok: true };
}

// leaveCommunity — pop own membership. Server enforces the last-leader
// guard.
export async function leaveCommunity(
  communityId: string
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.rpc("leave_community", {
    p_community_id: communityId,
  });
  if (error) return { error: error.message };
  revalidatePath("/friends/groups");
  revalidatePath("/friends/clubs");
  revalidatePath("/friends/guilds");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function countMembers(ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const supabase = await createClient();
  const { data } = await supabase
    .from("community_members")
    .select("community_id")
    .in("community_id", ids);
  const rows = (data ?? []) as Array<{ community_id: string }>;
  const counts = new Map<string, number>();
  for (const r of rows) {
    counts.set(r.community_id, (counts.get(r.community_id) ?? 0) + 1);
  }
  return counts;
}

async function lookupDisplayNames(
  userIds: string[]
): Promise<Map<string, { displayName: string | null; username: string | null }>> {
  const out = new Map<
    string,
    { displayName: string | null; username: string | null }
  >();
  if (userIds.length === 0) return out;
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, display_name, username")
    .in("id", userIds);
  for (const p of (data ?? []) as Array<{
    id: string;
    display_name: string | null;
    username: string | null;
  }>) {
    out.set(p.id, { displayName: p.display_name, username: p.username });
  }
  return out;
}
