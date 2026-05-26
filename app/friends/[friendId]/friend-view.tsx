"use client";

// ---------------------------------------------------------------------------
// FriendView — read-only window into ONE friend's shared rhythms, with the
// same three surfaces as your own dashboard:
//   - Total    : group/filter (Status / Tag / Rhythm) + Copy to my schedule.
//   - Calendar : Day / Week / Month / Year (FriendCalendar).
//   - Grid     : Week / Month / Total + tag filter (FriendGrid, real GridTable).
//
// Everything is read-only — there are no mutation controls anywhere; the
// data comes only from the SECURITY DEFINER RPCs that return what this
// friend shared with you. "Copy to my schedule" creates YOUR own activity.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";

import type { SharedActivity, SharedInstance } from "@/app/actions/sharing";
import { rhythmCategoryLabel, summarizeRhythm } from "@/lib/domain/rhythm-summary";
import type { StreakMode } from "@/lib/domain/streak";
import type { TagMap } from "@/lib/domain/tags";

import { TagChipList } from "@/app/_components/tag-chip";

import { CopyShareModal } from "../copy-share-modal";
import { FriendCalendar } from "./friend-calendar";
import { FriendGrid } from "./friend-grid";
import { RemindersButton } from "./reminders-button";
import type { Occurrence } from "./shared-data";
import { SharedActivityModal } from "./shared-activity-modal";

type ViewKind = "total" | "calendar" | "grid";

/** activityId → which reminder cadences the viewer has enabled. */
export type WatchMap = Record<
  string,
  { notifyEach: boolean; notifyDaily: boolean; notifyWeekly: boolean }
>;

const NO_WATCH = {
  notifyEach: false,
  notifyDaily: false,
  notifyWeekly: false,
};

export function FriendView({
  friendId,
  friendName,
  shares,
  instances,
  todayStr,
  tagMap,
  watchMap,
  initialView = "total",
  highlightId = null,
  streakMode,
  streakGoal,
  showStats,
  statsAccuracy,
}: {
  friendId: string;
  friendName: string;
  shares: SharedActivity[];
  instances: SharedInstance[];
  todayStr: string;
  tagMap: TagMap;
  watchMap: WatchMap;
  /** Tab to open on load (from a deep link). */
  initialView?: ViewKind;
  /** Activity to flash in the grid (from a reminder notification link). */
  highlightId?: string | null;
  /** Viewer's global streak display preference (applied to the friend grid). */
  streakMode: StreakMode;
  streakGoal: number | null;
  showStats: boolean;
  statsAccuracy: boolean;
}) {
  const [view, setView] = useState<ViewKind>(initialView);
  const [copying, setCopying] = useState<SharedActivity | null>(null);
  // The open detail: which activity + which specific occurrence (or null for
  // a rhythm-level open from the Total list).
  const [detail, setDetail] = useState<{
    activityId: string;
    occurrence: Occurrence | null;
  } | null>(null);

  const sharesById = useMemo(
    () => new Map(shares.map((s) => [s.activityId, s])),
    [shares]
  );
  const openShare = detail ? sharesById.get(detail.activityId) ?? null : null;

  const onOpenActivity = (activityId: string, occurrence: Occurrence | null) =>
    setDetail({ activityId, occurrence });

  if (shares.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
        {friendName} hasn&rsquo;t shared anything with you yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Read-only section tabs — laid out like the personal dashboard:
          Calendar (left) · Grid (middle) · Total (right). Total is the
          default selection when you open a friend's profile. */}
      <nav className="flex gap-1 rounded-md border border-zinc-200 p-0.5 dark:border-zinc-800">
        {(
          [
            ["calendar", "Calendar"],
            ["grid", "Grid"],
            ["total", "Total"],
          ] as const
        ).map(([val, label]) => (
          <button
            key={val}
            type="button"
            onClick={() => setView(val)}
            className={`flex flex-1 items-center justify-center rounded px-3 py-1 text-center text-sm font-semibold transition-colors ${
              view === val
                ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {view === "total" && (
        <TotalReadOnly
          shares={shares}
          tagMap={tagMap}
          watchMap={watchMap}
          onCopy={(s) => setCopying(s)}
          onOpenActivity={onOpenActivity}
        />
      )}
      {view === "calendar" && (
        <FriendCalendar
          shares={shares}
          instances={instances}
          todayStr={todayStr}
          tagMap={tagMap}
          onOpenActivity={onOpenActivity}
        />
      )}
      {view === "grid" && (
        <FriendGrid
          friendId={friendId}
          shares={shares}
          instances={instances}
          todayStr={todayStr}
          tagMap={tagMap}
          highlightId={highlightId}
          onOpenActivity={onOpenActivity}
          streakMode={streakMode}
          streakGoal={streakGoal}
          showStats={showStats}
          statsAccuracy={statsAccuracy}
        />
      )}

      {openShare && detail && (
        <SharedActivityModal
          share={openShare}
          friendId={friendId}
          tagMap={tagMap}
          watch={watchMap[openShare.activityId] ?? NO_WATCH}
          occurrence={detail.occurrence}
          onCopy={(s) => setCopying(s)}
          onClose={() => setDetail(null)}
        />
      )}

      {copying && (
        <CopyShareModal
          shared={copying}
          tagMap={tagMap}
          onClose={() => setCopying(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Total — same Group by (Status / Tag / Rhythm) + Show (All/Active/Archived)
// controls as the individual Total View, read-only with a Copy action.
// ---------------------------------------------------------------------------

type GroupBy = "status" | "tag" | "rhythm";
type StatusFilter = "all" | "active" | "archived";
type ShareGroup = { key: string; label: string; items: SharedActivity[] };

function TotalReadOnly({
  shares,
  tagMap,
  watchMap,
  onCopy,
  onOpenActivity,
}: {
  shares: SharedActivity[];
  tagMap: TagMap;
  watchMap: WatchMap;
  onCopy: (s: SharedActivity) => void;
  onOpenActivity: (activityId: string, occurrence: Occurrence | null) => void;
}) {
  const [groupBy, setGroupBy] = useState<GroupBy>("tag");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");

  const filtered = useMemo(() => {
    if (statusFilter === "active")
      return shares.filter((s) => s.archivedAt === null);
    if (statusFilter === "archived")
      return shares.filter((s) => s.archivedAt !== null);
    return shares;
  }, [shares, statusFilter]);

  const groups = useMemo(
    () => buildShareGroups(filtered, groupBy),
    [filtered, groupBy]
  );

  return (
    <div className="flex flex-col gap-4">
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
          Nothing matches this filter.
        </p>
      ) : (
        groups.map((g) => (
          <Group key={g.key} label={g.label} count={g.items.length}>
            {g.items.map((s) => (
              <ShareCard
                key={s.shareId}
                share={s}
                tagMap={tagMap}
                watch={watchMap[s.activityId] ?? NO_WATCH}
                onCopy={onCopy}
                onOpenActivity={onOpenActivity}
              />
            ))}
          </Group>
        ))
      )}
    </div>
  );
}

function buildShareGroups(
  rows: SharedActivity[],
  groupBy: GroupBy
): ShareGroup[] {
  if (groupBy === "status") {
    const active = rows.filter((s) => s.archivedAt === null);
    const archived = rows.filter((s) => s.archivedAt !== null);
    const out: ShareGroup[] = [];
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
    return groupShares(rows, (s) =>
      rhythmCategoryLabel(s.rhythm, s.scheduledTimes)
    );
  }
  return groupShares(rows, (s) => s.defaultSkillTags[0] ?? "No tag");
}

function groupShares(
  rows: SharedActivity[],
  keyOf: (s: SharedActivity) => string
): ShareGroup[] {
  const buckets = new Map<string, SharedActivity[]>();
  for (const s of rows) {
    const k = keyOf(s);
    const arr = buckets.get(k);
    if (arr) arr.push(s);
    else buckets.set(k, [s]);
  }
  return Array.from(buckets.keys())
    .sort((a, b) => a.localeCompare(b))
    .map((k) => ({ key: k, label: k, items: sortByName(buckets.get(k) ?? []) }));
}

function sortByName(rows: SharedActivity[]): SharedActivity[] {
  return [...rows].sort((a, b) => a.name.localeCompare(b.name));
}

function Group({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <details
      open
      className="rounded-md border border-zinc-200 dark:border-zinc-800"
    >
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
        {label} ({count})
      </summary>
      <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
        {count === 0 ? (
          <p className="px-1 py-2 text-sm text-zinc-500">None.</p>
        ) : (
          <ul className="flex flex-col gap-2">{children}</ul>
        )}
      </div>
    </details>
  );
}

function ShareCard({
  share,
  tagMap,
  watch,
  onCopy,
  onOpenActivity,
}: {
  share: SharedActivity;
  tagMap: TagMap;
  watch: { notifyEach: boolean; notifyDaily: boolean; notifyWeekly: boolean };
  onCopy: (s: SharedActivity) => void;
  onOpenActivity: (activityId: string, occurrence: Occurrence | null) => void;
}) {
  const archived = share.archivedAt !== null;
  return (
    <li className="flex flex-col gap-3 rounded-md border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950 sm:flex-row sm:items-start sm:justify-between">
      {/* Tap the info area to open the read-only detail (with notes). Reply
          to a SPECIFIC occurrence lives in the Calendar/Grid; the Total card
          opens the rhythm-level detail (no occurrence → no Reply). */}
      <button
        type="button"
        onClick={() => onOpenActivity(share.activityId, null)}
        className="min-w-0 cursor-pointer text-left"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`truncate font-medium ${
              archived ? "text-zinc-500 line-through" : ""
            }`}
          >
            {share.name}
          </span>
          {archived ? (
            <Badge label="Archived" />
          ) : (
            !share.shareProgress && <Badge label="Template only" />
          )}
        </div>
        <p className="mt-0.5 truncate text-sm text-zinc-600 dark:text-zinc-400">
          {summarizeRhythm(share.rhythm, share.scheduledTimes)}
        </p>
        {share.defaultSkillTags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            <TagChipList
              names={share.defaultSkillTags}
              tags={tagMap}
              size="xs"
            />
          </div>
        )}
      </button>
      <div className="flex shrink-0 flex-wrap gap-2">
        {/* Reply lives on a specific occurrence (Calendar/Grid), not the
            whole rhythm — so the Total card has no Reply button. */}
        {/* Reminders only make sense when the owner shares progress (the
            watch RLS enforces it too); archived/template-only shares have
            no progress to nudge about. */}
        {!archived && share.shareProgress && (
          <RemindersButton
            activityId={share.activityId}
            activityName={share.name}
            initial={watch}
          />
        )}
        <button
          type="button"
          onClick={() => onCopy(share)}
          className="touch-manipulation rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Copy to my schedule
        </button>
      </div>
    </li>
  );
}

function Badge({ label }: { label: string }) {
  return (
    <span className="shrink-0 rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
      {label}
    </span>
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
