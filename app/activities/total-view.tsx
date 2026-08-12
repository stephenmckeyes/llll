"use client";

// ---------------------------------------------------------------------------
// TotalView — the body of the Total View page (the old Archive page,
// expanded to show EVERY activity).
//
//   - "Group by"  : Status (Active / Archived) | Tag | Rhythm type.
//   - "Show"      : All | Active | Archived (a quick status filter).
//   - Groups render as collapsible <details>, open by default, each with a
//     count. Clicking any activity opens ActivityDetailModal (Edit rhythm /
//     History / Archive · Unarchive / Delete).
//
// All grouping/filtering is client-side over the full list the server
// hands down — no per-control round-trips.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";

import { rhythmCategoryLabel } from "@/lib/domain/rhythm-summary";
import { summarizeRhythm } from "@/lib/domain/rhythm-summary";
import type { TagMap } from "@/lib/domain/tags";

import { TagChipList } from "@/app/_components/tag-chip";

import { type AddActivityDensity } from "@/lib/domain/add-activity-density";

import { ControlRow, Segmented } from "@/app/_components/segmented";

import { ActivityDetailModal, type ActivityRow } from "./activity-detail-modal";

type GroupBy = "status" | "tag" | "rhythm";
// Total View is now split into three buckets so completed one-off
// tasks don't clutter the "Active" list:
//   - active   : archived_at IS NULL (day-to-day working set)
//   - past     : auto-archived on completion (self-cleanup singles)
//   - archived : manually archived / soft-deleted by the user
// "pinned" ignores archived state and shows every activity the user
// flagged as "I may want to re-initiate this" via the Add Activity
// Pinned toggle (migration 0035). Default filter per user spec.
type StatusFilter = "pinned" | "all" | "active" | "past" | "archived";

type Group = { key: string; label: string; items: ActivityRow[] };

export function TotalView({
  activities,
  tagMap,
  density = "compact",
  completedByActivityId = {},
}: {
  activities: ActivityRow[];
  tagMap: TagMap;
  /** Add Activity form-density preference, forwarded to
   *  ActivityDetailModal so Edit Rhythm shares the setting. */
  density?: AddActivityDensity;
  /** activityId → ISO timestamp of the LATEST completion for that
   *  activity. Only populated for auto-archived rows (see
   *  /activities/page.tsx). Used by the Past-filter cards to render
   *  "Scheduled X · Completed Y". */
  completedByActivityId?: Record<string, string>;
}) {
  // Defaults: grouped by Tag, showing Pinned only (per user spec —
  // "This will be the default when going on total view, and shows
  // those activities which a person may want to re-initiate").
  const [groupBy, setGroupBy] = useState<GroupBy>("tag");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pinned");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base =
      statusFilter === "pinned"
        ? activities.filter((a) => a.pinned === true)
        : statusFilter === "active"
          ? activities.filter((a) => a.archived_at === null)
          : statusFilter === "past"
            ? activities.filter(
                (a) => a.archived_at !== null && a.auto_archive
              )
            : statusFilter === "archived"
              ? activities.filter(
                  (a) => a.archived_at !== null && !a.auto_archive
                )
              : activities;
    if (!q) return base;
    // Case-insensitive substring match on name — the smallest useful
    // scope. Tag / notes search can follow if the ask surfaces.
    return base.filter((a) => a.name.toLowerCase().includes(q));
  }, [activities, statusFilter, search]);

  const groups = useMemo(
    () => buildGroups(filtered, groupBy),
    [filtered, groupBy]
  );

  const openActivity =
    openId === null ? null : activities.find((a) => a.id === openId) ?? null;

  return (
    <div className="flex flex-col gap-4">
      {/* Controls */}
      <div className="flex flex-col gap-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
        <ControlRow label="Search">
          <div className="relative min-w-0 flex-1">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name…"
              className="w-full min-w-0 rounded-md border border-zinc-300 bg-white px-3 py-1.5 pr-7 text-xs dark:border-zinc-700 dark:bg-zinc-900"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Clear search"
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                ×
              </button>
            )}
          </div>
        </ControlRow>
        <ControlRow label="Group by">
          <Segmented
            options={[
              ["status", "Status"],
              ["tag", "Tag"],
              ["rhythm", "Rhythm"],
            ]}
            value={groupBy}
            onChange={(v) => setGroupBy(v as GroupBy)}
          />
        </ControlRow>
        <ControlRow label="Show">
          <Segmented
            options={[
              ["pinned", "📌 Pinned"],
              ["active", "Active"],
              ["past", "Past"],
              ["archived", "Archived"],
              ["all", "All"],
            ]}
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as StatusFilter)}
          />
        </ControlRow>
      </div>

      {groups.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
          No activities to show.
        </p>
      ) : (
        groups.map((g) => (
          <details
            key={g.key}
            open
            className="rounded-md border border-zinc-200 dark:border-zinc-800"
          >
            <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3">
              <span className="text-sm font-medium uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
                {g.label} ({g.items.length})
              </span>
            </summary>
            <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
              <ul className="flex flex-col gap-2">
                {g.items.map((a) => (
                  <ActivityCard
                    key={a.id}
                    activity={a}
                    tagMap={tagMap}
                    completedAt={completedByActivityId[a.id] ?? null}
                    onOpen={() => setOpenId(a.id)}
                  />
                ))}
              </ul>
            </div>
          </details>
        ))
      )}

      {openActivity && (
        <ActivityDetailModal
          activity={openActivity}
          tagMap={tagMap}
          onClose={() => setOpenId(null)}
          density={density}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

function buildGroups(rows: ActivityRow[], groupBy: GroupBy): Group[] {
  if (groupBy === "status") {
    // Four buckets: active/archived × on-grid/off-grid.
    const out: Group[] = [];
    const bucket = (
      key: string,
      label: string,
      pred: (a: ActivityRow) => boolean
    ) => {
      const items = rows.filter(pred);
      if (items.length > 0) out.push({ key, label, items: sortByName(items) });
    };
    bucket(
      "active-on",
      "Active · On Streaks",
      (a) => a.archived_at === null && a.track_on_grid
    );
    bucket(
      "active-off",
      "Active · Off Streaks",
      (a) => a.archived_at === null && !a.track_on_grid
    );
    bucket(
      "archived-on",
      "Archived · On Streaks",
      (a) => a.archived_at !== null && a.track_on_grid
    );
    bucket(
      "archived-off",
      "Archived · Off Streaks",
      (a) => a.archived_at !== null && !a.track_on_grid
    );
    if (out.length === 0)
      out.push({ key: "active-off", label: "Active · Off Streaks", items: [] });
    return out;
  }

  if (groupBy === "rhythm") {
    return groupByKey(rows, (a) =>
      rhythmCategoryLabel(a.rhythm, a.scheduled_times)
    );
  }

  // groupBy === "tag" — first tag, or a "No tag" bucket sorted last.
  return groupByKey(
    rows,
    (a) => a.default_skill_tags[0] ?? "No tag",
    (label) => (label === "No tag" ? "No tag" : label)
  );
}

function groupByKey(
  rows: ActivityRow[],
  keyOf: (a: ActivityRow) => string,
  labelOf: (key: string) => string = (k) => k
): Group[] {
  const buckets = new Map<string, ActivityRow[]>();
  for (const a of rows) {
    const k = keyOf(a);
    const arr = buckets.get(k);
    if (arr) arr.push(a);
    else buckets.set(k, [a]);
  }
  return Array.from(buckets.keys())
    .sort((a, b) => a.localeCompare(b))
    .map((k) => ({
      key: k,
      label: labelOf(k),
      items: sortByName(buckets.get(k) ?? []),
    }));
}

function sortByName(rows: ActivityRow[]): ActivityRow[] {
  return [...rows].sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Rows + controls
// ---------------------------------------------------------------------------

function ActivityCard({
  activity,
  tagMap,
  completedAt,
  onOpen,
}: {
  activity: ActivityRow;
  tagMap: TagMap;
  /** ISO timestamp of the latest completion for THIS activity, when
   *  the parent /activities page fetched it (only for auto-archived
   *  rows). Drives the "Scheduled X · Completed Y" line for the Past
   *  filter. */
  completedAt?: string | null;
  onOpen: () => void;
}) {
  const archived = activity.archived_at !== null;
  const isSingle = activity.rhythm.type === "single";
  const isPast = archived && activity.auto_archive;
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full flex-col gap-1 rounded-md border border-zinc-200 bg-white px-4 py-3 text-left transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
      >
        <div className="flex items-center gap-2">
          <span
            className={`min-w-0 truncate font-medium ${
              archived ? "text-zinc-500 line-through" : ""
            }`}
          >
            {activity.name}
          </span>
          {/* Distinguish auto-archived (Past) from manually archived so
              the user can tell why a row is off Active without opening
              the modal. Past = self-cleanup; Archived = user's soft
              delete. */}
          {isPast && (
            <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:bg-amber-950 dark:text-amber-300">
              Past
            </span>
          )}
          {archived && !isPast && (
            <span className="shrink-0 rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
              Archived
            </span>
          )}
          {activity.track_on_grid && (
            <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              On Streaks
            </span>
          )}
        </div>
        <span className="truncate text-sm text-zinc-600 dark:text-zinc-400">
          {summarizeRhythm(activity.rhythm, activity.scheduled_times)}
        </span>
        {/* Historical dates line — only for Past singles where we have
            both a scheduled day (activity.start_date == scheduled_for)
            and a completion timestamp. Reads "Scheduled Jul 12 ·
            Completed Jul 15" so the user can see at a glance when
            they'd planned to do it vs. when they actually did. */}
        {isPast && isSingle && (
          <span className="truncate text-xs text-zinc-500">
            Scheduled {formatCompactDate(activity.start_date)}
            {completedAt
              ? ` · Completed ${formatCompactDate(completedAt)}`
              : ""}
          </span>
        )}
        {activity.default_skill_tags.length > 0 && (
          <span className="mt-1 flex flex-wrap gap-1">
            <TagChipList
              names={activity.default_skill_tags}
              tags={tagMap}
              size="xs"
            />
          </span>
        )}
      </button>
    </li>
  );
}

// "Jul 12" / "Jul 12, 2025" if not current year. Works for both YMD
// strings (activity.start_date) and full ISO timestamps.
function formatCompactDate(input: string): string {
  const d = new Date(input.length === 10 ? `${input}T00:00:00` : input);
  if (Number.isNaN(d.getTime())) return input;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
}

