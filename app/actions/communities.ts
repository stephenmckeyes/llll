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
  normalizePermissions,
  resolvePermissions,
  type CommunityJoinPolicy,
  type CommunityKind,
  type CommunityPermissions,
  type CommunityRank,
  type CommunityVisibility,
} from "@/lib/domain/community";
import type {
  YearCountsByDate,
  MonthBannersByDate,
} from "@/app/actions/calendar-fetch";
import type { MonthBanner } from "@/app/_components/month-cell";
import type { SharedActivity, SharedInstance } from "@/app/actions/sharing";
import { generateInstances } from "@/lib/domain/rhythms";
import { rhythmSchema, type Rhythm } from "@/lib/validators/rhythm";
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
  /** Fixed role ("leader"|"co_leader"|"member") or a custom "rank:<id>". */
  myRole: string | null;
  memberCount: number;
};

export type CommunityMember = {
  userId: string;
  /** Fixed role or a custom "rank:<id>" (migration 0051). */
  role: string;
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
  /** Public-community outsider preview flags (migration 0054). */
  outsiderShowMembers: boolean;
  outsiderShowActivities: boolean;
  /** Custom ranks defined for this community (migration 0051). */
  ranks: CommunityRank[];
  /** The caller's effective permissions (leadership → all true). */
  myPermissions: CommunityPermissions;
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
    myRole: roleById.get(c.id) ?? "member",
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
      "id, kind, name, handle, description, visibility, join_policy, created_at, calendar_display, chat_enabled, chat_who_can_speak, home_content, show_members, outsider_visibility"
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
    outsider_visibility: Record<string, unknown> | null;
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

  // Ranks — members only (the RPC gates on membership). Non-members of a
  // public club get an empty list.
  let ranks: CommunityRank[] = [];
  if (myRow) {
    const { data: rankRows } = await supabase.rpc("get_community_ranks", {
      p_community_id: communityId,
    });
    ranks = ((rankRows ?? []) as Array<{
      id: string;
      name: string;
      sort_order: number;
      permissions: Record<string, unknown> | null;
    }>).map((r) => ({
      id: r.id,
      name: r.name,
      sortOrder: r.sort_order,
      permissions: normalizePermissions(r.permissions),
    }));
  }
  const myPermissions = resolvePermissions(myRow?.role ?? null, ranks);

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
    outsiderShowMembers: c.outsider_visibility?.showMembers === true,
    outsiderShowActivities: c.outsider_visibility?.showActivities === true,
    ranks,
    myPermissions,
    myRole: myRow?.role ?? null,
    memberCount: members.length,
    members: members.map((m) => {
      const p = nameLookup.get(m.user_id);
      return {
        userId: m.user_id,
        role: m.role,
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

export type CommunityPreview = {
  id: string;
  name: string;
  description: string | null;
  handle: string | null;
  kind: CommunityKind;
  joinPolicy: CommunityJoinPolicy;
  visibility: CommunityVisibility;
  memberCount: number;
  isMember: boolean;
  showMembers: boolean;
  showActivities: boolean;
  members: Array<{
    displayName: string | null;
    username: string | null;
    role: string;
  }>;
  activities: Array<{ name: string }>;
};

// getCommunityPreview — the discovery preview for a (public) community,
// respecting its outsider_visibility flags. Null for private communities the
// caller isn't in. Members always get the full picture.
export async function getCommunityPreview(
  communityId: string
): Promise<CommunityPreview | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase.rpc("get_community_preview", {
    p_community_id: communityId,
  });
  if (!data) return null;
  const p = data as {
    id: string;
    name: string;
    description: string | null;
    handle: string | null;
    kind: string;
    join_policy: string;
    visibility: string;
    member_count: number;
    is_member: boolean;
    show_members: boolean;
    show_activities: boolean;
    members: Array<{
      display_name: string | null;
      username: string | null;
      role: string;
    }>;
    activities: Array<{ name: string }>;
  };
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    handle: p.handle,
    kind: p.kind as CommunityKind,
    joinPolicy: p.join_policy as CommunityJoinPolicy,
    visibility: p.visibility as CommunityVisibility,
    memberCount: p.member_count,
    isMember: p.is_member,
    showMembers: p.show_members,
    showActivities: p.show_activities,
    members: (p.members ?? []).map((m) => ({
      displayName: m.display_name,
      username: m.username,
      role: m.role,
    })),
    activities: p.activities ?? [],
  };
}

// ---------------------------------------------------------------------------
// Auto-add notices (kept). The member-share/copy/auto-add model — leadership
// linking members' personal activities into the community + fanning copies
// out to opted-in members — was REMOVED from the community Calendar tab (it's
// community-owned only now). The link/unlink + auto-add-pref + calendar-
// display server actions that drove it were deleted with it. The auto-add
// EVENT feed below is still read by /notifications (nothing emits new events
// today; kept until that surface is retired). Their backing tables/RPCs
// (community_activities, community_auto_add_prefs, get/set_* ) remain in the
// DB, now unused — safe to drop in a later migration if desired.
// ---------------------------------------------------------------------------

export type AutoAddEvent = {
  id: string;
  communityId: string;
  communityName: string;
  communityKind: CommunityKind;
  activityName: string;
  createdAt: string;
};

// getMyAutoAddEvents — undismissed "an activity was auto-added" notices for
// the caller (for /notifications + the badge).
export async function getMyAutoAddEvents(): Promise<AutoAddEvent[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase.rpc("get_my_auto_add_events");
  const rows = (data ?? []) as Array<{
    id: string;
    community_id: string;
    community_name: string;
    community_kind: string;
    activity_name: string;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    communityId: r.community_id,
    communityName: r.community_name,
    communityKind: r.community_kind as CommunityKind,
    activityName: r.activity_name,
    createdAt: r.created_at,
  }));
}

// dismissAutoAddEvent — clear one auto-add notice from the caller's feed.
export async function dismissAutoAddEvent(
  eventId: string
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.rpc("dismiss_auto_add_event", {
    p_event_id: eventId,
  });
  if (error) return { error: error.message };
  revalidatePath("/notifications");
  return { ok: true };
}

// getCommunityActivityBundle — everything the community's own Calendar tab
// needs in one round of fetches: the community-owned activities + their
// occurrences (in the SharedActivity/SharedInstance shape the calendar
// renders), plus the tag palette and the caller's "today".
export type CommunityActivityBundle = {
  /** The community's OWN activities + occurrences (migration 0056), in the
   *  SharedActivity/SharedInstance shape so the calendar renders them. */
  ownedActivities: SharedActivity[];
  ownedInstances: SharedInstance[];
  /** Archived community-owned activities (for the manage/archived list). */
  archivedActivities: SharedActivity[];
  tagMap: TagMap;
  /** Caller's "today" in their own timezone (anchors the calendar). */
  todayStr: string;
};

// How many days each way the community calendar loads occurrences for.
const COMMUNITY_CAL_WINDOW = 35;

export async function getCommunityActivityBundle(
  communityId: string
): Promise<CommunityActivityBundle> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [tagRes, actTagRes, profRes] = await Promise.all([
    supabase.from("tags").select("id, name, color").is("archived_at", null),
    supabase
      .from("activities")
      .select("default_skill_tags")
      .is("archived_at", null),
    supabase.from("profiles").select("timezone").eq("id", user.id).maybeSingle(),
  ]);

  const tz = (profRes.data as { timezone?: string } | null)?.timezone ?? "UTC";
  const todayStr = todayInTimeZone(tz);
  const windowFrom = shiftYmd(todayStr, -COMMUNITY_CAL_WINDOW);
  const windowTo = shiftYmd(todayStr, COMMUNITY_CAL_WINDOW);

  // Top up the community's own occurrences before reading the window.
  await backfillCommunityCalendar(communityId, todayStr);
  const owned = await getCommunityOwnedBundle(communityId, windowFrom, windowTo);

  const usageByName = computeTagUsage(
    (actTagRes.data ?? []) as Array<{ default_skill_tags: string[] | null }>
  );
  const tagMap = buildTagMap(
    (tagRes.data ?? []) as Array<{ id: string; name: string; color: string }>,
    usageByName
  );

  return {
    ownedActivities: owned.activities,
    ownedInstances: owned.instances,
    archivedActivities: owned.archived,
    tagMap,
    todayStr,
  };
}

// ---------------------------------------------------------------------------
// Community-owned calendar (migration 0056) — the community's OWN activities
// + occurrences with collective completion. Reads are mapped into the
// SharedActivity/SharedInstance shapes so the existing calendar renders them.
// ---------------------------------------------------------------------------

// How far ahead to materialize a community activity's occurrences.
const COMMUNITY_OWNED_HORIZON_DAYS = 400;

type OwnedActivityRow = {
  id: string;
  community_id: string;
  name: string;
  notes: string | null;
  rhythm: Rhythm;
  scheduled_times: string[] | null;
  scheduled_end_times: string[] | null;
  priority: number | null;
  default_skill_tags: string[] | null;
  start_date: string;
  end_date: string | null;
  auto_resolve: boolean | null;
  completion_type: string | null;
  reminders: Array<{ days: number; hours: number; minutes: number }> | null;
  track_on_grid: boolean | null;
  pinned: boolean | null;
  rollover_missed_days: boolean | null;
  rollover_change_rhythm: boolean | null;
  created_at: string;
  archived_at: string | null;
};

function mapOwnedActivity(r: OwnedActivityRow): SharedActivity {
  return {
    shareId: r.id,
    activityId: r.id,
    ownerId: r.community_id,
    ownerUsername: null,
    ownerDisplayName: null,
    shareProgress: true,
    name: r.name,
    notes: r.notes,
    rhythm: r.rhythm,
    priority: r.priority ?? 2,
    scheduledTimes: r.scheduled_times ?? [],
    scheduledEndTimes: r.scheduled_end_times ?? [],
    defaultSkillTags: r.default_skill_tags ?? [],
    startDate: r.start_date,
    endDate: r.end_date,
    autoResolve: r.auto_resolve ?? false,
    completionType: r.completion_type === "aggregate" ? "aggregate" : "collective",
    reminders: r.reminders ?? [],
    trackOnGrid: r.track_on_grid ?? false,
    pinned: r.pinned ?? false,
    rolloverMissedDays: r.rollover_missed_days ?? false,
    rolloverChangeRhythm: r.rollover_change_rhythm ?? false,
    archivedAt: r.archived_at,
    createdAt: r.created_at,
  };
}

// getCommunityOwnedBundle — the community's own activities + their occurrences
// in [from, to], mapped to the shared shapes. Members only (RLS).
async function getCommunityOwnedBundle(
  communityId: string,
  from: string,
  to: string
): Promise<{
  activities: SharedActivity[];
  instances: SharedInstance[];
  archived: SharedActivity[];
}> {
  const supabase = await createClient();

  const { data: actRows } = await supabase
    .from("community_owned_activities")
    .select(
      "id, community_id, name, notes, rhythm, scheduled_times, scheduled_end_times, priority, default_skill_tags, start_date, end_date, auto_resolve, completion_type, reminders, track_on_grid, pinned, rollover_missed_days, rollover_change_rhythm, created_at, archived_at"
    )
    .eq("community_id", communityId)
    .order("name", { ascending: true });
  const allActs = (actRows ?? []) as OwnedActivityRow[];
  const acts = allActs.filter((a) => a.archived_at === null);
  const archived = allActs
    .filter((a) => a.archived_at !== null)
    .map(mapOwnedActivity);
  const activities = acts.map(mapOwnedActivity);
  if (activities.length === 0) return { activities: [], instances: [], archived };

  const activeIds = new Set(acts.map((a) => a.id));
  const { data: instRows } = await supabase
    .from("community_owned_instances")
    .select("id, activity_id, scheduled_for, status, comment")
    .eq("community_id", communityId)
    .gte("scheduled_for", from)
    .lte("scheduled_for", to);
  const instances: SharedInstance[] = ((instRows ?? []) as Array<{
    id: string;
    activity_id: string;
    scheduled_for: string;
    status: string;
    comment: string | null;
  }>)
    .filter((i) => activeIds.has(i.activity_id))
    .map((i) => ({
      ownerId: communityId,
      activityId: i.activity_id,
      instanceId: i.id,
      scheduledFor: i.scheduled_for,
      status:
        i.status === "completed" || i.status === "missed"
          ? (i.status as "completed" | "missed")
          : "pending",
      completionCount: i.status === "completed" ? 1 : 0,
      completionDates: [],
      comment: i.comment,
    }));
  return { activities, instances, archived };
}

// getCommunityYearCounts — per-day {pending, completed} for one year of the
// community's OWN occurrences (for the rich mini-month Year view). Members
// only (RLS). Archived activities excluded.
export async function getCommunityYearCounts(
  communityId: string,
  yearStart: string
): Promise<YearCountsByDate> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const year = yearStart.slice(0, 4);
  const { data: actRows } = await supabase
    .from("community_owned_activities")
    .select("id")
    .eq("community_id", communityId)
    .is("archived_at", null);
  const ids = new Set(((actRows ?? []) as Array<{ id: string }>).map((a) => a.id));
  if (ids.size === 0) return {};

  const { data: instRows } = await supabase
    .from("community_owned_instances")
    .select("scheduled_for, status, activity_id")
    .eq("community_id", communityId)
    .gte("scheduled_for", `${year}-01-01`)
    .lte("scheduled_for", `${year}-12-31`);

  const result: YearCountsByDate = {};
  for (const r of (instRows ?? []) as Array<{
    scheduled_for: string;
    status: string;
    activity_id: string;
  }>) {
    if (!ids.has(r.activity_id)) continue;
    const cur = result[r.scheduled_for] ?? { pending: 0, completed: 0 };
    if (r.status === "completed") cur.completed += 1;
    else cur.pending += 1;
    result[r.scheduled_for] = cur;
  }
  return result;
}

// getCommunityMonthBanners — per-day activity-name banners for one month's
// 6-week grid of the community's OWN occurrences (for the endless-scroll
// Month view, mirroring the personal fetchMonthActivities loader). Members
// only (RLS). Archived activities excluded.
export async function getCommunityMonthBanners(
  communityId: string,
  monthKey: string
): Promise<MonthBannersByDate> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Cover the whole 42-cell grid: pad the month by a week on each side so
  // the leading/trailing days from adjacent months are populated too.
  const monthStart = monthKey.slice(0, 10); // "YYYY-MM-01"
  const [y, m] = monthStart.split("-").map(Number);
  const monthEnd = `${y}-${String(m).padStart(2, "0")}-${String(
    new Date(y, m, 0).getDate()
  ).padStart(2, "0")}`;
  const from = shiftYmd(monthStart, -7);
  const to = shiftYmd(monthEnd, 7);

  const { data: actRows } = await supabase
    .from("community_owned_activities")
    .select("id, name, default_skill_tags")
    .eq("community_id", communityId)
    .is("archived_at", null);
  const acts = (actRows ?? []) as Array<{
    id: string;
    name: string;
    default_skill_tags: string[] | null;
  }>;
  if (acts.length === 0) return {};
  const actMap = new Map(acts.map((a) => [a.id, a]));

  const { data: instRows } = await supabase
    .from("community_owned_instances")
    .select("id, activity_id, scheduled_for, status")
    .eq("community_id", communityId)
    .gte("scheduled_for", from)
    .lte("scheduled_for", to);

  const result: MonthBannersByDate = {};
  for (const r of (instRows ?? []) as Array<{
    id: string;
    activity_id: string;
    scheduled_for: string;
    status: string;
  }>) {
    const act = actMap.get(r.activity_id);
    if (!act) continue;
    const banner: MonthBanner = {
      id: r.id,
      name: act.name,
      status:
        r.status === "completed" || r.status === "missed"
          ? r.status
          : "pending",
      tags: act.default_skill_tags ?? [],
    };
    (result[r.scheduled_for] ??= []).push(banner);
  }
  // Stable order within a day: by activity name (matches the personal
  // loader's name-sorted activity fetch).
  for (const k of Object.keys(result)) {
    result[k].sort((a, b) => a.name.localeCompare(b.name));
  }
  return result;
}

// backfillCommunityCalendar — extend each owned activity's occurrences up to
// the horizon. Idempotent (insert RPC does ON CONFLICT DO NOTHING).
async function backfillCommunityCalendar(
  communityId: string,
  todayStr: string
): Promise<void> {
  const supabase = await createClient();
  const { data: actRows } = await supabase
    .from("community_owned_activities")
    .select("id, rhythm, start_date, end_date")
    .eq("community_id", communityId)
    .is("archived_at", null);
  const acts = (actRows ?? []) as Array<{
    id: string;
    rhythm: Rhythm;
    start_date: string;
    end_date: string | null;
  }>;
  if (acts.length === 0) return;

  const horizon = shiftYmd(todayStr, COMMUNITY_OWNED_HORIZON_DAYS);
  for (const a of acts) {
    const from = a.start_date > todayStr ? a.start_date : todayStr;
    const to = a.end_date && a.end_date < horizon ? a.end_date : horizon;
    if (from > to) continue;
    let dates: string[] = [];
    try {
      dates = generateInstances(a.rhythm, { from, to }).map((i) => i.scheduledFor);
    } catch {
      continue;
    }
    if (dates.length === 0) continue;
    await supabase.rpc("insert_community_instances", {
      p_activity_id: a.id,
      p_dates: dates,
    });
  }
}

// createCommunityCalendarActivity — define a community-owned activity and
// materialize its occurrences. Gated by can_add_activities server-side.
export async function createCommunityCalendarActivity(input: {
  communityId: string;
  name: string;
  notes?: string;
  rhythm: Rhythm;
  scheduledTimes?: string[];
  scheduledEndTimes?: string[];
  priority?: number;
  tags?: string[];
  startDate: string;
  endDate?: string | null;
  autoResolve?: boolean;
  completionType?: "collective" | "aggregate";
  reminders?: Array<{ days: number; hours: number; minutes: number }>;
  trackOnGrid?: boolean;
  pinned?: boolean;
  rolloverMissedDays?: boolean;
  rolloverChangeRhythm?: boolean;
}): Promise<{ error: string } | { ok: true; id: string }> {
  const name = input.name.trim();
  if (name.length === 0 || name.length > 120) {
    return { error: "Name must be 1–120 characters." };
  }
  const parsed = rhythmSchema.safeParse(input.rhythm);
  if (!parsed.success) return { error: "Please pick a valid rhythm." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: id, error } = await supabase.rpc("create_community_activity", {
    p_community_id: input.communityId,
    p_name: name,
    p_notes: input.notes ?? null,
    p_rhythm: parsed.data,
    p_scheduled_times: input.scheduledTimes ?? [],
    p_scheduled_end_times: input.scheduledEndTimes ?? [],
    p_priority: input.priority ?? 2,
    p_tags: input.tags ?? [],
    p_start_date: input.startDate,
    p_end_date: input.endDate ?? null,
    p_auto_resolve: input.autoResolve ?? false,
    p_completion_type: input.completionType ?? "collective",
    p_reminders: input.reminders ?? [],
    p_track_on_grid: input.trackOnGrid ?? false,
    p_pinned: input.pinned ?? false,
    p_rollover_missed_days: input.rolloverMissedDays ?? false,
    p_rollover_change_rhythm: input.rolloverChangeRhythm ?? false,
  });
  if (error) return { error: error.message };

  // Materialize occurrences from start_date to the horizon (capped by end).
  const todayStr = new Date().toISOString().slice(0, 10);
  const horizon = shiftYmd(todayStr, COMMUNITY_OWNED_HORIZON_DAYS);
  const to =
    input.endDate && input.endDate < horizon ? input.endDate : horizon;
  if (input.startDate <= to) {
    try {
      const dates = generateInstances(parsed.data, {
        from: input.startDate,
        to,
      }).map((i) => i.scheduledFor);
      if (dates.length > 0) {
        await supabase.rpc("insert_community_instances", {
          p_activity_id: id as string,
          p_dates: dates,
        });
      }
    } catch {
      // Activity created; instances can be topped up on next view.
    }
  }
  revalidateCommunityPaths();
  return { ok: true, id: id as string };
}

// updateCommunityCalendarActivity — edit a community-owned activity. The RPC
// clears future pending occurrences; we then re-materialize from today.
export async function updateCommunityCalendarActivity(input: {
  activityId: string;
  name: string;
  notes?: string;
  rhythm: Rhythm;
  scheduledTimes?: string[];
  scheduledEndTimes?: string[];
  priority?: number;
  tags?: string[];
  startDate: string;
  endDate?: string | null;
  autoResolve?: boolean;
  completionType?: "collective" | "aggregate";
  reminders?: Array<{ days: number; hours: number; minutes: number }>;
  trackOnGrid?: boolean;
  pinned?: boolean;
  rolloverMissedDays?: boolean;
  rolloverChangeRhythm?: boolean;
}): Promise<{ error: string } | { ok: true }> {
  const name = input.name.trim();
  if (name.length === 0 || name.length > 120) {
    return { error: "Name must be 1–120 characters." };
  }
  const parsed = rhythmSchema.safeParse(input.rhythm);
  if (!parsed.success) return { error: "Please pick a valid rhythm." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.rpc("update_community_activity", {
    p_activity_id: input.activityId,
    p_name: name,
    p_notes: input.notes ?? null,
    p_rhythm: parsed.data,
    p_scheduled_times: input.scheduledTimes ?? [],
    p_scheduled_end_times: input.scheduledEndTimes ?? [],
    p_priority: input.priority ?? 2,
    p_tags: input.tags ?? [],
    p_start_date: input.startDate,
    p_end_date: input.endDate ?? null,
    p_auto_resolve: input.autoResolve ?? false,
    p_completion_type: input.completionType ?? "collective",
    p_reminders: input.reminders ?? [],
    p_track_on_grid: input.trackOnGrid ?? false,
    p_pinned: input.pinned ?? false,
    p_rollover_missed_days: input.rolloverMissedDays ?? false,
    p_rollover_change_rhythm: input.rolloverChangeRhythm ?? false,
  });
  if (error) return { error: error.message };

  // Re-materialize from max(start, today) to the horizon (ON CONFLICT skips
  // any surviving completed/missed history).
  const todayStr = new Date().toISOString().slice(0, 10);
  const from = input.startDate > todayStr ? input.startDate : todayStr;
  const horizon = shiftYmd(todayStr, COMMUNITY_OWNED_HORIZON_DAYS);
  const to =
    input.endDate && input.endDate < horizon ? input.endDate : horizon;
  if (from <= to) {
    try {
      const dates = generateInstances(parsed.data, { from, to }).map(
        (i) => i.scheduledFor
      );
      if (dates.length > 0) {
        await supabase.rpc("insert_community_instances", {
          p_activity_id: input.activityId,
          p_dates: dates,
        });
      }
    } catch {
      // Non-fatal: occurrences top up on next view.
    }
  }
  revalidateCommunityPaths();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// FormData wrappers — let the community calendar reuse the SAME shared
// ActivityFormFields component the personal edit-rhythm modal uses. The
// component submits via native <form> FormData (hidden inputs + name
// attributes); these actions parse that FormData into the object shape the
// create/update actions above expect, so there's one form body for both
// surfaces. Bound with communityId / activityId at the call site and driven
// by useActionState. Fields that don't apply to communities (pinned,
// streaks, reminders, rollover, priority) are hidden by the form and simply
// ignored here.
// ---------------------------------------------------------------------------

type CommunityActivityFormResult = { error: string } | { ok: true } | null;

// Parse the shared form's FormData into the create/update input shape.
// Mirrors createActivity's rhythm + times parsing (multi-time Daily →
// frequency), minus the personal-only fields.
function parseCommunityActivityForm(formData: FormData):
  | {
      name: string;
      notes?: string;
      rhythm: Rhythm;
      scheduledTimes: string[];
      scheduledEndTimes: string[];
      tags: string[];
      startDate: string;
      endDate: string | null;
      autoResolve: boolean;
      completionType: "collective" | "aggregate";
      reminders: Array<{ days: number; hours: number; minutes: number }>;
      trackOnGrid: boolean;
      pinned: boolean;
      rolloverMissedDays: boolean;
      rolloverChangeRhythm: boolean;
    }
  | { error: string } {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Activity name is required." };
  if (name.length > 120) return { error: "Name is too long (max 120)." };

  const notesRaw = String(formData.get("notes") ?? "").trim();
  const tags = Array.from(
    new Set(
      formData
        .getAll("tag")
        .map(String)
        .map((s) => s.trim())
        .filter(Boolean)
    )
  );
  const autoResolve = String(formData.get("autoResolve")) === "true";
  const completionType =
    String(formData.get("completionType")) === "aggregate"
      ? "aggregate"
      : "collective";
  const trackOnGrid = String(formData.get("trackOnGrid")) === "true";
  const pinned = String(formData.get("pinned")) === "true";
  const rolloverMissedDays =
    String(formData.get("rolloverMissedDays")) === "true";
  const rolloverChangeRhythm =
    String(formData.get("rolloverChangeRhythm")) === "true";

  // Reminders: zip the parallel reminderDays/Hours/Minutes arrays (same
  // field names the shared RemindersField emits), clamped + capped at 10.
  const rDays = formData.getAll("reminderDays");
  const rHours = formData.getAll("reminderHours");
  const rMins = formData.getAll("reminderMinutes");
  const rn = Math.min(rDays.length, rHours.length, rMins.length, 10);
  const clampR = (v: FormDataEntryValue, max: number) => {
    const n = parseInt(String(v), 10);
    return Number.isFinite(n) ? Math.min(Math.max(n, 0), max) : 0;
  };
  const reminders: Array<{ days: number; hours: number; minutes: number }> = [];
  for (let i = 0; i < rn; i++) {
    reminders.push({
      days: clampR(rDays[i], 30),
      hours: clampR(rHours[i], 23),
      minutes: clampR(rMins[i], 59),
    });
  }

  // Times of day: zip parallel scheduledTime / scheduledEndTime arrays,
  // dropping blank starts and keeping ends aligned by index.
  const rawStarts = formData.getAll("scheduledTime").map(String);
  const rawEnds = formData.getAll("scheduledEndTime").map(String);
  const scheduledTimes: string[] = [];
  const scheduledEndTimes: string[] = [];
  for (let i = 0; i < rawStarts.length; i++) {
    const t = rawStarts[i].trim();
    if (!/^\d{2}:\d{2}$/.test(t)) continue;
    scheduledTimes.push(t);
    const e = (rawEnds[i] ?? "").trim();
    scheduledEndTimes.push(/^\d{2}:\d{2}$/.test(e) ? e : "");
  }

  const rhythmType = String(formData.get("rhythmType") ?? "single");
  let candidate: unknown;
  switch (rhythmType) {
    case "single":
      candidate = { type: "single" };
      break;
    case "daily":
      // Multi-time Daily → frequency (count = N per day) so the X/Y
      // progress model applies, matching the personal form.
      candidate =
        scheduledTimes.length > 1
          ? {
              type: "frequency",
              count: scheduledTimes.length,
              perCount: 1,
              perUnit: "days",
            }
          : { type: "daily" };
      break;
    case "weekdays":
      candidate = { type: "weekdays", days: formData.getAll("weekday").map(String) };
      break;
    case "interval": {
      const n = parseInt(String(formData.get("intervalDays") ?? "2"), 10);
      candidate = { type: "interval", days: Number.isFinite(n) ? Math.min(Math.max(n, 1), 365) : 2 };
      break;
    }
    case "frequency": {
      const count = parseInt(String(formData.get("frequencyCount") ?? "3"), 10);
      const perCount = parseInt(String(formData.get("frequencyPerCount") ?? "1"), 10);
      candidate = {
        type: "frequency",
        count: Number.isFinite(count) ? Math.min(Math.max(count, 1), 99) : 3,
        perCount: Number.isFinite(perCount) ? Math.min(Math.max(perCount, 1), 99) : 1,
        perUnit: String(formData.get("frequencyPerUnit") ?? "weeks"),
      };
      break;
    }
    default:
      return { error: `Unknown rhythm type: ${rhythmType}` };
  }
  const parsed = rhythmSchema.safeParse(candidate);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid rhythm." };
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const startDate = String(formData.get("startDate") ?? "").trim() || todayStr;
  const endRaw = String(formData.get("endDate") ?? "").trim();
  const endDate =
    parsed.data.type === "single" ? null : endRaw.length > 0 ? endRaw : null;
  if (endDate && endDate < startDate) {
    return { error: "End date must be on or after the start date." };
  }

  return {
    name,
    notes: notesRaw.length > 0 ? notesRaw : undefined,
    rhythm: parsed.data,
    scheduledTimes,
    scheduledEndTimes,
    tags,
    startDate,
    endDate,
    autoResolve,
    completionType,
    reminders,
    trackOnGrid,
    pinned,
    rolloverMissedDays,
    rolloverChangeRhythm,
  };
}

export async function createCommunityActivityFormAction(
  communityId: string,
  _prev: CommunityActivityFormResult,
  formData: FormData
): Promise<CommunityActivityFormResult> {
  const parsed = parseCommunityActivityForm(formData);
  if ("error" in parsed) return parsed;
  const res = await createCommunityCalendarActivity({ communityId, ...parsed });
  if ("error" in res) return res;
  return { ok: true };
}

export async function updateCommunityActivityFormAction(
  activityId: string,
  _prev: CommunityActivityFormResult,
  formData: FormData
): Promise<CommunityActivityFormResult> {
  const parsed = parseCommunityActivityForm(formData);
  if ("error" in parsed) return parsed;
  return updateCommunityCalendarActivity({ activityId, ...parsed });
}

// setCommunityInstanceStatus — collective completion; any member.
export async function setCommunityInstanceStatus(
  instanceId: string,
  status: "pending" | "completed" | "missed"
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.rpc("set_community_instance_status", {
    p_instance_id: instanceId,
    p_status: status,
  });
  if (error) return { error: error.message };
  revalidateCommunityPaths();
  return { ok: true };
}

// archiveCommunityCalendarActivity — soft-delete a community-owned activity.
export async function archiveCommunityCalendarActivity(
  activityId: string
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.rpc("archive_community_activity", {
    p_activity_id: activityId,
  });
  if (error) return { error: error.message };
  revalidateCommunityPaths();
  return { ok: true };
}

// restoreCommunityCalendarActivity — un-archive + re-materialize occurrences.
export async function restoreCommunityCalendarActivity(
  activityId: string
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.rpc("restore_community_activity", {
    p_activity_id: activityId,
  });
  if (error) return { error: error.message };

  // Rebuild future occurrences for the restored activity.
  const { data: row } = await supabase
    .from("community_owned_activities")
    .select("rhythm, start_date, end_date")
    .eq("id", activityId)
    .maybeSingle();
  const a = row as {
    rhythm: Rhythm;
    start_date: string;
    end_date: string | null;
  } | null;
  if (a) {
    const todayStr = new Date().toISOString().slice(0, 10);
    const from = a.start_date > todayStr ? a.start_date : todayStr;
    const horizon = shiftYmd(todayStr, COMMUNITY_OWNED_HORIZON_DAYS);
    const to = a.end_date && a.end_date < horizon ? a.end_date : horizon;
    if (from <= to) {
      try {
        const dates = generateInstances(a.rhythm, { from, to }).map(
          (i) => i.scheduledFor
        );
        if (dates.length > 0) {
          await supabase.rpc("insert_community_instances", {
            p_activity_id: activityId,
            p_dates: dates,
          });
        }
      } catch {
        /* tops up on next view */
      }
    }
  }
  revalidateCommunityPaths();
  return { ok: true };
}

// deleteCommunityCalendarActivity — permanently delete (Archived only in UI).
export async function deleteCommunityCalendarActivity(
  activityId: string
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.rpc("delete_community_activity", {
    p_activity_id: activityId,
  });
  if (error) return { error: error.message };
  revalidateCommunityPaths();
  return { ok: true };
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

// setMemberRole — leadership/can_promote change a member's role. `role` is a
// fixed role ("leader"|"co_leader"|"member") or a custom "rank:<id>".
export async function setMemberRole(
  communityId: string,
  userId: string,
  role: string
): Promise<{ error: string } | { ok: true }> {
  return callSettingsRpc("set_member_role", {
    p_community_id: communityId,
    p_user_id: userId,
    p_role: role,
  });
}

// ---------------------------------------------------------------------------
// Custom ranks (migration 0051)
// ---------------------------------------------------------------------------

// createCommunityRank — define a new rank with a permission bitmap.
export async function createCommunityRank(
  communityId: string,
  name: string,
  permissions: CommunityPermissions
): Promise<{ error: string } | { ok: true }> {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 40) {
    return { error: "Rank name must be 1–40 characters." };
  }
  return callSettingsRpc("create_community_rank", {
    p_community_id: communityId,
    p_name: trimmed,
    p_permissions: permissions,
  });
}

// updateCommunityRank — rename a rank and/or change its permissions.
export async function updateCommunityRank(
  rankId: string,
  name: string,
  permissions: CommunityPermissions
): Promise<{ error: string } | { ok: true }> {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 40) {
    return { error: "Rank name must be 1–40 characters." };
  }
  return callSettingsRpc("update_community_rank", {
    p_rank_id: rankId,
    p_name: trimmed,
    p_permissions: permissions,
  });
}

// deleteCommunityRank — remove a rank; holders fall back to plain member.
export async function deleteCommunityRank(
  rankId: string
): Promise<{ error: string } | { ok: true }> {
  return callSettingsRpc("delete_community_rank", {
    p_rank_id: rankId,
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

// setCommunityOutsiderVisibility — leadership choose what non-members see of
// a public community's preview (member roster / activity list).
export async function setCommunityOutsiderVisibility(
  communityId: string,
  showMembers: boolean,
  showActivities: boolean
): Promise<{ error: string } | { ok: true }> {
  return callSettingsRpc("set_community_outsider_visibility", {
    p_community_id: communityId,
    p_show_members: showMembers,
    p_show_activities: showActivities,
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

// inviteToCommunity — invite a user by username OR email (permission-gated
// server-side). Resolution mirrors the friend-add flow.
export async function inviteToCommunity(
  communityId: string,
  usernameOrEmail: string
): Promise<{ error: string } | { ok: true }> {
  const u = usernameOrEmail.trim().replace(/^@/, "");
  if (u.length === 0) return { error: "Enter a username or email." };
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
