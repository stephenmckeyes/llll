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
  date,
  index,
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
});

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
