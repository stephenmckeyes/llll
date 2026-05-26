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
import { useEffect, useMemo, useState } from "react";

import type { SharedActivity, SharedInstance } from "@/app/actions/sharing";
import { rhythmCategoryLabel } from "@/lib/domain/rhythm-summary";
import { computeStreakValue, type StreakMode } from "@/lib/domain/streak";
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

import {
  occurrenceStatusLabel,
  toDayInstance,
  type Occurrence,
} from "./shared-data";

type Range = "week" | "month" | "total" | "custom";

export function FriendGrid({
  friendId,
  shares,
  instances,
  todayStr,
  tagMap,
  highlightId = null,
  onOpenActivity,
  streakMode,
  streakGoal,
  showStats,
  statsAccuracy,
}: {
  friendId: string;
  shares: SharedActivity[];
  instances: SharedInstance[];
  todayStr: string;
  tagMap: TagMap;
  /** Activity to flash briefly (arrived via a reminder notification link). */
  highlightId?: string | null;
  /** Open the read-only detail for a specific occurrence (clicking a cell). */
  onOpenActivity: (activityId: string, occurrence: Occurrence | null) => void;
  /** Viewer's global streak display preference, applied to friend rows. */
  streakMode: StreakMode;
  streakGoal: number | null;
  showStats: boolean;
  statsAccuracy: boolean;
}) {
  // When deep-linked to highlight an activity, open on Total so the row is
  // guaranteed to be present regardless of the current week/month.
  const [range, setRange] = useState<Range>(highlightId ? "total" : "week");
  const [refDate, setRefDate] = useState<string>(todayStr);

  // The highlight flashes "for an instant" then fades. Initial state already
  // carries the id from the deep link, so the effect only schedules the
  // clear (setState lives in the timeout callback, not the effect body).
  const [highlight, setHighlight] = useState<string | null>(highlightId);
  useEffect(() => {
    if (!highlightId) return;
    const t = setTimeout(() => setHighlight(null), 2500);
    return () => clearTimeout(t);
  }, [highlightId]);
  // Custom range bounds (default: last 30 days). Only used when range==="custom".
  const [customFrom, setCustomFrom] = useState<string>(
    format(addDays(parseYmd(todayStr), -30), "yyyy-MM-dd")
  );
  const [customTo, setCustomTo] = useState<string>(todayStr);
  const [hiddenTags, setHiddenTags] = useState<ReadonlySet<string>>(new Set());

  const built = useMemo(
    () =>
      buildGrid(
        shares,
        instances,
        range,
        refDate,
        todayStr,
        customFrom,
        customTo,
        streakMode,
        streakGoal
      ),
    [
      shares,
      instances,
      range,
      refDate,
      todayStr,
      customFrom,
      customTo,
      streakMode,
      streakGoal,
    ]
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
      {/* Range sub-tabs (Week / Month / Total / Custom) */}
      <nav className="flex gap-1 rounded-md border border-zinc-200 p-0.5 dark:border-zinc-800">
        {(
          [
            ["week", "Week"],
            ["month", "Month"],
            ["total", "Total"],
            ["custom", "Custom"],
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

      {/* Navigator: prev / next / today for week+month; two date inputs for
          custom; total has no nav. Plus the tag filter. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {(range === "week" || range === "month") && (
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
          {range === "custom" && (
            <>
              <input
                type="date"
                value={customFrom}
                max={customTo}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
              <span className="text-sm text-zinc-500">→</span>
              <input
                type="date"
                value={customTo}
                min={customFrom}
                onChange={(e) => setCustomTo(e.target.value)}
                className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
            </>
          )}
          {range !== "custom" && (
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {built.label}
            </span>
          )}
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
        highlightActivityId={highlight}
        onReadOnlyOpen={(inst) =>
          onOpenActivity(inst.activity.id, {
            scheduledFor: inst.scheduled_for,
            statusLabel: occurrenceStatusLabel(
              inst.status,
              inst.scheduled_for,
              todayStr
            ),
          })
        }
        showStats={showStats}
        statsAccuracy={statsAccuracy}
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
  todayStr: string,
  customFrom: string,
  customTo: string,
  streakMode: StreakMode,
  streakGoal: number | null
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
  } else if (range === "custom") {
    // Guard against an inverted range (from after to).
    const a = parseYmd(customFrom);
    const b = parseYmd(customTo);
    rangeStart = a <= b ? a : b;
    rangeEnd = a <= b ? b : a;
    label = `${format(rangeStart, "MMM d")} – ${format(rangeEnd, "MMM d, yyyy")}`;
    rangeLabel = "in this range";
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

    // Viewer's streak mode applied to the friend's occurrences. Note this
    // is computed over the fetched window, so total/countdown reflect the
    // visible range rather than all-time.
    const history = Array.from(byDate.values()).map((i) => ({
      scheduled_for: i.scheduledFor,
      status: i.status,
    }));
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
      streak: computeStreakValue(streakMode, history, todayStr),
      streakMode,
      streakGoal,
    });
  }

  rows.sort((a, b) => a.activity.name.localeCompare(b.activity.name));
  singles.sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for));

  return {
    // Custom reuses the Total heatmap layout (scales to any width), same
    // as the dashboard grid.
    mode: range === "custom" ? "total" : range,
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

function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}
