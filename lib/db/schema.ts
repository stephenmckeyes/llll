// ---------------------------------------------------------------------------
// Mission — database schema (v2: unified activities)
//
// Architectural rules from the design doc (do not violate):
//   1. Producer/Completion split. Producers represent intent, completions
//      represent reality. Separate tables (activities vs completions).
//   2. Completions are self-contained and immutable. Copy skill_tags +
//      metrics from the producer at creation. Soft-delete only.
//   3. All completion creation goes through lib/domain/completions.ts.
//   4. Rhythms are structured JSON, validated by Zod at the app boundary.
//   5. visibility on every user-data table from day one.
//   6. Free-text tags. No fixed taxonomy yet.
//
// v2 unification:
//   - Single `activities` table replaces `recurring_activities` + `tasks`.
//   - Every activity has a `rhythm` (jsonb) — including the new `single`
//     type for what used to be a task.
//   - Every activity has `start_date` + optional `end_date` bounding the
//     rhythm. Singles set end_date = start_date.
//   - Every activity has `priority` (smallint 1-3), `abandoned_reason`,
//     `archived_at`. Promoted from tasks.
//   - `activity_instances` replaces `recurring_activity_instances`.
//   - `completion_instances` (kept) is now the ONLY producer link table;
//     `completion_tasks` is gone.
// ---------------------------------------------------------------------------

import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ===========================================================================
// Enums
// ===========================================================================

export const visibility = pgEnum("visibility", [
  "private",
  "friends",
  "clan",
  "public",
]);

export const instanceStatus = pgEnum("instance_status", [
  "pending",
  "completed",
  "skipped",
  "shifted",
  "missed",
]);

// ===========================================================================
// profiles
// ===========================================================================

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  timezone: text("timezone").notNull().default("UTC"),
  displayName: text("display_name"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  // NULL = user hasn't completed the onboarding flow yet. Set by
  // /onboarding's completeOnboarding server action. Existing profiles
  // at the time of migration 0007 are grandfathered (onboarded_at =
  // created_at) so we don't bounce returning users to a setup screen.
  onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
  // Social layer (migration 0010). `username` is an optional, unique
  // (case-insensitive) handle for friend lookup; `email` is
  // denormalized from auth.users (kept in sync by the signup trigger)
  // so friend search can match an exact email without exposing
  // auth.users to clients.
  username: text("username"),
  email: text("email"),
  // Streak display config (migration 0015). scope: 'same' | 'independent'.
  // mode: 'none' | 'perfect_weeks' | 'perfect_months' | 'countdown' |
  // 'total'. stats toggles the x/y + % line. goal is the global countdown
  // target.
  streakScope: text("streak_scope").notNull().default("same"),
  streakMode: text("streak_mode").notNull().default("none"),
  streakStats: boolean("streak_stats").notNull().default(true),
  // When streak_stats is on: true → "X/Y · Z%" (accuracy), false → just
  // the completed count "X". Migration 0018.
  streakStatsAccuracy: boolean("streak_stats_accuracy")
    .notNull()
    .default(true),
  streakGoal: smallint("streak_goal"),
  // Add Activity form density (migration 0023). One of
  // 'default' | 'compact' | 'expanded' — read-time defaults to
  // 'default' for anything unrecognized, no CHECK constraint so we
  // can add more modes later without a migration.
  addActivityDensity: text("add_activity_density").notNull().default("default"),
  // Time-format preference (migration 0024). One of 'auto' | '12h' |
  // '24h'; 'auto' delegates to the browser locale (existing behavior).
  timeFormat: text("time_format").notNull().default("auto"),
  // Per-profile read-only calendar-export token (migration 0025).
  // NULL until the user enables sync in Settings. Rotating it
  // invalidates every subscribed calendar app.
  icsToken: text("ics_token"),
  // Default range tab for the Streaks (Grid) view when the URL has
  // no explicit ?range param (migration 0029). One of
  // 'week' | 'month' | 'total' | 'custom'; 'total' is the initial
  // default because whole-record heatmaps are more useful than a
  // 7-day slice on first open.
  defaultStreaksRange: text("default_streaks_range")
    .notNull()
    .default("total"),
  // Tag NAMES the Calendar hides on cold-open (migration 0034).
  // Any URL ?hideTags= param overrides this per navigation.
  defaultCalendarHiddenTags: text("default_calendar_hidden_tags")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  // Default state for the Timeline's per-day untimed dropdown
  // (migration 0037). False = collapsed on load; true = expanded.
  defaultUntimedOpen: boolean("default_untimed_open")
    .notNull()
    .default(false),
});

// ===========================================================================
// friendships (migration 0010) — one row per (requester, addressee).
// status: pending → accepted | declined. "Active" friends = accepted.
// ===========================================================================

export const friendships = pgTable(
  "friendships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    addresseeId: uuid("addressee_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    // User-controlled ordering for the Friends page list (migration
    // 0027). NULL = no explicit order — those rows sort by created_at
    // DESC after any rows with a concrete sort_order.
    sortOrder: integer("sort_order"),
  },
  (t) => [
    uniqueIndex("friendships_pair_unique").on(t.requesterId, t.addresseeId),
    index("friendships_addressee_idx").on(t.addresseeId, t.status),
    index("friendships_requester_idx").on(t.requesterId, t.status),
  ]
);

// ===========================================================================
// activities  (unified producer table)
// ---------------------------------------------------------------------------
// `rhythm` is validated by rhythmSchema before insert. One of:
//   { type: "single" }
//   { type: "daily" }
//   { type: "weekdays", days: ["mon","wed","fri"] }
//   { type: "interval", days: 2 }
//   { type: "frequency", count: 3, period: "day" | "week" | "month" }
//
// `start_date` defaults to today; `end_date` is nullable (NULL = no end).
// Singles set end_date = start_date.
// `priority` is 1=high, 2=medium, 3=low.
// ===========================================================================

export const activities = pgTable(
  "activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    notes: text("notes"),
    rhythm: jsonb("rhythm").notNull(),
    startDate: date("start_date").notNull().default(sql`CURRENT_DATE`),
    endDate: date("end_date"),
    // "HH:MM" strings. Empty for "no time specified."
    // For Multi-Daily, one entry per occurrence (length = times-per-day).
    // For other rhythms, 0 or 1 entries.
    scheduledTimes: text("scheduled_times")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // Optional per-slot end time paired to scheduled_times by index
    // (migration 0032). Empty string ("") in a slot means "start only,
    // no end". A shorter array is treated as trailing empties. When set,
    // the day/timeline views render "08:00 – 09:00" and can detect
    // conflicts by overlap.
    scheduledEndTimes: text("scheduled_end_times")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // Array of { amount, unit } reminders. unit ∈ {minutes,hours,days,weeks}.
    // Notification *delivery* is a separate concern (cron + email/push); this
    // column is the user's persisted preferences.
    reminders: jsonb("reminders").notNull().default(sql`'[]'::jsonb`),
    priority: smallint("priority").notNull().default(2),
    defaultSkillTags: text("default_skill_tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    defaultMetrics: jsonb("default_metrics")
      .notNull()
      .default(sql`'{}'::jsonb`),
    visibility: visibility("visibility").notNull().default("private"),
    abandonedReason: text("abandoned_reason"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    // Per-activity streak display (migration 0015), used when the user's
    // streak_scope is 'independent'. NULL mode → fall back to the global.
    streakMode: text("streak_mode"),
    streakGoal: smallint("streak_goal"),
    // Show this activity in the Grid view (migration 0016). Everything is
    // still tracked; this only gates grid DISPLAY. Default false.
    trackOnGrid: boolean("track_on_grid").notNull().default(false),
    // Rollover toggles (migration 0021) — how a missed RECURRING
    // occurrence should treat the schedule.
    //   rolloverMissedDays  → also insert a make-up on the next day
    //   rolloverChangeRhythm → shift the whole rhythm forward by 1 day
    // Independent booleans; both default false (no behavior change).
    // Ignored for rhythm=single (which uses missInstance's built-in
    // reschedule-to-today rule).
    rolloverMissedDays: boolean("rollover_missed_days").notNull().default(false),
    rolloverChangeRhythm: boolean("rollover_change_rhythm")
      .notNull()
      .default(false),
    // Auto-archive on completion (migration 0026). When true, the
    // parent activity is archived (archived_at = now) as soon as an
    // instance completes or is finalised as missed. Singles use this
    // to keep Total View's Active filter uncluttered; the archived
    // rows still appear under the Past filter with completion dates.
    autoArchive: boolean("auto_archive").notNull().default(false),
    // Pinned (migration 0035) — user-facing flag to keep an activity
    // one-tap-accessible in Total View's Pinned filter (default view).
    // Independent of auto_archive; a completed single that's pinned
    // still archives on complete but stays surfaced under Pinned.
    pinned: boolean("pinned").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("activities_user_idx").on(t.userId)]
);

// ===========================================================================
// activity_instances
// ---------------------------------------------------------------------------
// Specific dated occurrences. (activity_id, scheduled_for) is unique —
// one instance per activity per day max.
// ===========================================================================

export const activityInstances = pgTable(
  "activity_instances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    activityId: uuid("activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    scheduledFor: date("scheduled_for").notNull(),
    status: instanceStatus("status").notNull().default("pending"),
    // Snapshot of the activity's tags at the moment this instance was
    // generated. Frozen — Edit Activity (metadata-only) doesn't touch
    // this. Edit Rhythm regenerates pending future instances, which
    // pick up the activity's NEW default_skill_tags fresh.
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // Per-occurrence overrides (NULL = inherit from the parent activity).
    // Set by "Edit activity", which edits ONLY this occurrence. "Edit
    // rhythm" edits the series (the activities row) instead.
    name: text("name"),
    notes: text("notes"),
    priority: smallint("priority"),
    // Post-hoc reflection about THIS occurrence — "5km, felt great",
    // "skipped, kid sick". Distinct from `notes` (per-occurrence
    // override) and activities.notes (the rhythm's defaults). Shared
    // with friends who have share_progress=true. Migration 0020.
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("ai_activity_date_idx").on(t.activityId, t.scheduledFor),
    index("ai_status_idx").on(t.status),
  ]
);

// ===========================================================================
// completions  (the atomic, append-only "I did a thing")
// ===========================================================================

export const completions = pgTable(
  "completions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    skillTags: text("skill_tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    metrics: jsonb("metrics").notNull().default(sql`'{}'::jsonb`),
    effortRating: smallint("effort_rating"),
    note: text("note"),
    visibility: visibility("visibility").notNull().default("private"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("completions_user_occurred_idx").on(t.userId, t.occurredAt)]
);

// ===========================================================================
// completion_instances  (M:N link: completions ↔ activity_instances)
// ---------------------------------------------------------------------------
// The single producer link table now that activities are unified.
// ===========================================================================

export const completionInstances = pgTable(
  "completion_instances",
  {
    completionId: uuid("completion_id")
      .notNull()
      .references(() => completions.id, { onDelete: "cascade" }),
    instanceId: uuid("instance_id")
      .notNull()
      .references(() => activityInstances.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("completion_instances_pk").on(t.completionId, t.instanceId),
    index("completion_instances_instance_idx").on(t.instanceId),
  ]
);

// ===========================================================================
// tags  (per-user name → color lookup)
// ---------------------------------------------------------------------------
// Activities still store tag NAMES verbatim in `default_skill_tags text[]`.
// This table only adds optional color metadata: { (user_id, name) → color }.
// Unknown tag names render with a gray fallback until the user colors them.
// `color` is a palette KEY ("emerald" / "amber" / ...), not a hex — see
// lib/domain/tags.ts for the palette → Tailwind-classes mapping.
// ===========================================================================

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Soft-delete (migration 0039). Archived tags are hidden from the
    // picker + filter surfaces but the row + any references in
    // activities.default_skill_tags / activity_instances.tags stay
    // intact so old banners keep rendering correctly.
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("tags_user_name_idx").on(t.userId, t.name),
    index("tags_user_idx").on(t.userId),
  ]
);

// ===========================================================================
// activity_shares (migration 0011) — "owner shared activity A with friend B".
// ---------------------------------------------------------------------------
// One row per (activity, recipient). Sharing is always per-activity, per-
// friend (nothing is public) and revocable. `share_progress` controls
// whether the recipient also sees the owner's completion history, or just
// the template/schedule. Friends read shared rhythms ONLY through the
// SECURITY DEFINER get_shared_with_me() RPC — never by editing the owner's
// rows. See lib/db/migrations/0011_activity_shares.sql.
// ===========================================================================

export const activityShares = pgTable(
  "activity_shares",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    activityId: uuid("activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    sharedWithId: uuid("shared_with_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    // true = recipient sees the owner's completion history; false = the
    // template/schedule only. Default true so friends can follow along.
    shareProgress: boolean("share_progress").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("activity_shares_unique").on(t.activityId, t.sharedWithId),
    index("activity_shares_recipient_idx").on(t.sharedWithId),
    index("activity_shares_owner_idx").on(t.ownerId),
  ]
);

// ===========================================================================
// activity_watches (migration 0013) — "watch" a friend's shared rhythm for
// progress nudges. One row per (watcher, activity). Cadences are independent
// booleans. Reminders are computed live in the Notifications tab from the
// friend's shared occurrences — this table only records what's being
// watched. See lib/db/migrations/0013_activity_watches.sql.
// ===========================================================================

export const activityWatches = pgTable(
  "activity_watches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    watcherId: uuid("watcher_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    activityId: uuid("activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
    notifyEach: boolean("notify_each").notNull().default(false),
    notifyDaily: boolean("notify_daily").notNull().default(false),
    notifyWeekly: boolean("notify_weekly").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("activity_watches_unique").on(t.watcherId, t.activityId),
    index("activity_watches_watcher_idx").on(t.watcherId),
  ]
);

// ===========================================================================
// messages (migration 0014) — 1:1 direct messages between friends. A
// conversation is all rows where {sender, recipient} = {me, friend}. A
// message may quote an activity (FK nulled on delete + a denormalized name
// snapshot). read_at drives unread badges + notifications.
// ===========================================================================

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    body: text("body").notNull().default(""),
    quotedActivityId: uuid("quoted_activity_id").references(
      () => activities.id,
      { onDelete: "set null" }
    ),
    quotedActivityName: text("quoted_activity_name"),
    // Occurrence-level quote (migration 0017): the dated instance + a label
    // snapshot of its state at reply time. NULL for rhythm-level quotes.
    quotedScheduledFor: date("quoted_scheduled_for"),
    quotedStatus: text("quoted_status"),
    // Marks the message as an "Ask for help" request (migration 0028)
    // — chat renders these as a large red panel with the activity's
    // history + shortcuts to the sender's calendar/grid/total views.
    isHelpRequest: boolean("is_help_request").notNull().default(false),
    // Marks the message as a "shared with you" notification (migration
    // 0030) — chat renders these as the same panel structure but neutral
    // (no red urgency). Only set by shareActivity when it creates a NEW
    // share; toggling share_progress does NOT create another one.
    isShareNotification: boolean("is_share_notification")
      .notNull()
      .default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [
    index("messages_pair_idx").on(t.senderId, t.recipientId, t.createdAt),
    index("messages_recipient_idx").on(t.recipientId, t.createdAt),
  ]
);

// ===========================================================================
// Communities — Groups / Clubs / Guilds (migration 0031)
// ===========================================================================

// One shared table across all three types; `kind` distinguishes them.
// Groups are always private+non-open (DB CHECK enforces this). Clubs and
// Guilds are configurable. Membership + ranks + join requests + activities
// + auto-add prefs are all keyed by community_id so shared UI works for
// every kind.
export const communities = pgTable(
  "communities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    handle: text("handle"),
    description: text("description"),
    visibility: text("visibility").notNull(),
    joinPolicy: text("join_policy").notNull(),
    // Leadership setting: how much of the community calendar members see
    // ('full' | 'light'). Added in migration 0040.
    calendarDisplay: text("calendar_display").notNull().default("light"),
    // Chat settings (migration 0041). who_can_speak: 'everyone' | 'leadership'.
    chatEnabled: boolean("chat_enabled").notNull().default(true),
    chatWhoCanSpeak: text("chat_who_can_speak").notNull().default("everyone"),
    // Homepage + member visibility (migration 0045).
    homeContent: text("home_content"),
    showMembers: boolean("show_members").notNull().default(true),
    outsiderVisibility: jsonb("outsider_visibility")
      .$type<Record<string, boolean>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("communities_kind_idx").on(t.kind),
    index("communities_created_by_idx").on(t.createdBy),
  ]
);

export const communityMembers = pgTable(
  "community_members",
  {
    communityId: uuid("community_id").notNull(),
    userId: uuid("user_id").notNull(),
    role: text("role").notNull().default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("community_members_user_idx").on(t.userId)]
);

export const communityRanks = pgTable(
  "community_ranks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    communityId: uuid("community_id").notNull(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    permissions: jsonb("permissions")
      .$type<Record<string, boolean>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (t) => [index("community_ranks_community_idx").on(t.communityId)]
);

export const communityJoinRequests = pgTable(
  "community_join_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    communityId: uuid("community_id").notNull(),
    userId: uuid("user_id").notNull(),
    note: text("note"),
    status: text("status").notNull().default("pending"),
    handledBy: uuid("handled_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    handledAt: timestamp("handled_at", { withTimezone: true }),
  },
  (t) => [
    index("community_join_requests_community_idx").on(t.communityId, t.status),
  ]
);

export const communityActivities = pgTable(
  "community_activities",
  {
    communityId: uuid("community_id").notNull(),
    activityId: uuid("activity_id").notNull(),
    addedBy: uuid("added_by"),
    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("community_activities_activity_idx").on(t.activityId)]
);

export const communityAutoAddPrefs = pgTable("community_auto_add_prefs", {
  communityId: uuid("community_id").notNull(),
  userId: uuid("user_id").notNull(),
  autoAdd: boolean("auto_add").notNull().default(false),
});

// Per-community group chat (migration 0043). sender_id NULL = a system
// notice (kind='system'); system_event holds structured change data.
export const communityMessages = pgTable(
  "community_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    communityId: uuid("community_id").notNull(),
    senderId: uuid("sender_id"),
    kind: text("kind").notNull().default("message"),
    body: text("body").notNull(),
    systemEvent: jsonb("system_event").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("community_messages_idx").on(t.communityId, t.createdAt)]
);

// ===========================================================================
// Timeline conflict acknowledgements (migration 0036)
// ---------------------------------------------------------------------------
// Cross-device replacement for the localStorage "conflicts-dismissed"
// set. Key format: `${date}|${eventKey1}|${eventKey2}` with the two
// event keys ordered lexicographically so A×B and B×A collapse.
export const conflictAcknowledgements = pgTable(
  "conflict_acknowledgements",
  {
    userId: uuid("user_id").notNull(),
    pairKey: text("pair_key").notNull(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("conflict_acknowledgements_user_idx").on(t.userId)]
);
