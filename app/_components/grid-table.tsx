"use client";

// ---------------------------------------------------------------------------
// GridTable — the actual table rendered by the Grid (habit-tracker) view.
//
// Two modes:
//   - "calendar": traditional habit grid — rows = activities, columns =
//     days in range. Each cell is a clickable button that opens the
//     ActivityModal in place (same modal the Day view uses), so the
//     user can complete / mark-missed / edit straight from the grid.
//   - "total":   all-time summary — rows = activities, fixed columns
//     show done / missed / overdue counts + success %. No day cells.
//     Clicking the row opens the modal for the OLDEST pending instance
//     of that activity, so "fix this" is one click.
//
// Modal state lives here (not in GridView) because GridView is a server
// component and useState/useEffect can't run there. The trade-off: the
// server pre-builds every clickable cell's full DayInstance payload up
// front, so we don't need a follow-up fetch on click. Payloads are
// small (one row per scheduled day in the range, JSON-only fields), so
// this is fine even for a month range with many activities.
// ---------------------------------------------------------------------------

import { useState } from "react";

import { ActivityModal } from "./activity-modal";
import type { DayInstance } from "./day-list";

export type GridCellState =
  | "completed"
  | "missed"
  | "overdue"
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
  cells: GridCell[];
  pct: number | null;
  done: number;
  missed: number;
  overdue: number;
  // For "total" mode row-click: the oldest pending instance (if any) so
  // clicking the row jumps the user to the thing they're behind on.
  oldestPending: DayInstance | null;
};

export type DateCol = {
  date: Date;
  dateStr: string;
};

export type GridMode = "calendar" | "total";

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
  // Ignored in "total" mode.
  dateCols: DateCol[];
  todayStr: string;
  // Used in the singles banner copy ("this week" / "this month" / "all-time").
  rangeLabel: string;
  singlesDone: number;
  singlesTotal: number;
}) {
  const [openInstance, setOpenInstance] = useState<DayInstance | null>(null);

  return (
    <>
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-200 p-6 text-center text-sm text-zinc-500 dark:border-zinc-800">
          No active rhythmic activities yet. Add one (anything except a
          one-time event) to see it show up here.
        </p>
      ) : mode === "total" ? (
        <TotalTable rows={rows} onOpenInstance={setOpenInstance} />
      ) : (
        <CalendarTable
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

function CalendarTable({
  rows,
  dateCols,
  todayStr,
  onOpenInstance,
}: {
  rows: GridRow[];
  dateCols: DateCol[];
  todayStr: string;
  onOpenInstance: (i: DayInstance) => void;
}) {
  return (
    // Horizontal scroll wrapper. The activity-name column stays put via
    // sticky-left and success-% stays via sticky-right.
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
            {dateCols.map((c) => (
              <th
                key={c.dateStr}
                scope="col"
                className={`border-b border-zinc-200 px-1 py-2 text-center text-[10px] font-medium dark:border-zinc-800 ${
                  c.dateStr === todayStr
                    ? "text-zinc-900 dark:text-zinc-50"
                    : "text-zinc-500"
                }`}
              >
                <div className="uppercase tracking-wide">
                  {formatWeekday(c.date)}
                </div>
                <div
                  className={`text-sm ${
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
                  className="block max-w-[10rem] truncate"
                  title={row.activity.name}
                >
                  {row.activity.name}
                </span>
              </th>
              {row.cells.map((cell) => (
                <td
                  key={cell.dateStr}
                  className="border-b border-zinc-100 p-0.5 dark:border-zinc-900"
                >
                  <CellButton
                    cell={cell}
                    todayStr={todayStr}
                    activityName={row.activity.name}
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

function TotalTable({
  rows,
  onOpenInstance,
}: {
  rows: GridRow[];
  onOpenInstance: (i: DayInstance) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            <th
              scope="col"
              className="border-b border-zinc-200 px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800"
            >
              Activity
            </th>
            <th
              scope="col"
              className="border-b border-zinc-200 px-2 py-2 text-center text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:border-zinc-800 dark:text-emerald-300"
            >
              Done
            </th>
            <th
              scope="col"
              className="border-b border-zinc-200 px-2 py-2 text-center text-[10px] font-medium uppercase tracking-wide text-red-700 dark:border-zinc-800 dark:text-red-300"
            >
              Missed
            </th>
            <th
              scope="col"
              className="border-b border-zinc-200 px-2 py-2 text-center text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:border-zinc-800 dark:text-amber-300"
            >
              Overdue
            </th>
            <th
              scope="col"
              className="border-b border-l border-zinc-200 px-2 py-2 text-center text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800"
            >
              Success
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            // The row is clickable only if there's something to act on.
            // Otherwise it's just informational and shouldn't pretend to
            // be a button.
            const clickable = row.oldestPending !== null;
            const RowEl = clickable ? "button" : "div";
            return (
              <tr key={row.activity.id}>
                <th
                  scope="row"
                  className="border-b border-zinc-100 px-0 py-0 text-left dark:border-zinc-900"
                >
                  <RowEl
                    type={clickable ? "button" : undefined}
                    onClick={
                      clickable
                        ? () =>
                            row.oldestPending &&
                            onOpenInstance(row.oldestPending)
                        : undefined
                    }
                    title={
                      clickable
                        ? `Open the oldest overdue / scheduled instance of ${row.activity.name}`
                        : row.activity.name
                    }
                    className={`block w-full px-2 py-1.5 text-left text-xs font-medium text-zinc-800 dark:text-zinc-200 ${
                      clickable
                        ? "hover:bg-zinc-50 dark:hover:bg-zinc-900"
                        : ""
                    }`}
                  >
                    <span
                      className="block truncate"
                      title={row.activity.name}
                    >
                      {row.activity.name}
                    </span>
                  </RowEl>
                </th>
                <td className="border-b border-zinc-100 px-2 py-1.5 text-center text-xs tabular-nums text-emerald-700 dark:border-zinc-900 dark:text-emerald-300">
                  {row.done}
                </td>
                <td className="border-b border-zinc-100 px-2 py-1.5 text-center text-xs tabular-nums text-red-700 dark:border-zinc-900 dark:text-red-300">
                  {row.missed}
                </td>
                <td className="border-b border-zinc-100 px-2 py-1.5 text-center text-xs tabular-nums text-amber-700 dark:border-zinc-900 dark:text-amber-300">
                  {row.overdue}
                </td>
                <td
                  className={`border-b border-l border-zinc-100 px-2 py-1.5 text-center text-xs dark:border-zinc-900 ${pctClass(
                    row.pct
                  )}`}
                >
                  {row.pct === null ? "—" : `${row.pct}%`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------

function CellButton({
  cell,
  todayStr,
  activityName,
  onOpen,
}: {
  cell: GridCell;
  todayStr: string;
  activityName: string;
  onOpen: (i: DayInstance) => void;
}) {
  const isToday = cell.dateStr === todayStr;
  const base =
    "flex aspect-square w-7 items-center justify-center rounded text-[10px] font-medium transition-colors";
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
      label = `Overdue — ${activityName} on ${cell.dateStr}`;
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

  // Cells WITHOUT an instance behind them aren't clickable — there's
  // nothing to open. Render as a plain span to skip the button focus
  // ring and disabled-state styling.
  if (!cell.instance) {
    return (
      <span
        className={cls}
        style={style}
        title={label}
        aria-label={label}
      >
        {inner}
      </span>
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
  // Per spec: even when there are no singles scheduled in the range we
  // still surface the banner so the layout stays consistent. The
  // wording in the zero-total case avoids dividing by nothing.
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
  // Plain non-interactive swatches sized to a small inline glyph.
  // In total mode there are no cells, so the cell-state legend is
  // irrelevant — skip it.
  if (mode === "total") return null;
  const items: Array<{ state: GridCellState; label: string; swatch: string }> = [
    { state: "completed", label: "Done", swatch: "bg-emerald-500" },
    { state: "missed", label: "Missed", swatch: "bg-red-500" },
    {
      state: "overdue",
      label: "Overdue",
      swatch: "bg-amber-300 dark:bg-amber-700",
    },
    {
      state: "scheduled",
      label: "Scheduled",
      swatch:
        "border border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900",
    },
    { state: "outside", label: "Not active", swatch: "" },
  ];
  return (
    <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
      {items.map((it) => (
        <span key={it.state} className="inline-flex items-center gap-1">
          <span
            aria-hidden
            className={`inline-block h-3 w-3 rounded ${it.swatch}`}
            style={
              it.state === "outside"
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

function formatWeekday(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: "short" });
}
