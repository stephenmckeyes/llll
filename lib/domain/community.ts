// ---------------------------------------------------------------------------
// Communities — shared types and small helpers used by the tab UI and the
// server actions. The DB itself enforces the per-kind rules (Groups are
// always private+non-open, join_policy is a CHECK, etc.); this file just
// gives the TypeScript layer the same vocabulary.
// ---------------------------------------------------------------------------

export const COMMUNITY_KINDS = ["group", "club", "guild"] as const;
export type CommunityKind = (typeof COMMUNITY_KINDS)[number];

export function isCommunityKind(v: unknown): v is CommunityKind {
  return (
    typeof v === "string" &&
    (COMMUNITY_KINDS as readonly string[]).includes(v)
  );
}

export const COMMUNITY_VISIBILITIES = ["private", "public"] as const;
export type CommunityVisibility = (typeof COMMUNITY_VISIBILITIES)[number];

export const COMMUNITY_JOIN_POLICIES = [
  "open",
  "application",
  "invite",
] as const;
export type CommunityJoinPolicy = (typeof COMMUNITY_JOIN_POLICIES)[number];

// Which join policies are legal for each kind. Groups are always
// non-open — the DB CHECK enforces the same rule; this drives the
// create-modal's radio choices.
export const ALLOWED_JOIN_POLICIES: Record<
  CommunityKind,
  readonly CommunityJoinPolicy[]
> = {
  group: ["invite", "application"],
  club: ["open", "application", "invite"],
  guild: ["open", "application", "invite"],
};

// Which visibilities are legal for each kind.
export const ALLOWED_VISIBILITIES: Record<
  CommunityKind,
  readonly CommunityVisibility[]
> = {
  group: ["private"],
  club: ["public", "private"],
  guild: ["public", "private"],
};

export type CommunityRole = "leader" | "co_leader" | "member";

export function isLeadership(role: string | null | undefined): boolean {
  return role === "leader" || role === "co_leader";
}

// ---------------------------------------------------------------------------
// Ranks + permissions (migration 0051). A member's community_members.role is
// one of the fixed roles above OR "rank:<uuid>" pointing at a community_ranks
// row that carries the permission bitmap below.
// ---------------------------------------------------------------------------

export const COMMUNITY_PERMISSION_KEYS = [
  "can_invite",
  "can_approve_requests",
  "can_add_activities",
  "can_mark_completions",
  "can_edit_settings",
  "can_promote",
  "can_kick",
] as const;
export type CommunityPermission = (typeof COMMUNITY_PERMISSION_KEYS)[number];

export type CommunityPermissions = Record<CommunityPermission, boolean>;

// Label + one-line help for each permission, for the rank editor checkboxes.
export const COMMUNITY_PERMISSION_META: Record<
  CommunityPermission,
  { label: string; help: string }
> = {
  can_invite: { label: "Invite members", help: "Send invites to join." },
  can_approve_requests: {
    label: "Approve requests",
    help: "Accept or decline join requests.",
  },
  can_add_activities: {
    label: "Manage activities",
    help: "Add or remove the community's shared activities.",
  },
  can_mark_completions: {
    label: "Mark completions",
    help: "Mark shared (collective) occurrences done/missed for the group.",
  },
  can_edit_settings: {
    label: "Edit settings",
    help: "Change settings, homepage, and ranks.",
  },
  can_promote: {
    label: "Assign roles",
    help: "Change members' roles (not leadership).",
  },
  can_kick: { label: "Remove members", help: "Kick members from the community." },
};

export const NO_PERMISSIONS: CommunityPermissions = {
  can_invite: false,
  can_approve_requests: false,
  can_add_activities: false,
  can_mark_completions: false,
  can_edit_settings: false,
  can_promote: false,
  can_kick: false,
};

export const ALL_PERMISSIONS: CommunityPermissions = {
  can_invite: true,
  can_approve_requests: true,
  can_add_activities: true,
  can_mark_completions: true,
  can_edit_settings: true,
  can_promote: true,
  can_kick: true,
};

export type CommunityRank = {
  id: string;
  name: string;
  sortOrder: number;
  permissions: CommunityPermissions;
};

export const RANK_ROLE_PREFIX = "rank:";

export function rankRoleValue(rankId: string): string {
  return `${RANK_ROLE_PREFIX}${rankId}`;
}

export function rankIdFromRole(role: string | null | undefined): string | null {
  if (role && role.startsWith(RANK_ROLE_PREFIX)) {
    return role.slice(RANK_ROLE_PREFIX.length);
  }
  return null;
}

// Merge a possibly-partial permissions jsonb from the DB onto the all-false
// base so every key is present as a real boolean.
export function normalizePermissions(
  raw: Partial<Record<string, unknown>> | null | undefined
): CommunityPermissions {
  const out: CommunityPermissions = { ...NO_PERMISSIONS };
  if (raw) {
    for (const k of COMMUNITY_PERMISSION_KEYS) {
      out[k] = raw[k] === true;
    }
  }
  return out;
}

// Resolve the effective permissions for a member given their role + the
// community's rank list. Mirrors has_community_permission() server-side.
export function resolvePermissions(
  role: string | null | undefined,
  ranks: CommunityRank[]
): CommunityPermissions {
  if (isLeadership(role)) return { ...ALL_PERMISSIONS };
  const rankId = rankIdFromRole(role);
  if (rankId) {
    const rank = ranks.find((r) => r.id === rankId);
    if (rank) return { ...rank.permissions };
  }
  return { ...NO_PERMISSIONS };
}

// Human label for any role value (fixed role or a custom rank).
export function roleLabel(
  role: string | null | undefined,
  ranks: CommunityRank[]
): string {
  if (role === "leader") return "Leader";
  if (role === "co_leader") return "Co-leader";
  const rankId = rankIdFromRole(role);
  if (rankId) {
    const rank = ranks.find((r) => r.id === rankId);
    if (rank) return rank.name;
  }
  return "Member";
}

// Whether a member has any management permission at all — drives whether the
// Settings tab is offered.
export function hasAnyManagementPermission(p: CommunityPermissions): boolean {
  return (
    p.can_invite ||
    p.can_approve_requests ||
    p.can_add_activities ||
    p.can_edit_settings ||
    p.can_promote ||
    p.can_kick
  );
}

// User-facing labels — plural + singular. Kept here so pages / modals /
// empty states stay consistent.
export const KIND_LABEL: Record<CommunityKind, { one: string; many: string }> =
  {
    group: { one: "group", many: "groups" },
    club: { one: "club", many: "clubs" },
    guild: { one: "guild", many: "guilds" },
  };

export const KIND_TITLE: Record<CommunityKind, string> = {
  group: "Groups",
  club: "Clubs",
  guild: "Guilds",
};
