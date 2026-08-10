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
