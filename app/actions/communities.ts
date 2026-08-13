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
import type { SharedActivity, SharedInstance } from "@/app/actions/sharing";
import type { Rhythm } from "@/lib/validators/rhythm";
import { buildTagMap, computeTagUsage, type TagMap } from "@/lib/domain/tags";

/** How much of the community calendar members see (leadership-set). */
export type CommunityCalendarDisplay = "full" | "light";

/** Who may post in a community's chat (leadership-set). */
export type CommunityChatWhoCanSpeak = "everyone" | "leadership";

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
  /** The caller's own user id — lets the UI hide self-actions (kick/role). */
  myUserId: string;
  /** Leadership setting: how much of the calendar members see. */
  calendarDisplay: CommunityCalendarDisplay;
  /** Chat settings (Phase 4). */
  chatEnabled: boolean;
  chatWhoCanSpeak: CommunityChatWhoCanSpeak;
  /** Editable homepage content (null = none yet). */
  homeContent: string | null;
  /** Whether the member roster + count are shown on Home. */
  showMembers: boolean;
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
      "id, kind, name, handle, description, visibility, join_policy, created_at, calendar_display, chat_enabled, chat_who_can_speak, home_content, show_members"
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
    calendar_display: string | null;
    chat_enabled: boolean | null;
    chat_who_can_speak: string | null;
    home_content: string | null;
    show_members: boolean | null;
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
    myUserId: user.id,
    calendarDisplay: c.calendar_display === "full" ? "full" : "light",
    chatEnabled: c.chat_enabled ?? true,
    chatWhoCanSpeak: c.chat_who_can_speak === "leadership" ? "leadership" : "everyone",
    homeContent: c.home_content ?? null,
    showMembers: c.show_members ?? true,
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
  revalidatePath("/notifications");
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
// Phase 5 — discovery
// ---------------------------------------------------------------------------

/** A community surfaced through search / handle lookup (before joining). */
export type DiscoveredCommunity = {
  id: string;
  kind: CommunityKind;
  name: string;
  handle: string | null;
  description: string | null;
  visibility: CommunityVisibility;
  joinPolicy: CommunityJoinPolicy;
};

function mapDiscovered(r: {
  id: string;
  kind: string;
  name: string;
  handle: string | null;
  description: string | null;
  visibility: string;
  join_policy: string;
}): DiscoveredCommunity {
  return {
    id: r.id,
    kind: r.kind as CommunityKind,
    name: r.name,
    handle: r.handle,
    description: r.description,
    visibility: r.visibility as CommunityVisibility,
    joinPolicy: r.join_policy as CommunityJoinPolicy,
  };
}

// searchPublicCommunities — name/handle search over PUBLIC clubs/guilds
// (RLS already restricts SELECT to public + member communities, and we
// pin visibility=public here so private groups never leak).
export async function searchPublicCommunities(
  kind: CommunityKind,
  query: string
): Promise<DiscoveredCommunity[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Strip characters that would break PostgREST's or()/ilike filter syntax.
  const safe = query.replace(/[,()*%\\]/g, " ").trim();
  if (safe.length === 0) return [];
  const like = `%${safe}%`;

  const { data } = await supabase
    .from("communities")
    .select("id, kind, name, handle, description, visibility, join_policy")
    .eq("kind", kind)
    .eq("visibility", "public")
    .or(`name.ilike.${like},handle.ilike.${like}`)
    .order("name", { ascending: true })
    .limit(20);

  return (
    (data ?? []) as Array<Parameters<typeof mapDiscovered>[0]>
  ).map(mapDiscovered);
}

// findCommunityByHandle — exact-handle lookup, incl. private groups (via the
// SECURITY DEFINER RPC). Returns null if no community has that handle.
export async function findCommunityByHandle(
  handle: string
): Promise<DiscoveredCommunity | null> {
  const h = handle.trim();
  if (h.length === 0) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase.rpc("find_community_by_handle", {
    p_handle: h,
  });
  const rows = (data ?? []) as Array<Parameters<typeof mapDiscovered>[0]>;
  return rows.length > 0 ? mapDiscovered(rows[0]) : null;
}

// ---------------------------------------------------------------------------
// Phase 3 — community activities (calendar) + auto-add
// ---------------------------------------------------------------------------

// getCommunityActivities — the community's shared activities, returned in the
// SharedActivity shape so the friend-calendar components can render them
// verbatim. (Community activities have no share row: shareId reuses the
// activity id, and shareProgress is always true.)
export async function getCommunityActivities(
  communityId: string
): Promise<SharedActivity[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase.rpc("get_community_activities", {
    p_community_id: communityId,
  });
  const rows = (data ?? []) as Array<{
    activity_id: string;
    owner_id: string;
    owner_username: string | null;
    owner_display_name: string | null;
    name: string;
    notes: string | null;
    rhythm: Rhythm;
    priority: number;
    scheduled_times: string[] | null;
    scheduled_end_times: string[] | null;
    default_skill_tags: string[] | null;
    start_date: string;
    end_date: string | null;
    archived_at: string | null;
    added_at: string;
  }>;
  return rows.map((r) => ({
    shareId: r.activity_id,
    activityId: r.activity_id,
    ownerId: r.owner_id,
    ownerUsername: r.owner_username,
    ownerDisplayName: r.owner_display_name,
    shareProgress: true,
    name: r.name,
    notes: r.notes,
    rhythm: r.rhythm,
    priority: r.priority,
    scheduledTimes: r.scheduled_times ?? [],
    scheduledEndTimes: r.scheduled_end_times ?? [],
    defaultSkillTags: r.default_skill_tags ?? [],
    startDate: r.start_date,
    endDate: r.end_date,
    archivedAt: r.archived_at,
    createdAt: r.added_at,
  }));
}

// getCommunityInstances — occurrences of the community's shared activities in
// [from, to], in the SharedInstance shape (mirrors getSharedInstancesWithMe).
export async function getCommunityInstances(
  communityId: string,
  from: string,
  to: string
): Promise<SharedInstance[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase.rpc("get_community_instances", {
    p_community_id: communityId,
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

// addCommunityActivity — leadership links one of their own activities in.
export async function addCommunityActivity(
  communityId: string,
  activityId: string
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.rpc("add_community_activity", {
    p_community_id: communityId,
    p_activity_id: activityId,
  });
  if (error) return { error: error.message };
  revalidateCommunityPaths();
  return { ok: true };
}

// removeCommunityActivity — leadership unlinks an activity.
export async function removeCommunityActivity(
  communityId: string,
  activityId: string
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.rpc("remove_community_activity", {
    p_community_id: communityId,
    p_activity_id: activityId,
  });
  if (error) return { error: error.message };
  revalidateCommunityPaths();
  return { ok: true };
}

// setCommunityCalendarDisplay — leadership set how much of the calendar
// members see ('full' | 'light').
export async function setCommunityCalendarDisplay(
  communityId: string,
  mode: CommunityCalendarDisplay
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.rpc("set_community_calendar_display", {
    p_community_id: communityId,
    p_mode: mode,
  });
  if (error) return { error: error.message };
  revalidateCommunityPaths();
  return { ok: true };
}

// getAutoAddPref — whether the caller has auto-add enabled for a community.
export async function getAutoAddPref(communityId: string): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("community_auto_add_prefs")
    .select("auto_add")
    .eq("community_id", communityId)
    .eq("user_id", user.id)
    .maybeSingle();
  return Boolean((data as { auto_add?: boolean } | null)?.auto_add);
}

// setAutoAdd — the caller opts in/out of auto-adding this community's new
// activities to their own schedule. Written directly (RLS gates to own row).
export async function setAutoAdd(
  communityId: string,
  on: boolean
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.from("community_auto_add_prefs").upsert(
    { community_id: communityId, user_id: user.id, auto_add: on },
    { onConflict: "community_id,user_id" }
  );
  if (error) return { error: error.message };
  return { ok: true };
}

// getCommunityActivityBundle — everything the Activities section of a
// community needs in one round of fetches: the shared activities, the
// caller's auto-add pref, the caller's OWN activities (for the leadership
// "+ Add" picker), and the tag palette (for tag chips).
export type CommunityActivityBundle = {
  activities: SharedActivity[];
  /** Occurrences of the shared activities in a rolling window, for the Full
   *  calendar render. */
  instances: SharedInstance[];
  autoAdd: boolean;
  myActivities: Array<{ id: string; name: string }>;
  tagMap: TagMap;
  /** Caller's "today" in their own timezone (anchors the calendar). */
  todayStr: string;
};

// How many days each way the Full community calendar loads occurrences for.
const COMMUNITY_CAL_WINDOW = 35;

export async function getCommunityActivityBundle(
  communityId: string
): Promise<CommunityActivityBundle> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [activities, autoAdd, myActsRes, tagRes, actTagRes, profRes] =
    await Promise.all([
      getCommunityActivities(communityId),
      getAutoAddPref(communityId),
      supabase
        .from("activities")
        .select("id, name")
        .eq("user_id", user.id)
        .is("archived_at", null)
        .order("name", { ascending: true }),
      supabase.from("tags").select("id, name, color").is("archived_at", null),
      supabase
        .from("activities")
        .select("default_skill_tags")
        .is("archived_at", null),
      supabase.from("profiles").select("timezone").eq("id", user.id).maybeSingle(),
    ]);

  const tz = (profRes.data as { timezone?: string } | null)?.timezone ?? "UTC";
  const todayStr = todayInTimeZone(tz);
  const instances = await getCommunityInstances(
    communityId,
    shiftYmd(todayStr, -COMMUNITY_CAL_WINDOW),
    shiftYmd(todayStr, COMMUNITY_CAL_WINDOW)
  );

  const usageByName = computeTagUsage(
    (actTagRes.data ?? []) as Array<{ default_skill_tags: string[] | null }>
  );
  const tagMap = buildTagMap(
    (tagRes.data ?? []) as Array<{ id: string; name: string; color: string }>,
    usageByName
  );

  return {
    activities,
    instances,
    autoAdd,
    myActivities: (myActsRes.data ?? []) as Array<{ id: string; name: string }>,
    tagMap,
    todayStr,
  };
}

// Local date helpers (mirror the dashboard's timezone-correct "today").
function todayInTimeZone(tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

// ---------------------------------------------------------------------------
// Phase 4 — community settings (member management, admittance, chat)
// ---------------------------------------------------------------------------

async function callSettingsRpc(
  fn: string,
  args: Record<string, unknown>
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { error } = await supabase.rpc(fn, args);
  if (error) return { error: error.message };
  revalidateCommunityPaths();
  return { ok: true };
}

// setMemberRole — leadership promote/demote a member (leader/co_leader/member).
export async function setMemberRole(
  communityId: string,
  userId: string,
  role: CommunityRole
): Promise<{ error: string } | { ok: true }> {
  return callSettingsRpc("set_member_role", {
    p_community_id: communityId,
    p_user_id: userId,
    p_role: role,
  });
}

// kickMember — leadership remove a (non-leader) member.
export async function kickMember(
  communityId: string,
  userId: string
): Promise<{ error: string } | { ok: true }> {
  return callSettingsRpc("kick_member", {
    p_community_id: communityId,
    p_user_id: userId,
  });
}

// setCommunityJoinPolicy — leadership change how people join.
export async function setCommunityJoinPolicy(
  communityId: string,
  policy: CommunityJoinPolicy
): Promise<{ error: string } | { ok: true }> {
  return callSettingsRpc("set_community_join_policy", {
    p_community_id: communityId,
    p_policy: policy,
  });
}

// setCommunityVisibility — leadership change public/private.
export async function setCommunityVisibility(
  communityId: string,
  visibility: CommunityVisibility
): Promise<{ error: string } | { ok: true }> {
  return callSettingsRpc("set_community_visibility", {
    p_community_id: communityId,
    p_visibility: visibility,
  });
}

// setCommunityHome — leadership edit the homepage content.
export async function setCommunityHome(
  communityId: string,
  content: string
): Promise<{ error: string } | { ok: true }> {
  return callSettingsRpc("set_community_home", {
    p_community_id: communityId,
    p_content: content,
  });
}

// setCommunityShowMembers — leadership toggle member-roster visibility.
export async function setCommunityShowMembers(
  communityId: string,
  show: boolean
): Promise<{ error: string } | { ok: true }> {
  return callSettingsRpc("set_community_show_members", {
    p_community_id: communityId,
    p_show: show,
  });
}

// setCommunityChatSettings — leadership enable the chat + set who can speak.
export async function setCommunityChatSettings(
  communityId: string,
  enabled: boolean,
  whoCanSpeak: CommunityChatWhoCanSpeak
): Promise<{ error: string } | { ok: true }> {
  return callSettingsRpc("set_community_chat_settings", {
    p_community_id: communityId,
    p_enabled: enabled,
    p_who_can_speak: whoCanSpeak,
  });
}

function revalidateCommunityPaths() {
  revalidatePath("/friends/groups");
  revalidatePath("/friends/clubs");
  revalidatePath("/friends/guilds");
}

// ---------------------------------------------------------------------------
// Phase 6 — invites
// ---------------------------------------------------------------------------

export type PendingInvite = {
  id: string;
  communityId: string;
  communityName: string;
  communityKind: CommunityKind;
  invitedByName: string | null;
  createdAt: string;
};

// inviteToCommunity — leadership invite a user by username.
export async function inviteToCommunity(
  communityId: string,
  username: string
): Promise<{ error: string } | { ok: true }> {
  const u = username.trim().replace(/^@/, "");
  if (u.length === 0) return { error: "Enter a username." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.rpc("invite_to_community", {
    p_community_id: communityId,
    p_username: u,
  });
  if (error) return { error: error.message };
  revalidateCommunityPaths();
  return { ok: true };
}

// respondToInvite — the invitee accepts (joins) or declines.
export async function respondToInvite(
  inviteId: string,
  accept: boolean
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.rpc("respond_to_invite", {
    p_invite_id: inviteId,
    p_accept: accept,
  });
  if (error) return { error: error.message };
  revalidatePath("/notifications");
  revalidateCommunityPaths();
  return { ok: true };
}

// getMyPendingInvites — the caller's pending community invites (for the
// Notifications page + badge).
export async function getMyPendingInvites(): Promise<PendingInvite[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase.rpc("get_my_pending_invites");
  const rows = (data ?? []) as Array<{
    id: string;
    community_id: string;
    community_name: string;
    community_kind: string;
    invited_by_name: string | null;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    communityId: r.community_id,
    communityName: r.community_name,
    communityKind: r.community_kind as CommunityKind,
    invitedByName: r.invited_by_name,
    createdAt: r.created_at,
  }));
}

// ---------------------------------------------------------------------------
// Phase 6b — leadership-side request + invite administration
// ---------------------------------------------------------------------------

export type IncomingJoinRequest = {
  id: string;
  communityId: string;
  communityName: string;
  communityKind: CommunityKind;
  requesterName: string | null;
  note: string | null;
  createdAt: string;
};

// getIncomingJoinRequests — pending join requests to every community the
// caller leads (for the Notifications page + badge).
export async function getIncomingJoinRequests(): Promise<IncomingJoinRequest[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase.rpc("get_my_incoming_join_requests");
  const rows = (data ?? []) as Array<{
    id: string;
    community_id: string;
    community_name: string;
    community_kind: string;
    requester_name: string | null;
    note: string | null;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    communityId: r.community_id,
    communityName: r.community_name,
    communityKind: r.community_kind as CommunityKind,
    requesterName: r.requester_name,
    note: r.note,
    createdAt: r.created_at,
  }));
}

export type CommunityPendingInvite = {
  id: string;
  inviteeName: string | null;
  createdAt: string;
};

// getCommunityPendingInvites — the community's outstanding invites
// (leadership-gated server-side).
export async function getCommunityPendingInvites(
  communityId: string
): Promise<CommunityPendingInvite[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase.rpc("get_community_pending_invites", {
    p_community_id: communityId,
  });
  const rows = (data ?? []) as Array<{
    id: string;
    invitee_name: string | null;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    inviteeName: r.invitee_name,
    createdAt: r.created_at,
  }));
}

// cancelCommunityInvite — leadership withdraws a pending invite.
export async function cancelCommunityInvite(
  inviteId: string
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.rpc("cancel_community_invite", {
    p_invite_id: inviteId,
  });
  if (error) return { error: error.message };
  revalidateCommunityPaths();
  return { ok: true };
}

export type RequestOutcome = {
  id: string;
  communityId: string;
  communityName: string;
  communityKind: CommunityKind;
  status: "approved" | "declined";
  handledAt: string | null;
};

// getMyRequestOutcomes — the caller's approved/declined join requests that
// they haven't dismissed yet (for the Notifications page + badge).
export async function getMyRequestOutcomes(): Promise<RequestOutcome[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase.rpc("get_my_request_outcomes");
  const rows = (data ?? []) as Array<{
    id: string;
    community_id: string;
    community_name: string;
    community_kind: string;
    status: string;
    handled_at: string | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    communityId: r.community_id,
    communityName: r.community_name,
    communityKind: r.community_kind as CommunityKind,
    status: r.status === "approved" ? "approved" : "declined",
    handledAt: r.handled_at,
  }));
}

// dismissRequestOutcome — the requester clears one outcome from their feed.
export async function dismissRequestOutcome(
  requestId: string
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.rpc("dismiss_request_outcome", {
    p_request_id: requestId,
  });
  if (error) return { error: error.message };
  revalidatePath("/notifications");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Phase 7 — community chat
// ---------------------------------------------------------------------------

export type CommunityMessage = {
  id: string;
  senderId: string | null;
  kind: "message" | "system";
  body: string;
  createdAt: string;
  senderDisplayName: string | null;
  senderUsername: string | null;
};

// getCommunityMessages — the chat log (members only, via RLS). System
// notices come back with senderId null and kind='system'.
export async function getCommunityMessages(
  communityId: string
): Promise<CommunityMessage[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("community_messages")
    .select("id, sender_id, kind, body, created_at")
    .eq("community_id", communityId)
    .order("created_at", { ascending: true })
    .limit(500);

  const rows = (data ?? []) as Array<{
    id: string;
    sender_id: string | null;
    kind: string;
    body: string;
    created_at: string;
  }>;
  const senderIds = Array.from(
    new Set(rows.map((r) => r.sender_id).filter((x): x is string => Boolean(x)))
  );
  const names = await lookupDisplayNames(senderIds);

  return rows.map((r) => {
    const p = r.sender_id ? names.get(r.sender_id) : undefined;
    return {
      id: r.id,
      senderId: r.sender_id,
      kind: r.kind === "system" ? "system" : "message",
      body: r.body,
      createdAt: r.created_at,
      senderDisplayName: p?.displayName ?? null,
      senderUsername: p?.username ?? null,
    };
  });
}

// postCommunityMessage — post a human message (RPC enforces chat_enabled +
// who_can_speak + membership).
export async function postCommunityMessage(
  communityId: string,
  body: string
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.rpc("post_community_message", {
    p_community_id: communityId,
    p_body: body,
  });
  if (error) return { error: error.message };
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
