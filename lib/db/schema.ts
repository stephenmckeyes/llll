// ---------------------------------------------------------------------------
// Mission — database schema (v1)
//
// Architectural rules from the design doc (do not violate):
//   1. Producer/Completion split: producers represent intent, completions
//      represent reality. Separate tables.
//   2. Completions are self-contained and immutable. Copy fields from the
//      producer onto the completion at creation. Soft-delete only.
//   3. All completion creation goes through lib/domain/completions.ts.
//   4. Rhythms are structured JSON (not RRULE strings). Validated by Zod
//      at the app boundary; stored as jsonb.
//   5. Visibility field on every user-data table from day one.
//   6. Free-text tags. No fixed taxonomy yet.
//
// Conventions:
//   - TypeScript identifiers: camelCase. DB column names: snake_case.
//   - All primary keys are UUIDs (defaultRandom = gen_random_uuid()).
//   - All timestamps are TIMESTAMPTZ (timezone-aware UTC instants).
//   - scheduled_for and due_date are plain DATE (calendar day in user's TZ).
//   - Soft-delete uses deleted_at / archived_at; never DELETE rows of
//     producers or completions.
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

export const taskStatus = pgEnum("task_status", [
  "pending",
  "completed",
  "abandoned",
]);

// ===========================================================================
// profiles
// ---------------------------------------------------------------------------
// Extends Supabase's auth.users with app-specific fields. The `id` column
// equals auth.users.id for the same user; a trigger (added in a later
// migration) keeps them in sync.
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
// recurring_activities  (producer of habit instances)
// ---------------------------------------------------------------------------
// `recurrence` is one of these shapes, validated by Zod before insert:
//   { type: "daily" }
//   { type: "weekdays", days: ["mon","wed","fri"] }
//   { type: "interval", days: 2 }                  // every N days
//   { type: "frequency", count: 3, period: "week" } // N times per period
// ===========================================================================

export const recurringActivities = pgTable(
  "recurring_activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    recurrence: jsonb("recurrence").notNull(),
    defaultSkillTags: text("default_skill_tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    defaultMetrics: jsonb("default_metrics")
      .notNull()
      .default(sql`'{}'::jsonb`),
    visibility: visibility("visibility").notNull().default("private"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [index("recurring_activities_user_idx").on(t.userId)]
);

// ===========================================================================
// recurring_activity_instances
// ---------------------------------------------------------------------------
// Specific dated occurrences of a recurring activity, generated lazily by
// the rhythm-to-instance pure function (lib/domain/rhythms.ts).
// (recurring_activity_id, scheduled_for) is unique — only one instance per
// activity per day.
// ===========================================================================

export const recurringActivityInstances = pgTable(
  "recurring_activity_instances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recurringActivityId: uuid("recurring_activity_id")
      .notNull()
      .references(() => recurringActivities.id, { onDelete: "cascade" }),
    scheduledFor: date("scheduled_for").notNull(),
    status: instanceStatus("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("rai_activity_date_idx").on(
      t.recurringActivityId,
      t.scheduledFor
    ),
    index("rai_status_idx").on(t.status),
  ]
);

// ===========================================================================
// tasks  (one-off producer with optional deadline / window)
// ---------------------------------------------------------------------------
// abandoned_reason preserves signal that intent existed — don't force
// users to either complete or delete.
// ===========================================================================

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    dueDate: date("due_date"),
    earliestDate: date("earliest_date"),
    priority: smallint("priority").notNull().default(2), // 1=high, 2=med, 3=low
    defaultSkillTags: text("default_skill_tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: taskStatus("status").notNull().default("pending"),
    abandonedReason: text("abandoned_reason"),
    visibility: visibility("visibility").notNull().default("private"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("tasks_user_idx").on(t.userId),
    index("tasks_status_idx").on(t.status),
  ]
);

// ===========================================================================
// completions  (the atomic, append-only "I did a thing")
// ---------------------------------------------------------------------------
// Self-contained: skill_tags and metrics are COPIED from the producer at
// creation, not referenced. Renaming or archiving a producer never
// corrupts history. Soft-delete via deleted_at.
//
// occurred_at = when it actually happened (UTC).
// created_at  = when it was logged.
// These differ for backdated entries (make-ups, travel, ad-hoc historical).
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
    effortRating: smallint("effort_rating"), // 1–5, nullable
    note: text("note"),
    visibility: visibility("visibility").notNull().default("private"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("completions_user_occurred_idx").on(t.userId, t.occurredAt),
  ]
);

// ===========================================================================
// completion_instances  (M:N link: completions ↔ recurring activity instances)
// ---------------------------------------------------------------------------
// A completion can satisfy zero, one, or many instances. An instance can
// be satisfied by one completion (typical) — the M:N table allows future
// flexibility without schema migration.
// ===========================================================================

export const completionInstances = pgTable(
  "completion_instances",
  {
    completionId: uuid("completion_id")
      .notNull()
      .references(() => completions.id, { onDelete: "cascade" }),
    instanceId: uuid("instance_id")
      .notNull()
      .references(() => recurringActivityInstances.id, {
        onDelete: "cascade",
      }),
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
// completion_tasks  (M:N link: completions ↔ tasks)
// ---------------------------------------------------------------------------
// Same shape as completion_instances. Two link tables (instead of one
// polymorphic one) preserves real foreign-key integrity at the DB level.
// ===========================================================================

export const completionTasks = pgTable(
  "completion_tasks",
  {
    completionId: uuid("completion_id")
      .notNull()
      .references(() => completions.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("completion_tasks_pk").on(t.completionId, t.taskId),
    index("completion_tasks_task_idx").on(t.taskId),
  ]
);
