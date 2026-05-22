"use client";

// ---------------------------------------------------------------------------
// FriendGrid — the friend view's Grid tab, rendered with the SAME GridTable
// the dashboard uses (read-only). Week / Month / Total ranges, prev/next
// navigation, and the tag filter ("filter columns") all work; the rows +
// cells are built client-side from the friend's shared activities +
// occurrences instead of the owner's own data.
// ---------------------------------------------------------------------------

import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { useMemo, useState } from "react";

import type { SharedActivity, SharedInstance } from "@/app/actions/sharing";
import { rhythmCategoryLabel } from "@/lib/domain/rhythm-summary";
import type { TagMap } from "@/lib/domain/tags";

import type { DayInstance } from "@/app/_components/day-list";
import {
  GridTable,
  TagFilterPopover,
  type DateCol,
  type GridCell,
  type GridCellState,
  type GridMode,
  type GridRow,
} from "@/app/_components/grid-table";

type Range = "week" | "month" | "total";

export function FriendGrid({
  friendId,
  shares,
  instances,
  todayStr,
  tagMap,
}: {
  friendId: string;
  shares: SharedActivity[];
  instances: SharedInstance[];
  todayStr: string;
  tagMap: TagMap;
}) {
  const [range, setRange] = useState<Range>("week");
  const [refDate, setRefDate] = useState<string>(todayStr);
  const [hiddenTags, setHiddenTags] = useState<ReadonlySet<string>>(new Set());

  const built = useMemo(
    () => buildGrid(shares, instances, range, refDate, todayStr),
    [shares, instances, range, refDate, todayStr]
  );

  const allTagNames = useMemo(() => {
    const s = new Set<string>();
    for (const r of built.rows) for (const t of r.activity.tags) s.add(t);
    return Array.from(s).sort();
  }, [built.rows]);

  const visibleRows = useMemo(
    () =>
      built.rows.filter((r) => {
        if (r.activity.tags.length === 0) return !hiddenTags.has("__none__");
        return r.activity.tags.some((t) => !hiddenTags.has(t));
      }),
    [built.rows, hiddenTags]
  );

  function shift(dir: -1 | 1) {
    const d = parseYmd(refDate);
    if (range === "week") setRefDate(format(addDays(d, dir * 7), "yyyy-MM-dd"));
    else if (range === "month")
      setRefDate(format(addMonths(d, dir), "yyyy-MM-dd"));
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Range sub-tabs (Week / Month / Total) */}
      <nav className="flex gap-1 rounded-md border border-zinc-200 p-0.5 dark:border-zinc-800">
        {(
          [
            ["week", "Week"],
            ["month", "Month"],
            ["total", "Total"],
          ] as const
        ).map(([val, label]) => (
          <button
            key={val}
            type="button"
            onClick={() => setRange(val)}
            className={`flex flex-1 items-center justify-center rounded px-3 py-0.5 text-center text-xs font-medium transition-colors ${
              range === val
                ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* Navigator: prev / label / next / today + tag filter */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {range !== "total" && (
            <>
              <button
                type="button"
                onClick={() => shift(-1)}
                aria-label="Previous"
                className="rounded-md border border-zinc-300 px-2 py-1 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                ←
              </button>
              <button
                type="button"
                onClick={() => shift(1)}
                aria-label="Next"
                className="rounded-md border border-zinc-300 px-2 py-1 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                →
              </button>
              <button
                type="button"
                onClick={() => setRefDate(todayStr)}
                className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
              >
                Today
              </button>
            </>
          )}
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {built.label}
          </span>
        </div>
        <TagFilterPopover
          tagNames={allTagNames}
          hiddenTags={hiddenTags}
          tagMap={tagMap}
          onToggle={(name) =>
            setHiddenTags((prev) => {
              const next = new Set(prev);
              if (next.has(name)) next.delete(name);
              else next.add(name);
              return next;
            })
          }
          onSelectAll={() => setHiddenTags(new Set())}
          onDeselectAll={() =>
            setHiddenTags(new Set([...allTagNames, "__none__"]))
          }
        />
      </div>

      <GridTable
        mode={built.mode}
        rows={visibleRows}
        dateCols={built.dateCols}
        todayStr={todayStr}
        rangeLabel={built.rangeLabel}
        singlesDone={built.singlesDone}
        singlesTotal={built.singlesTotal}
        singles={built.singles}
        // Namespacing the off-set per friend so hiding rows here doesn't
        // touch the user's own grid preferences.
        userId={`friend:${friendId}`}
        tagMap={tagMap}
        readOnly
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Build the GridTable inputs from a friend's shared activities + occurrences.
// Mirrors the dashboard's GridView builder, but the schedule comes straight
// from the shared instances (no rhythm re-derivation needed).
// ---------------------------------------------------------------------------

function buildGrid(
  shares: SharedActivity[],
  instances: SharedInstance[],
  range: Range,
  refDate: string,
  todayStr: string
): {
  mode: GridMode;
  dateCols: DateCol[];
  rows: GridRow[];
  singles: DayInstance[];
  singlesDone: number;
  singlesTotal: number;
  rangeLabel: string;
  label: string;
} {
  const ref = parseYmd(refDate);

  // ---- date range ----
  let rangeStart: Date;
  let rangeEnd: Date;
  let label: string;
  let rangeLabel: string;
  if (range === "week") {
    rangeStart = startOfWeek(ref, { weekStartsOn: 1 });
    rangeEnd = endOfWeek(ref, { weekStartsOn: 1 });
    label = `${format(rangeStart, "MMM d")} – ${format(rangeEnd, "MMM d, yyyy")}`;
    rangeLabel = "this week";
  } else if (range === "month") {
    rangeStart = startOfMonth(ref);
    rangeEnd = endOfMonth(ref);
    label = format(ref, "MMMM yyyy");
    rangeLabel = "this month";
  } else {
    // total: earliest shared occurrence → today
    const earliest =
      instances.length > 0
        ? instances.reduce(
            (min, i) => (i.scheduledFor < min ? i.scheduledFor : min),
            instances[0].scheduledFor
          )
        : todayStr;
    rangeStart = parseYmd(earliest);
    rangeEnd = parseYmd(todayStr);
    label =
      instances.length === 0
        ? "All time (nothing shared yet)"
        : `Since ${format(rangeStart, "MMM d, yyyy")}`;
    rangeLabel = "in the visible range";
  }

  const dateCols: DateCol[] = [];
  {
    let d = rangeStart;
    let guard = 0;
    while (d <= rangeEnd && guard < 4000) {
      dateCols.push({ date: d, dateStr: format(d, "yyyy-MM-dd") });
      d = addDays(d, 1);
      guard++;
    }
  }
  const colDates = new Set(dateCols.map((c) => c.dateStr));

  // ---- index instances per (activity, date) ----
  const byActivityDate = new Map<string, Map<string, SharedInstance>>();
  for (const inst of instances) {
    let inner = byActivityDate.get(inst.activityId);
    if (!inner) {
      inner = new Map();
      byActivityDate.set(inst.activityId, inner);
    }
    inner.set(inst.scheduledFor, inst);
  }

  // ---- singles (one-time activities) → banner ----
  const singles: DayInstance[] = [];
  let singlesDone = 0;
  let singlesTotal = 0;

  // ---- rhythmic rows ----
  const rows: GridRow[] = [];

  for (const share of shares) {
    if (share.archivedAt !== null) continue; // archived → Total tab only
    const byDate = byActivityDate.get(share.activityId);
    if (!byDate) continue; // no shared occurrences (template only)

    if (share.rhythm.type === "single") {
      for (const [dateStr, inst] of byDate) {
        if (!colDates.has(dateStr)) continue;
        singlesTotal++;
        if (inst.status === "completed") singlesDone++;
        singles.push(toDayInstance(inst, share));
      }
      continue;
    }

    // Skip rows with no occurrence in the visible range.
    let hasInRange = false;
    for (const dateStr of byDate.keys()) {
      if (colDates.has(dateStr)) {
        hasInRange = true;
        break;
      }
    }
    if (!hasInRange) continue;

    let done = 0;
    let missed = 0;
    let unlabeled = 0;
    let totalInPeriod = 0;

    const cells: GridCell[] = dateCols.map(({ dateStr }) => {
      if (dateStr < share.startDate) return cell("outside", dateStr);
      if (share.endDate && dateStr > share.endDate)
        return cell("outside", dateStr);
      const inst = byDate.get(dateStr);
      if (!inst) return cell("not-scheduled", dateStr);

      let state: GridCellState;
      if (inst.status === "completed") {
        state = "completed";
        done++;
      } else if (inst.status === "missed") {
        state = "missed";
        missed++;
      } else if (dateStr < todayStr) {
        state = "overdue";
        unlabeled++;
      } else {
        state = "scheduled";
      }
      totalInPeriod++;
      return { state, dateStr, instance: toDayInstance(inst, share) };
    });

    const onTheHook = done + missed + unlabeled;
    const pct = onTheHook === 0 ? null : Math.round((done / onTheHook) * 100);

    rows.push({
      activity: {
        id: share.activityId,
        name: share.name,
        tags: share.defaultSkillTags,
      },
      rhythmCategory: rhythmCategoryLabel(share.rhythm, share.scheduledTimes),
      cells,
      pct,
      done,
      missed,
      unlabeled,
      onTheHook,
      totalInPeriod,
      streak: computeStreak(byDate, todayStr),
    });
  }

  rows.sort((a, b) => a.activity.name.localeCompare(b.activity.name));
  singles.sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for));

  return {
    mode: range,
    dateCols,
    rows,
    singles,
    singlesDone,
    singlesTotal,
    rangeLabel,
    label,
  };
}

function cell(state: GridCellState, dateStr: string): GridCell {
  return { state, dateStr, instance: null };
}

// Simple read-only streak: walk this activity's past-or-today occurrences
// newest-first, counting leading completions.
function computeStreak(
  byDate: Map<string, SharedInstance>,
  todayStr: string
): number {
  const past = Array.from(byDate.values())
    .filter((i) => i.scheduledFor <= todayStr)
    .sort((a, b) => b.scheduledFor.localeCompare(a.scheduledFor));
  let streak = 0;
  for (const inst of past) {
    if (inst.status === "completed") streak++;
    else break;
  }
  return streak;
}

function toDayInstance(inst: SharedInstance, share: SharedActivity): DayInstance {
  const status =
    inst.status === "completed" || inst.status === "missed"
      ? inst.status
      : "pending";
  return {
    id: inst.instanceId,
    scheduled_for: inst.scheduledFor,
    status,
    completionCount: inst.completionCount,
    tags: share.defaultSkillTags,
    overrideName: null,
    overrideNotes: null,
    overridePriority: null,
    activity: {
      id: share.activityId,
      name: share.name,
      notes: share.notes,
      rhythm: share.rhythm,
      priority: share.priority,
      scheduled_times: share.scheduledTimes,
      default_skill_tags: share.defaultSkillTags,
      start_date: share.startDate,
      end_date: share.endDate,
      archived_at: share.archivedAt,
      reminders: [],
    },
  };
}

function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}
