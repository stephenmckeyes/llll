"use client";

// ---------------------------------------------------------------------------
// GridTable — the actual table rendered by the Grid (habit-tracker) view.
//
// Mode-aware cell behavior:
//   - Week mode:  cells are normal size, click opens the ActivityModal
//                 (the same one the Day view uses) — most precise control.
//   - Month mode: cells are smaller so a full month fits without
//                 horizontal scrolling. Click drills DOWN to that day's
//                 Week view in the grid (so you can find the cell at
//                 larger size and then act on it).
//   - Total mode: cells are tiny (heatmap-style), one per day across
//                 the last year. Click drills DOWN to that day's Month
//                 view. No Done/Missed numeric columns — the heatmap
//                 IS the visualization.
//
// The Year → Month → Week → Day drill-down hierarchy mirrors how the
// iPhone Calendar app behaves. Clicking a coloured patch always takes
// you "one level closer" to the actual day, where the modal lives.
//
// Modal state lives here (not GridView) because GridView is a server
// component. The server pre-builds every clickable cell's full
// DayInstance payload up front so no follow-up fetch on click.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useState } from "react";

import { ActivityModal } from "./activity-modal";
import type { DayInstance } from "./day-list";

export type GridCellState =
  | "completed"
  | "missed"
  | "overdue"  // internal name; user-facing wording is "Unlabeled"
  | "scheduled"
  | "not-scheduled"
  | "outside";

export type GridCell = {
  state: GridCellState;
  dateStr: string;
  // null when the cell isn't tied to a real instance row (not-scheduled
  // or outside-active). Clicking does nothing in that case.
  instance: DayInstance | null;
};

export type GridRow = {
  activity: {
    id: string;
    name: string;
  };
  /** Human-readable rhythm category, e.g. "Daily", "Multi", "Specific". */
  rhythmCategory: string;
  cells: GridCell[];
  pct: number | null;
  done: number;
  missed: number;
  /** Past-pending instances ("Unlabeled" in UI). */
  unlabeled: number;
};

export type DateCol = {
  date: Date;
  dateStr: string;
};

export type GridMode = "week" | "month" | "total";

export function GridTable({
  mode,
  rows,
  dateCols,
  todayStr,
  rangeLabel,
  singlesDone,
  singlesTotal,
}: {
  mode: GridMode;
  rows: GridRow[];
  dateCols: DateCol[];
  todayStr: string;
  rangeLabel: string;
  singlesDone: number;
  singlesTotal: number;
}) {
  const [openInstance, setOpenInstance] = useState<DayInstance | null>(null);

  return (
    <>
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-200 p-6 text-center text-sm text-zinc-500 dark:border-zinc-800">
          No rhythmic activities active in this period. Add one (anything
          except a one-time event), or pick a different time window.
        </p>
      ) : mode === "total" ? (
        <TotalHeatmap rows={rows} todayStr={todayStr} />
      ) : (
        <CalendarTable
          mode={mode}
          rows={rows}
          dateCols={dateCols}
          todayStr={todayStr}
          onOpenInstance={setOpenInstance}
        />
      )}

      <SinglesBanner
        done={singlesDone}
        total={singlesTotal}
        rangeLabel={rangeLabel}
      />

      <GridLegend mode={mode} />

      {openInstance && (
        <ActivityModal
          instance={openInstance}
          todayStr={todayStr}
          onClose={() => setOpenInstance(null)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// CalendarTable — Week + Month layouts.
//
// Cell size scales by mode (Month cells are smaller so 28-31 days fit).
// Cell click behavior:
//   - week  → open modal (act on the instance)
//   - month → drill to that day's week in the grid
// ---------------------------------------------------------------------------

function CalendarTable({
  mode,
  rows,
  dateCols,
  todayStr,
  onOpenInstance,
}: {
  mode: "week" | "month";
  rows: GridRow[];
  dateCols: DateCol[];
  todayStr: string;
  onOpenInstance: (i: DayInstance) => void;
}) {
  const cellSize = mode === "week" ? "w-7" : "w-5";
  const cellText = mode === "week" ? "text-[10px]" : "text-[8px]";
  const dayHeaderText = mode === "week" ? "text-sm" : "text-[10px]";

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky left-0 z-20 border-b border-zinc-200 bg-white px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950"
            >
              Activity
            </th>
            <th
              scope="col"
              className="border-b border-zinc-200 px-1 py-2 text-left text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800"
            >
              Type
            </th>
            {dateCols.map((c) => (
              <th
                key={c.dateStr}
                scope="col"
                className={`border-b border-zinc-200 px-0.5 py-2 text-center text-[10px] font-medium dark:border-zinc-800 ${
                  c.dateStr === todayStr
                    ? "text-zinc-900 dark:text-zinc-50"
                    : "text-zinc-500"
                }`}
              >
                <div className="uppercase tracking-wide">
                  {formatWeekday(c.date, mode)}
                </div>
                <div
                  className={`${dayHeaderText} ${
                    c.dateStr === todayStr ? "font-semibold" : "font-normal"
                  }`}
                >
                  {c.date.getDate()}
                </div>
              </th>
            ))}
            <th
              scope="col"
              className="sticky right-0 z-20 border-b border-l border-zinc-200 bg-white px-2 py-2 text-center text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950"
            >
              Success
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.activity.id}>
              <th
                scope="row"
                className="sticky left-0 z-10 border-b border-zinc-100 bg-white px-2 py-1.5 text-left text-xs font-medium text-zinc-800 dark:border-zinc-900 dark:bg-zinc-950 dark:text-zinc-200"
              >
                <span
                  className="block max-w-[6rem] truncate"
                  title={row.activity.name}
                >
                  {row.activity.name}
                </span>
              </th>
              <td className="border-b border-zinc-100 px-2 py-1.5 text-left text-[11px] text-zinc-500 dark:border-zinc-900">
                {row.rhythmCategory}
              </td>
              {row.cells.map((cell) => (
                <td
                  key={cell.dateStr}
                  className="border-b border-zinc-100 p-0.5 dark:border-zinc-900"
                >
                  <CellButton
                    cell={cell}
                    todayStr={todayStr}
                    activityName={row.activity.name}
                    sizeClass={cellSize}
                    textClass={cellText}
                    clickMode={mode === "week" ? "modal" : "drill-week"}
                    onOpen={onOpenInstance}
                  />
                </td>
              ))}
              <td
                className={`sticky right-0 z-10 border-b border-l border-zinc-100 bg-white px-2 py-1.5 text-center text-xs dark:border-zinc-900 dark:bg-zinc-950 ${pctClass(
                  row.pct
                )}`}
              >
                {row.pct === null ? "—" : `${row.pct}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TotalHeatmap — Total view. Tiny cells, no glyphs, no Done/Missed
// numeric columns. Each row is a year of activity at a glance.
//
// Per user spec:
//   - No row-click. Only individual cells are clickable.
//   - No Overdue column. The unlabeled count appears as a small inline
//     badge next to the activity name when > 0.
//   - Cell click drills down to the Month view for that day.
// ---------------------------------------------------------------------------

function TotalHeatmap({
  rows,
  todayStr,
}: {
  rows: GridRow[];
  todayStr: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky left-0 z-20 border-b border-zinc-200 bg-white px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950"
            >
              Activity
            </th>
            <th
              scope="col"
              className="border-b border-zinc-200 px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800"
            >
              Type
            </th>
            <th
              scope="col"
              className="border-b border-zinc-200 px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800"
            >
              Past year
            </th>
            <th
              scope="col"
              className="sticky right-0 z-20 border-b border-l border-zinc-200 bg-white px-2 py-2 text-center text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950"
            >
              Success
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.activity.id}>
              {/* Activity name + inline "X unlabeled" warning badge (no
                  longer its own column). The row itself is NOT clickable
                  in Total — per spec, drilling only happens on individual
                  cells. */}
              <th
                scope="row"
                className="sticky left-0 z-10 border-b border-zinc-100 bg-white px-2 py-1.5 text-left text-xs font-medium text-zinc-800 dark:border-zinc-900 dark:bg-zinc-950 dark:text-zinc-200"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    className="block max-w-[6rem] truncate"
                    title={row.activity.name}
                  >
                    {row.activity.name}
                  </span>
                  {row.unlabeled > 0 && (
                    <span
                      title={`${row.unlabeled} past-due occurrences still need a verdict (mark complete or missed)`}
                      className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-950 dark:text-amber-200"
                    >
                      ⚠ {row.unlabeled} unlabeled
                    </span>
                  )}
                </span>
              </th>
              <td className="border-b border-zinc-100 px-2 py-1.5 text-left text-[11px] text-zinc-500 dark:border-zinc-900">
                {row.rhythmCategory}
              </td>
              <td className="border-b border-zinc-100 px-2 py-1.5 dark:border-zinc-900">
                <div className="flex items-center gap-px">
                  {row.cells.map((cell) => (
                    <HeatmapCell
                      key={cell.dateStr}
                      cell={cell}
                      todayStr={todayStr}
                      activityName={row.activity.name}
                    />
                  ))}
                </div>
              </td>
              <td
                className={`sticky right-0 z-10 border-b border-l border-zinc-100 bg-white px-2 py-1.5 text-center text-xs dark:border-zinc-900 dark:bg-zinc-950 ${pctClass(
                  row.pct
                )}`}
              >
                {row.pct === null ? "—" : `${row.pct}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------

type ClickMode = "modal" | "drill-week" | "drill-month";

function CellButton({
  cell,
  todayStr,
  activityName,
  sizeClass,
  textClass,
  clickMode,
  onOpen,
}: {
  cell: GridCell;
  todayStr: string;
  activityName: string;
  sizeClass: string;
  textClass: string;
  clickMode: ClickMode;
  onOpen: (i: DayInstance) => void;
}) {
  const isToday = cell.dateStr === todayStr;
  const base = `flex aspect-square ${sizeClass} items-center justify-center rounded ${textClass} font-medium transition-colors`;
  let cls = base;
  let label: string;
  let inner: React.ReactNode = "";
  let style: React.CSSProperties | undefined;

  switch (cell.state) {
    case "completed":
      cls += " bg-emerald-500 text-white hover:bg-emerald-600";
      inner = "✓";
      label = `Completed — ${activityName} on ${cell.dateStr}`;
      break;
    case "missed":
      cls += " bg-red-500 text-white hover:bg-red-600";
      inner = "✗";
      label = `Missed — ${activityName} on ${cell.dateStr}`;
      break;
    case "overdue":
      cls +=
        " bg-amber-300 text-amber-900 hover:bg-amber-400 dark:bg-amber-700 dark:text-amber-100";
      inner = "!";
      label = `Unlabeled — ${activityName} on ${cell.dateStr}`;
      break;
    case "scheduled":
      cls +=
        " border border-zinc-300 bg-zinc-50 text-zinc-400 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900";
      inner = "·";
      label = `Scheduled — ${activityName} on ${cell.dateStr}`;
      break;
    case "not-scheduled":
      cls += " text-zinc-300 dark:text-zinc-700";
      label = `${activityName} — not scheduled on ${cell.dateStr}`;
      break;
    case "outside":
      cls += " text-zinc-300 dark:text-zinc-700";
      label = `${activityName} — not active on ${cell.dateStr}`;
      style = {
        backgroundImage:
          "repeating-linear-gradient(45deg, rgb(228 228 231 / 0.6) 0 2px, transparent 2px 6px)",
      };
      break;
  }

  if (isToday) cls += " ring-1 ring-zinc-900 dark:ring-zinc-50";

  // No instance → not clickable. Render as a plain span.
  if (!cell.instance && clickMode === "modal") {
    return (
      <span className={cls} style={style} title={label} aria-label={label}>
        {inner}
      </span>
    );
  }

  // Drill modes always render as a Link (even cells without an instance
  // can be drilled into — e.g. a not-scheduled day still has a Week view
  // for the user to look at).
  if (clickMode !== "modal") {
    const href =
      clickMode === "drill-week"
        ? `/?view=grid&range=week&date=${cell.dateStr}`
        : `/?view=grid&range=month&date=${cell.dateStr}`;
    return (
      <Link
        href={href}
        className={cls}
        style={style}
        title={label}
        aria-label={label}
      >
        {inner}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={() => cell.instance && onOpen(cell.instance)}
      className={cls}
      style={style}
      title={label}
      aria-label={label}
    >
      {inner}
    </button>
  );
}

// HeatmapCell — Total-mode cell. Tiny (8px), no glyph, click drills to
// Month view for that date. We keep this distinct from CellButton
// because the styling shortcuts (no glyph, no `aspect-square wN` flex
// helper, color-only) get in each other's way otherwise.
function HeatmapCell({
  cell,
  todayStr,
  activityName,
}: {
  cell: GridCell;
  todayStr: string;
  activityName: string;
}) {
  const isToday = cell.dateStr === todayStr;
  let cls =
    "block h-2 w-2 rounded-sm transition-colors hover:ring-2 hover:ring-zinc-400";
  let label: string;
  let style: React.CSSProperties | undefined;

  switch (cell.state) {
    case "completed":
      cls += " bg-emerald-500";
      label = `Completed — ${activityName} on ${cell.dateStr}`;
      break;
    case "missed":
      cls += " bg-red-500";
      label = `Missed — ${activityName} on ${cell.dateStr}`;
      break;
    case "overdue":
      cls += " bg-amber-400 dark:bg-amber-600";
      label = `Unlabeled — ${activityName} on ${cell.dateStr}`;
      break;
    case "scheduled":
      cls += " bg-zinc-200 dark:bg-zinc-800";
      label = `Scheduled — ${activityName} on ${cell.dateStr}`;
      break;
    case "not-scheduled":
    case "outside":
      cls += " bg-transparent";
      label = `${activityName} — ${cell.dateStr}`;
      if (cell.state === "outside") {
        style = {
          backgroundImage:
            "repeating-linear-gradient(45deg, rgb(228 228 231 / 0.4) 0 1px, transparent 1px 3px)",
        };
      }
      break;
  }

  if (isToday) cls += " ring-1 ring-zinc-900 dark:ring-zinc-50";

  // Drill to Month view. Even blank cells get a link — the user might
  // want to inspect that month even though this activity wasn't active.
  return (
    <Link
      href={`/?view=grid&range=month&date=${cell.dateStr}`}
      className={cls}
      style={style}
      title={label}
      aria-label={label}
    />
  );
}

// ---------------------------------------------------------------------------

function SinglesBanner({
  done,
  total,
  rangeLabel,
}: {
  done: number;
  total: number;
  rangeLabel: string;
}) {
  if (total === 0 && done === 0) {
    return (
      <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        No one-time events {rangeLabel}.
      </p>
    );
  }
  return (
    <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-center text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
      You have also completed{" "}
      <strong className="tabular-nums">
        {done}/{total}
      </strong>{" "}
      one-time events {rangeLabel}.
    </p>
  );
}

// ---------------------------------------------------------------------------

function GridLegend({ mode }: { mode: GridMode }) {
  // Total mode's heatmap uses the same color semantics; legend is still
  // useful. The "Unlabeled" wording is unified across modes per user
  // spec — internally we still call the state "overdue" but the user
  // never sees that word.
  const items: Array<{ label: string; swatch: string; hatch?: boolean }> = [
    { label: "Done", swatch: "bg-emerald-500" },
    { label: "Missed", swatch: "bg-red-500" },
    {
      label: "Unlabeled",
      swatch: "bg-amber-300 dark:bg-amber-700",
    },
    {
      label: "Scheduled",
      swatch:
        "border border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900",
    },
    { label: "Not active", swatch: "", hatch: true },
  ];
  return (
    <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
      {mode === "total" && (
        <span className="mr-1 text-[10px] uppercase tracking-wide text-zinc-400">
          (click a cell to drill in)
        </span>
      )}
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1">
          <span
            aria-hidden
            className={`inline-block h-3 w-3 rounded ${it.swatch}`}
            style={
              it.hatch
                ? {
                    backgroundImage:
                      "repeating-linear-gradient(45deg, rgb(228 228 231 / 0.6) 0 2px, transparent 2px 6px)",
                  }
                : undefined
            }
          />
          {it.label}
        </span>
      ))}
    </p>
  );
}

// ---------------------------------------------------------------------------

function pctClass(pct: number | null): string {
  if (pct === null) return "text-zinc-400";
  if (pct >= 80) return "font-semibold text-emerald-700 dark:text-emerald-300";
  if (pct >= 50) return "text-amber-700 dark:text-amber-300";
  return "text-red-700 dark:text-red-300";
}

function formatWeekday(d: Date, mode: "week" | "month"): string {
  // For Month, single-letter weekday header keeps cells narrow.
  if (mode === "month") {
    const letters = ["S", "M", "T", "W", "T", "F", "S"];
    return letters[d.getDay()];
  }
  return d.toLocaleDateString(undefined, { weekday: "short" });
}
