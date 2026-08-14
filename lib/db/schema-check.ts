// ---------------------------------------------------------------------------
// Schema-check — compare the DB's current column layout against the columns
// the current code expects, and report which migrations still need to be
// pasted in Supabase.
//
// One list, one lookup, no per-page effort. The hardcoded EXPECTATIONS
// list grows every time a migration adds a schema-visible thing that
// the app code will silently break without. When something IS missing,
// MigrationCheckBanner renders a red strip on every page telling the
// user exactly which migration file to paste.
//
// Bootstrap caveat: this check itself relies on the
// public.list_schema_columns() RPC (added in migration 0033). Until the
// user has applied 0033, the RPC call errors out and the banner
// silently renders nothing — no worse than the pre-banner status quo.
// Once 0033 lands, every future missed migration gets called out by
// name.
// ---------------------------------------------------------------------------

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

/**
 * One schema-visible expectation for a migration. `column === null`
 * means we only need the table to exist (any column). Everything else
 * checks that (table, column) pair is present.
 */
export type MigrationExpectation = {
  /** Which migration file adds this — quoted verbatim in the banner. */
  migration: string;
  /** Human-readable title so the banner reads as English, not SQL. */
  label: string;
  /** Every (table, column) pair required by the migration. */
  checks: ReadonlyArray<{ table: string; column: string }>;
};

// The list. When you ship a migration that adds a column the app
// code will start referencing right away, add an entry here.
export const EXPECTATIONS: ReadonlyArray<MigrationExpectation> = [
  {
    migration: "0025_ics_token.sql",
    label: "ICS calendar sync",
    checks: [{ table: "profiles", column: "ics_token" }],
  },
  {
    migration: "0026_auto_archive.sql",
    label: "Auto-archive on completion",
    checks: [{ table: "activities", column: "auto_archive" }],
  },
  {
    migration: "0027_friend_reorder.sql",
    label: "Friend reorder",
    checks: [{ table: "friendships", column: "sort_order" }],
  },
  {
    migration: "0028_help_request.sql",
    label: "Ask-for-help messages",
    checks: [{ table: "messages", column: "is_help_request" }],
  },
  {
    migration: "0029_default_streaks_range.sql",
    label: "Default Streaks range setting",
    checks: [{ table: "profiles", column: "default_streaks_range" }],
  },
  {
    migration: "0030_share_notification.sql",
    label: "Share notification panel",
    checks: [{ table: "messages", column: "is_share_notification" }],
  },
  {
    migration: "0031_communities.sql",
    label: "Communities (Groups / Clubs / Guilds)",
    checks: [
      // Any one column on the new table proves the table exists.
      { table: "communities", column: "id" },
      { table: "community_members", column: "user_id" },
    ],
  },
  {
    migration: "0032_scheduled_end_times.sql",
    label: "Optional per-slot end times",
    checks: [{ table: "activities", column: "scheduled_end_times" }],
  },
  {
    migration: "0034_default_calendar_hidden_tags.sql",
    label: "Default Calendar tag filter",
    checks: [
      { table: "profiles", column: "default_calendar_hidden_tags" },
    ],
  },
  {
    migration: "0035_pinned_activities.sql",
    label: "Pinned activities",
    checks: [{ table: "activities", column: "pinned" }],
  },
  {
    migration: "0036_conflict_acknowledgements.sql",
    label: "Timeline conflict acknowledgements (cross-device)",
    checks: [{ table: "conflict_acknowledgements", column: "pair_key" }],
  },
  {
    migration: "0037_default_untimed_open.sql",
    label: "Default Timeline untimed-dropdown state",
    checks: [{ table: "profiles", column: "default_untimed_open" }],
  },
  {
    migration: "0039_archived_tags.sql",
    label: "Archived tags (tags.archived_at)",
    checks: [{ table: "tags", column: "archived_at" }],
  },
  {
    migration: "0040_community_activities.sql",
    label: "Community activities + calendar (Phase 3)",
    checks: [{ table: "communities", column: "calendar_display" }],
  },
  {
    migration: "0041_community_settings.sql",
    label: "Community settings — chat + admittance (Phase 4)",
    checks: [{ table: "communities", column: "chat_enabled" }],
  },
  {
    migration: "0043_community_chat.sql",
    label: "Community chat (Phase 7)",
    checks: [{ table: "community_messages", column: "kind" }],
  },
  {
    migration: "0045_community_home.sql",
    label: "Community homepage + member visibility",
    checks: [{ table: "communities", column: "show_members" }],
  },
  {
    migration: "0048_community_invites.sql",
    label: "Community invites (Phase 6)",
    checks: [{ table: "community_invites", column: "status" }],
  },
  {
    migration: "0050_request_outcomes.sql",
    label: "Join-request outcome notifications",
    checks: [{ table: "community_join_requests", column: "dismissed" }],
  },
  {
    migration: "0055_auto_add_notifications.sql",
    label: "Auto-added activity notifications",
    checks: [{ table: "community_auto_add_events", column: "id" }],
  },
  {
    migration: "0056_community_owned_calendar.sql",
    label: "Community-owned calendars",
    checks: [
      { table: "community_owned_activities", column: "id" },
      { table: "community_owned_instances", column: "status" },
    ],
  },
  {
    migration: "0059_auto_resolve.sql",
    label: "Auto-drop when past (activity setting)",
    checks: [{ table: "activities", column: "auto_resolve" }],
  },
];

export type MissingMigration = {
  migration: string;
  label: string;
  missing: ReadonlyArray<{ table: string; column: string }>;
};

/**
 * Query the DB for what actually exists and return every expected
 * migration that's still missing something. Empty array === schema is
 * caught up.
 *
 * Cached per-request via React's cache() so multiple callers on one
 * page share the single query.
 */
export const getMissingMigrations = cache(
  async (): Promise<ReadonlyArray<MissingMigration>> => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("list_schema_columns");
    if (error || !data) {
      // Two failure modes:
      //   1. Migration 0033 not applied yet → RPC doesn't exist. No
      //      way to check anything; render nothing (banner stays
      //      silent, same as pre-banner behavior).
      //   2. User isn't authenticated → RPC EXECUTE is granted only
      //      to `authenticated`. Same silent behavior — the login
      //      page doesn't need to nag about migrations.
      return [];
    }

    // Build a fast Set of "table.column" strings.
    const present = new Set<string>();
    for (const row of data as Array<{ table_name: string; column_name: string }>) {
      present.add(`${row.table_name}.${row.column_name}`);
    }

    const missing: MissingMigration[] = [];
    for (const exp of EXPECTATIONS) {
      const missingChecks = exp.checks.filter(
        (c) => !present.has(`${c.table}.${c.column}`)
      );
      if (missingChecks.length > 0) {
        missing.push({
          migration: exp.migration,
          label: exp.label,
          missing: missingChecks,
        });
      }
    }
    return missing;
  }
);
