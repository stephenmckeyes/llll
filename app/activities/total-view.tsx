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

import { ActivityDetailModal, type ActivityRow } from "./activity-detail-modal";

type GroupBy = "status" | "tag" | "rhythm";
type StatusFilter = "all" | "active" | "archived";

type Group = { key: string; label: string; items: ActivityRow[] };

export function TotalView({
  activities,
  tagMap,
}: {
  activities: ActivityRow[];
  tagMap: TagMap;
}) {
  // Defaults: grouped by Tag, showing Active only (per user request) — the
  // most useful "what am I actively working on, organized by area" view.
  const [groupBy, setGroupBy] = useState<GroupBy>("tag");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [openId, setOpenId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (statusFilter === "active")
      return activities.filter((a) => a.archived_at === null);
    if (statusFilter === "archived")
      return activities.filter((a) => a.archived_at !== null);
    return activities;
  }, [activities, statusFilter]);

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
              ["all", "All"],
              ["active", "Active"],
              ["archived", "Archived"],
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
    const active = rows.filter((a) => a.archived_at === null);
    const archived = rows.filter((a) => a.archived_at !== null);
    const out: Group[] = [];
    // Active first (the live list), then Archived.
    if (active.length > 0 || archived.length === 0)
      out.push({ key: "active", label: "Active", items: sortByName(active) });
    if (archived.length > 0)
      out.push({
        key: "archived",
        label: "Archived",
        items: sortByName(archived),
      });
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
  onOpen,
}: {
  activity: ActivityRow;
  tagMap: TagMap;
  onOpen: () => void;
}) {
  const archived = activity.archived_at !== null;
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
          {archived && (
            <span className="shrink-0 rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
              Archived
            </span>
          )}
        </div>
        <span className="truncate text-sm text-zinc-600 dark:text-zinc-400">
          {summarizeRhythm(activity.rhythm, activity.scheduled_times)}
        </span>
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

function ControlRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-16 shrink-0 text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      {children}
    </div>
  );
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<readonly [string, string]>;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map(([val, label]) => {
        const active = val === value;
        return (
          <button
            key={val}
            type="button"
            onClick={() => onChange(val)}
            className={`touch-manipulation rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
              active
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
