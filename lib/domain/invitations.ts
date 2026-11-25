// ---------------------------------------------------------------------------
// Invitations (migration 0084) — pure types, constants, and helpers shared by
// the invitations server actions and the Invitations tab UI. Kept out of the
// "use server" file (which may only export async functions).
// ---------------------------------------------------------------------------

import type { Rhythm } from "@/lib/validators/rhythm";

export const INVITATION_AUDIENCES = [
  "friends",
  "community",
  "nearby",
  "public",
] as const;
export type InvitationAudience = (typeof INVITATION_AUDIENCES)[number];

export const AUDIENCE_LABEL: Record<InvitationAudience, string> = {
  friends: "Friends",
  community: "Community",
  nearby: "Nearby",
  public: "Anyone",
};

export const SKILL_LEVELS = [
  "all",
  "beginner",
  "intermediate",
  "advanced",
] as const;
export type SkillLevel = (typeof SKILL_LEVELS)[number];

export const SKILL_LABEL: Record<SkillLevel, string> = {
  all: "All levels",
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

export function isAudience(v: unknown): v is InvitationAudience {
  return (INVITATION_AUDIENCES as readonly string[]).includes(String(v));
}
export function isSkillLevel(v: unknown): v is SkillLevel {
  return (SKILL_LEVELS as readonly string[]).includes(String(v));
}

export type Invitation = {
  id: string;
  hostUserId: string;
  hostName: string | null;
  hostCommunityId: string | null;
  hostCommunityName: string | null;
  name: string;
  notes: string | null;
  rhythm: Rhythm;
  startDate: string;
  endDate: string | null;
  scheduledTimes: string[];
  scheduledEndTimes: string[];
  tags: string[];
  locationName: string;
  latitude: number | null;
  longitude: number | null;
  audience: InvitationAudience;
  audienceCommunityId: string | null;
  audienceCommunityName: string | null;
  radiusKm: number | null;
  skillLevel: SkillLevel;
  capacity: number | null;
  attendeeCount: number;
  iAmGoing: boolean;
  myActivityId: string | null;
  canManage: boolean;
  distanceKm: number | null;
  createdAt: string;
};

export type InvitationCommunity = {
  id: string;
  name: string;
  kind: string;
  canHost: boolean;
};

/** Map a get_available_invitations row to the camelCase Invitation shape. */
export function mapInvitationRow(r: Record<string, unknown>): Invitation {
  const num = (v: unknown) =>
    v === null || v === undefined ? null : Number(v);
  return {
    id: String(r.id),
    hostUserId: String(r.host_user_id),
    hostName: (r.host_name as string | null) ?? null,
    hostCommunityId: (r.host_community_id as string | null) ?? null,
    hostCommunityName: (r.host_community_name as string | null) ?? null,
    name: String(r.name),
    notes: (r.notes as string | null) ?? null,
    rhythm: r.rhythm as Rhythm,
    startDate: String(r.start_date),
    endDate: (r.end_date as string | null) ?? null,
    scheduledTimes: (r.scheduled_times as string[] | null) ?? [],
    scheduledEndTimes: (r.scheduled_end_times as string[] | null) ?? [],
    tags: (r.default_skill_tags as string[] | null) ?? [],
    locationName: String(r.location_name ?? ""),
    latitude: num(r.latitude),
    longitude: num(r.longitude),
    audience: isAudience(r.audience) ? r.audience : "friends",
    audienceCommunityId: (r.audience_community_id as string | null) ?? null,
    audienceCommunityName: (r.audience_community_name as string | null) ?? null,
    radiusKm: num(r.radius_km),
    skillLevel: isSkillLevel(r.skill_level) ? r.skill_level : "all",
    capacity: num(r.capacity),
    attendeeCount: Number(r.attendee_count ?? 0),
    iAmGoing: Boolean(r.i_am_going),
    myActivityId: (r.my_activity_id as string | null) ?? null,
    canManage: Boolean(r.can_manage),
    distanceKm: num(r.distance_km),
    createdAt: String(r.created_at),
  };
}

// --- Filtering ---------------------------------------------------------------

export type InvitationSource = "all" | "friends" | "communities" | "nearby" | "public" | "going" | "mine";

export type InvitationFilters = {
  query: string;
  source: InvitationSource;
  /** '' = any. */
  communityId: string;
  skill: SkillLevel | "any";
  tag: string;
  /** YYYY-MM-DD or '' — invitation must have activity on/after this date. */
  from: string;
  /** YYYY-MM-DD or '' — invitation must start on/before this date. */
  to: string;
  /** km; null = no distance limit. Only applies when the viewer shared a location. */
  maxDistanceKm: number | null;
};

export const DEFAULT_INVITATION_FILTERS: InvitationFilters = {
  query: "",
  source: "all",
  communityId: "",
  skill: "any",
  tag: "",
  from: "",
  to: "",
  maxDistanceKm: null,
};

/** The last date an invitation has an occurrence (null = open-ended). */
export function invitationLastDate(inv: Pick<Invitation, "rhythm" | "startDate" | "endDate">): string | null {
  if (inv.endDate) return inv.endDate;
  if (inv.rhythm.type === "single") return inv.startDate;
  return null;
}

export function filterInvitations(
  list: Invitation[],
  f: InvitationFilters,
  viewerId: string
): Invitation[] {
  const q = f.query.trim().toLowerCase();
  return list.filter((inv) => {
    if (q) {
      const hay = [
        inv.name,
        inv.notes ?? "",
        inv.locationName,
        inv.hostName ?? "",
        inv.hostCommunityName ?? "",
        ...inv.tags,
      ]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    switch (f.source) {
      case "friends":
        if (inv.audience !== "friends") return false;
        break;
      case "communities":
        if (inv.audience !== "community" && !inv.hostCommunityId) return false;
        break;
      case "nearby":
        if (inv.audience !== "nearby") return false;
        break;
      case "public":
        if (inv.audience !== "public") return false;
        break;
      case "going":
        if (!inv.iAmGoing) return false;
        break;
      case "mine":
        if (inv.hostUserId !== viewerId && !inv.canManage) return false;
        break;
    }
    if (
      f.communityId &&
      inv.audienceCommunityId !== f.communityId &&
      inv.hostCommunityId !== f.communityId
    )
      return false;
    // "All levels" invitations match every skill filter.
    if (f.skill !== "any" && inv.skillLevel !== f.skill && inv.skillLevel !== "all")
      return false;
    if (f.tag && !inv.tags.includes(f.tag)) return false;
    if (f.from) {
      const last = invitationLastDate(inv);
      if (last !== null && last < f.from) return false;
    }
    if (f.to && inv.startDate > f.to) return false;
    if (f.maxDistanceKm !== null) {
      if (inv.distanceKm === null || inv.distanceKm > f.maxDistanceKm) return false;
    }
    return true;
  });
}

export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

/** Notes for an attendee's calendar copy: the location line, then the
 *  invitation's own notes. */
export function invitationCopyNotes(locationName: string, notes: string | null): string {
  return [`📍 ${locationName}`, notes].filter(Boolean).join("\n");
}

// --- change notices (migration 0086) -------------------------------------------

export type InvitationTimesValue = { starts: string[]; ends: string[] };

/** Field → { from, to } as written by the notify_invitation_attendees trigger. */
export type InvitationChanges = Partial<{
  name: { from: string; to: string };
  notes: { from: string | null; to: string | null };
  rhythm: { from: Rhythm; to: Rhythm };
  start_date: { from: string; to: string };
  end_date: { from: string | null; to: string | null };
  times: { from: InvitationTimesValue; to: InvitationTimesValue };
  tags: { from: string[]; to: string[] };
  location: { from: string; to: string };
}>;

export type InvitationChangeNotice = {
  id: string;
  invitationId: string;
  kind: "updated" | "cancelled";
  changes: InvitationChanges;
  updatedAt: string;
  invitationName: string;
  hostLabel: string;
  /** The attendee's live (unarchived) calendar copy, if any. */
  activityId: string | null;
  /** Next upcoming occurrence of that copy (for "Open on my calendar"). */
  nextDate: string | null;
};

export const CHANGE_FIELD_ORDER: Array<keyof InvitationChanges> = [
  "name",
  "start_date",
  "end_date",
  "rhythm",
  "times",
  "location",
  "notes",
  "tags",
];

export const CHANGE_FIELD_LABEL: Record<keyof InvitationChanges, string> = {
  name: "Name",
  start_date: "Date",
  end_date: "End date",
  rhythm: "Repeats",
  times: "Time",
  location: "Location",
  notes: "Notes",
  tags: "Tags",
};

// --- activity notices (migration 0088) -------------------------------------------

/** 'new' = an invitation was posted to you; 'joined' / 'left' = someone
 *  added / removed YOUR invitation. */
export type InvitationActivityNotice = {
  id: string;
  invitationId: string;
  kind: "new" | "joined" | "left";
  createdAt: string;
  invitationName: string;
  startDate: string;
  locationName: string;
  /** 'new': the host (community name, else person); joined/left: the attendee. */
  actorLabel: string;
  attendeeCount: number;
  capacity: number | null;
  cancelled: boolean;
};
